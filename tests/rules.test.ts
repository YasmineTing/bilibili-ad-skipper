import { describe, expect, it } from "vitest";
import { buildRuleSegments, parseRulePack, RuleImportError, sanitizeRules, type CustomRule } from "../src/core/rules";
import type { Cue } from "../src/core/types";

function cue(id: string, from: number, to: number, text: string): Cue {
  return { id, startMs: from * 1000, endMs: to * 1000, text };
}

function rule(overrides: Partial<CustomRule> = {}): CustomRule {
  return {
    id: "r1",
    name: "测试规则",
    enabled: true,
    keywords: [],
    required: [],
    exclude: [],
    pattern: "",
    minHits: 1,
    beforeSeconds: 0.5,
    afterSeconds: 1.5,
    ...overrides
  };
}

const options = { mergeGapMs: 8_000, durationMs: 60_000 };

describe("rule import", () => {
  it("accepts a rule pack and fills safe defaults", () => {
    const [imported] = parseRulePack({ version: 1, name: "我的规则", rules: [{ name: "3C 商单", keywords: ["旗舰店"] }] });
    expect(imported).toMatchObject({
      id: "rule-1",
      name: "3C 商单",
      enabled: true,
      minHits: 1,
      beforeSeconds: 0.5,
      afterSeconds: 1.5
    });
  });

  it("accepts a bare array, normalizes terms, and clamps numbers", () => {
    const [imported] = parseRulePack([{ keywords: [" 到手价 ", "到手价", "A"], minHits: 99, beforeSeconds: -3 }]);
    expect(imported?.keywords).toEqual(["到手价", "A"]);
    expect(imported?.minHits).toBe(20);
    expect(imported?.beforeSeconds).toBe(0);
  });

  it("rejects an invalid regex and names the rule", () => {
    expect(() => parseRulePack({ rules: [{ name: "坏正则", pattern: "(" }] })).toThrow(RuleImportError);
    expect(() => parseRulePack({ rules: [{ name: "坏正则", pattern: "(" }] })).toThrow(/坏正则/);
  });

  it("rejects a rule without keywords or pattern", () => {
    expect(() => parseRulePack({ rules: [{ name: "空规则" }] })).toThrow(/keywords 或 pattern/);
  });

  it("rejects broken json and unexpected shapes", () => {
    expect(() => parseRulePack("{oops")).toThrow(/JSON 解析失败/);
    expect(() => parseRulePack('{"name":"没有 rules"}')).toThrow(/rules 数组/);
  });

  it("drops broken rules when reading saved settings", () => {
    const rules = sanitizeRules([{ name: "好规则", keywords: ["旗舰店"] }, { name: "坏正则", pattern: "(" }, { name: "空规则" }, null]);
    expect(rules.map((item) => item.name)).toEqual(["好规则"]);
  });
});

describe("custom rule matching", () => {
  it("groups nearby hits and applies per-rule buffers", () => {
    const cues = [cue("1", 10, 12, "这家官方旗舰店的活动"), cue("2", 15, 17, "记得领优惠券")];
    const [segment] = buildRuleSegments(cues, [rule({ keywords: ["旗舰店", "优惠券"], name: "电商商单" })], options);
    expect(segment?.startMs).toBe(9_500);
    expect(segment?.endMs).toBe(18_500);
    expect(segment?.ruleName).toBe("电商商单");
    expect(segment?.matchedKeywords).toEqual(["旗舰店", "优惠券"]);
  });

  it("splits groups when the gap is larger than the merge gap", () => {
    const cues = [cue("1", 10, 12, "旗舰店"), cue("2", 30, 32, "旗舰店")];
    const segments = buildRuleSegments(cues, [rule({ keywords: ["旗舰店"] })], options);
    expect(segments).toHaveLength(2);
  });

  it("checks required terms across the block between the first and last hit", () => {
    const cues = [cue("1", 10, 12, "这家官方旗舰店"), cue("2", 14, 16, "到手价很划算"), cue("3", 17, 19, "记得领优惠券")];
    const [segment] = buildRuleSegments(cues, [rule({ keywords: ["旗舰店", "优惠券"], required: ["到手价"] })], options);
    expect(segment?.cues.map((item) => item.id)).toEqual(["1", "2", "3"]);
    expect(segment?.hitCueIds).toEqual(["1", "3"]);
    expect(segment?.startMs).toBe(9_500);
    expect(segment?.endMs).toBe(20_500);
    expect(buildRuleSegments(cues, [rule({ keywords: ["旗舰店", "优惠券"], required: ["赠品"] })], options)).toEqual([]);
  });

  it("ignores sentences that contain an exclude term", () => {
    const cues = [cue("1", 10, 12, "旗舰店抽奖活动"), cue("2", 14, 16, "领优惠券")];
    const segments = buildRuleSegments(cues, [rule({ keywords: ["旗舰店", "优惠券"], exclude: ["抽奖"] })], options);
    expect(segments[0]?.hitCueIds).toEqual(["2"]);
    expect(segments[0]?.startMs).toBe(13_500);
  });

  it("honours minHits before creating a segment", () => {
    const cues = [cue("1", 10, 12, "旗舰店"), cue("2", 14, 16, "领优惠券")];
    expect(buildRuleSegments(cues, [rule({ keywords: ["旗舰店"], minHits: 2 })], options)).toEqual([]);
    expect(buildRuleSegments(cues, [rule({ keywords: ["旗舰店", "优惠券"], minHits: 2 })], options)).toHaveLength(1);
  });

  it("supports a case-insensitive pattern", () => {
    const cues = [cue("1", 10, 12, "Sponsored by ACME")];
    const [segment] = buildRuleSegments(cues, [rule({ pattern: "sponsored\\s+by" })], options);
    expect(segment?.matchedKeywords).toEqual(["正则"]);
  });

  it("ignores disabled rules and clamps the segment to the video duration", () => {
    const cues = [cue("1", 58, 59, "旗舰店")];
    expect(buildRuleSegments(cues, [rule({ keywords: ["旗舰店"], enabled: false })], options)).toEqual([]);
    const [segment] = buildRuleSegments(cues, [rule({ keywords: ["旗舰店"] })], options);
    expect(segment?.endMs).toBe(60_000);
  });
});
