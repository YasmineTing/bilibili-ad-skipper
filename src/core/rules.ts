import { searchText } from "./segments";
import type { Cue, Segment } from "./types";

export interface CustomRule {
  id: string;
  name: string;
  enabled: boolean;
  /** 任一命中即视为候选句 */
  keywords: string[];
  /** 整段命中里必须全部出现的词 */
  required: string[];
  /** 出现任一排除词的句子不参与命中 */
  exclude: string[];
  /** 可选正则，与 keywords 是“或”的关系 */
  pattern: string;
  /** 至少需要多少句命中才算一个片段 */
  minHits: number;
  beforeSeconds: number;
  afterSeconds: number;
}

export interface RulePack {
  version: number;
  name: string;
  rules: CustomRule[];
}

export const MAX_RULES = 64;
export const MAX_TERMS = 40;
export const MAX_TERM_LENGTH = 40;
export const MAX_PATTERN_LENGTH = 200;

export class RuleImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RuleImportError";
  }
}

function readString(value: unknown): string {
  return typeof value === "string" ? value.normalize("NFKC").trim() : "";
}

function readTerms(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const output: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== "string") continue;
    const term = item.normalize("NFKC").trim().replace(/\s+/g, " ");
    if (!term || term.length > MAX_TERM_LENGTH) continue;
    const identity = term.toLocaleLowerCase();
    if (seen.has(identity)) continue;
    seen.add(identity);
    output.push(term);
    if (output.length >= MAX_TERMS) break;
  }
  return output;
}

function clampNumber(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function readRule(raw: unknown, index: number): CustomRule {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new RuleImportError(`第 ${index + 1} 条规则格式不正确，应为对象`);
  }
  const record = raw as Record<string, unknown>;
  const name = readString(record.name) || `规则 ${index + 1}`;
  const keywords = readTerms(record.keywords);
  const required = readTerms(record.required);
  const exclude = readTerms(record.exclude);
  const pattern = readString(record.pattern);
  if (pattern.length > MAX_PATTERN_LENGTH) {
    throw new RuleImportError(`规则「${name}」的正则超过 ${MAX_PATTERN_LENGTH} 个字符`);
  }
  if (keywords.length === 0 && !pattern) {
    throw new RuleImportError(`规则「${name}」至少需要填写 keywords 或 pattern`);
  }
  if (pattern) {
    try {
      new RegExp(pattern, "i");
    } catch (error) {
      throw new RuleImportError(`规则「${name}」的正则无效：${error instanceof Error ? error.message : "无法解析"}`);
    }
  }
  const rawId = readString(record.id);
  return {
    id: rawId && rawId.length <= 64 ? rawId : `rule-${index + 1}`,
    name,
    enabled: record.enabled !== false,
    keywords,
    required,
    exclude,
    pattern,
    minHits: Math.round(clampNumber(record.minHits, 1, 1, 20)),
    beforeSeconds: clampNumber(record.beforeSeconds, 0.5, 0, 10),
    afterSeconds: clampNumber(record.afterSeconds, 1.5, 0, 30)
  };
}

/**
 * 严格导入：任何一条规则有问题都会抛出带规则名的错误，用于设置页。
 */
export function parseRulePack(input: string | unknown): CustomRule[] {
  let data: unknown = input;
  if (typeof input === "string") {
    try {
      data = JSON.parse(input) as unknown;
    } catch (error) {
      throw new RuleImportError(`JSON 解析失败：${error instanceof Error ? error.message : "无法解析"}`);
    }
  }
  const list = Array.isArray(data)
    ? data
    : data && typeof data === "object" && Array.isArray((data as { rules?: unknown }).rules)
      ? (data as { rules: unknown[] }).rules
      : null;
  if (!list) throw new RuleImportError("规则文件需要是数组，或包含 rules 数组的对象");
  if (list.length > MAX_RULES) throw new RuleImportError(`最多支持 ${MAX_RULES} 条规则，当前 ${list.length} 条`);

  const rules = list.map((item, index) => readRule(item, index));
  const seen = new Set<string>();
  return rules.map((rule, index) => {
    if (!seen.has(rule.id)) {
      seen.add(rule.id);
      return rule;
    }
    return { ...rule, id: `${rule.id}-${index + 1}` };
  });
}

/**
 * 宽松读取：用于已保存的设置，坏规则直接丢弃，不影响其他规则。
 */
