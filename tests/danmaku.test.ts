import { describe, expect, it } from "vitest";
import { parseDanmakuJump } from "../src/core/danmaku";
import { parseDanmakuXml } from "../src/background/danmaku";

describe("danmaku jump parsing", () => {
  it("parses explicit colon times", () => {
    expect(parseDanmakuJump("空降8:16")).toMatchObject({ targetMs: 496_000, explicit: true, kind: "time" });
    expect(parseDanmakuJump("跳到12:03")?.targetMs).toBe(723_000);
  });

  it("parses Chinese digit hints and unit expressions", () => {
    expect(parseDanmakuJump("空降八一六")?.targetMs).toBe(496_000);
    expect(parseDanmakuJump("八一六")?.targetMs).toBe(496_000);
    expect(parseDanmakuJump("空降一零三零")?.targetMs).toBe(630_000);
    expect(parseDanmakuJump("跳到八分十六秒")?.targetMs).toBe(496_000);
    expect(parseDanmakuJump("空降八点十六")?.targetMs).toBe(496_000);
  });

  it("parses bare numeric hints only when there is explicit jump context", () => {
    expect(parseDanmakuJump("空降816")).toMatchObject({ targetMs: 496_000, explicit: true, kind: "number" });
    expect(parseDanmakuJump("816")).toBeNull();
  });

  it("filters meme numbers and invalid seconds", () => {
    expect(parseDanmakuJump("1")).toBeNull();
    expect(parseDanmakuJump("11")).toBeNull();
    expect(parseDanmakuJump("111")).toBeNull();
    expect(parseDanmakuJump("一")).toBeNull();
    expect(parseDanmakuJump("一一一")).toBeNull();
    expect(parseDanmakuJump("空降1")).toBeNull();
    expect(parseDanmakuJump("空降0:01")).toBeNull();
    expect(parseDanmakuJump("666")).toBeNull();
    expect(parseDanmakuJump("2333")).toBeNull();
    expect(parseDanmakuJump("二三三三")).toBeNull();
    expect(parseDanmakuJump("六六六")).toBeNull();
    expect(parseDanmakuJump("空降6:66")).toBeNull();
  });

  it("keeps a bare clock-like time for matching against an active ad segment", () => {
    expect(parseDanmakuJump("8:16")).toMatchObject({ targetMs: 496_000, explicit: false, kind: "time" });
  });

  it("does not treat ordinary duration comments as jump targets", () => {
    expect(parseDanmakuJump("好漫长的10分钟")).toBeNull();
    expect(parseDanmakuJump("好漫长的五分钟")).toBeNull();
    expect(parseDanmakuJump("原来才过去不到3分钟吗？")).toBeNull();
    expect(parseDanmakuJump("不是吧，才过去两分钟")).toBeNull();
  });
});

describe("Bilibili danmaku XML", () => {
  it("extracts jump hints from native danmaku and ignores meme numbers", () => {
    const xml = `<i><d p="1.2,1,25,16777215,0,0,0,0">空降8:16</d><d p="2.5,1,25,16777215,0,0,0,0">666</d><d p="3.5,1,25,16777215,0,0,0,0">八一六</d></i>`;
    const result = parseDanmakuXml(xml, 42);
    expect(result.total).toBe(3);
    expect(result.hints).toHaveLength(2);
    expect(result.hints[0]?.targetMs).toBe(496_000);
    expect(result.hints[1]?.targetMs).toBe(496_000);
  });
});