export function sanitizeRules(value: unknown): CustomRule[] {
  if (!Array.isArray(value)) return [];
  const output: CustomRule[] = [];
  for (const [index, item] of value.slice(0, MAX_RULES).entries()) {
    try {
      output.push(readRule(item, index));
    } catch {
      // 单条坏规则不应让整份设置失效。
    }
  }
  return output;
}

export interface CompiledRule {
  rule: CustomRule;
  keywords: string[];
  required: string[];
  exclude: string[];
  regex: RegExp | null;
}

export function compileRules(rules: CustomRule[]): CompiledRule[] {
  return rules.flatMap((rule) => {
    if (!rule.enabled) return [];
    const keywords = rule.keywords.map(searchText).filter(Boolean);
    const required = rule.required.map(searchText).filter(Boolean);
    const exclude = rule.exclude.map(searchText).filter(Boolean);
    let regex: RegExp | null = null;
    if (rule.pattern) {
      try {
        regex = new RegExp(rule.pattern, "i");
      } catch {
        return [];
      }
    }
    if (keywords.length === 0 && !regex) return [];
    return [{ rule, keywords, required, exclude, regex }];
  });
}

interface RuleHit {
  cue: Cue;
  terms: string[];
}

function matchCue(compiled: CompiledRule, cue: Cue): RuleHit | null {
  const haystack = searchText(cue.text);
  if (compiled.exclude.some((term) => haystack.includes(term))) return null;
  const terms = compiled.keywords.filter((term) => haystack.includes(term));
  const regexHit = compiled.regex ? compiled.regex.test(cue.text.normalize("NFKC")) : false;
  if (terms.length === 0 && !regexHit) return null;
  return { cue, terms: regexHit ? [...terms, "正则"] : terms };
}

export interface RuleSegmentOptions {
  mergeGapMs: number;
  durationMs?: number;
}

/**
 * 把自定义规则命中转换成与内置规则同构的广告片段。
 * keywords 是“或”，required 是“整段必须都有”，exclude 会直接排除该句。
 */
export function buildRuleSegments(cues: Cue[], rules: CustomRule[], options: RuleSegmentOptions): Segment[] {
  if (cues.length === 0 || rules.length === 0) return [];
  const validCues = cues
    .filter((cue) => Number.isFinite(cue.startMs) && Number.isFinite(cue.endMs) && cue.endMs > cue.startMs && cue.text.trim())
    .sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);
  if (validCues.length === 0) return [];

  const durationMs =
    typeof options.durationMs === "number" && Number.isFinite(options.durationMs) && options.durationMs > 0
      ? options.durationMs
      : Number.POSITIVE_INFINITY;
  const gapMs = Math.max(0, options.mergeGapMs);
  const indexById = new Map(validCues.map((cue, index) => [cue.id, index]));
  const segments: Segment[] = [];

  for (const compiled of compileRules(rules)) {
    const { rule } = compiled;
    const hits: RuleHit[] = [];
    for (const cue of validCues) {
      const hit = matchCue(compiled, cue);
      if (hit) hits.push(hit);
    }
    if (hits.length === 0) continue;

    const groups: RuleHit[][] = [];
    let group: RuleHit[] = [];
    for (const hit of hits) {
      const previous = group.at(-1);
      if (previous && hit.cue.startMs - previous.cue.endMs > gapMs) {
        groups.push(group);
        group = [];
      }
      group.push(hit);
    }
    if (group.length > 0) groups.push(group);

    for (const groupHits of groups) {
      if (groupHits.length < rule.minHits) continue;
      const first = groupHits[0];
      const last = groupHits.at(-1);
      if (!first || !last) continue;
      const firstIndex = indexById.get(first.cue.id) ?? 0;
      const lastIndex = indexById.get(last.cue.id) ?? firstIndex;
      const spanCues = validCues.slice(firstIndex, lastIndex + 1);
      const groupText = searchText(spanCues.map((cue) => cue.text).join(" "));
      if (!compiled.required.every((term) => groupText.includes(term))) continue;

      const startMs = Math.max(0, first.cue.startMs - rule.beforeSeconds * 1000);
      const endMs = Math.min(durationMs, last.cue.endMs + rule.afterSeconds * 1000);
      if (endMs <= startMs) continue;

      segments.push({
        id: `rule:${rule.id}:${first.cue.id}:${last.cue.id}:${Math.round(startMs)}:${Math.round(endMs)}`,
        startMs,
        endMs,
        hitCueIds: groupHits.map((hit) => hit.cue.id),
        matchedKeywords: Array.from(new Set(groupHits.flatMap((hit) => hit.terms))),
        adContextTerms: [],
        ruleName: rule.name,
        cues: spanCues
      });
    }
  }

  return segments;
}
