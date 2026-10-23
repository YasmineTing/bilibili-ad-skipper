import type { DanmakuJumpHint } from "./danmaku";
import type { SegmentRange } from "./segment-window";

export interface JumpOption {
  targetMs: number;
  hint: DanmakuJumpHint;
  cluster: DanmakuJumpHint[];
  samples: string[];
}

export type JumpCandidateStatus = "available" | "past" | "beyond";

export interface JumpCandidate {
  targetMs: number;
  count: number;
  samples: string[];
  status: JumpCandidateStatus;
}

const BUCKET_MS = 2_000;
const TARGET_ROUND_MS = 1_000;
const MIN_PROMPT_LEAD_MS = 2_000;
const END_GUARD_MS = 300;
const NEARBY_LOOKBACK_MS = 3_000;
const NEARBY_LOOKAHEAD_MS = 1_000;
const MAX_OPTIONS = 10;

interface RankedBucket {
  bucket: DanmakuJumpHint[];
  hint: DanmakuJumpHint;
  samples: string[];
  targetMs: number;
  explicitCount: number;
  chineseCount: number;
  latest: number;
}

function rankBucket(bucket: DanmakuJumpHint[]): RankedBucket {
  const explicitCount = bucket.filter((hint) => hint.explicit).length;
  const chineseCount = bucket.filter((hint) => hint.kind === "chinese-digits").length;
  const latest = Math.max(...bucket.map((hint) => hint.atMs));
  const targetCounts = new Map<number, DanmakuJumpHint[]>();
  for (const hint of bucket) {
    const target = Math.round(hint.targetMs / TARGET_ROUND_MS) * TARGET_ROUND_MS;
    targetCounts.set(target, [...(targetCounts.get(target) ?? []), hint]);
  }
  const representativeGroup =
    Array.from(targetCounts.values()).sort(
      (a, b) => b.filter((hint) => hint.explicit).length - a.filter((hint) => hint.explicit).length || b.length - a.length
    )[0] ?? bucket;
  const hint = [...representativeGroup].sort((a, b) => Number(b.explicit) - Number(a.explicit) || b.atMs - a.atMs)[0] ?? bucket[0]!;
  const samples = Array.from(new Set(bucket.map((item) => item.text))).slice(0, 3);
  return { bucket, hint, samples, targetMs: hint.targetMs, explicitCount, chineseCount, latest };
}

/**
 * 把目标时间相近的弹幕合并成候选，明确语境和同类弹幕越多排得越前。
 */
export function groupDanmakuOptions(candidates: DanmakuJumpHint[], limit = MAX_OPTIONS): JumpOption[] {
  if (candidates.length === 0) return [];
  const buckets = new Map<number, DanmakuJumpHint[]>();
  for (const hint of candidates) {
    const key = Math.round(hint.targetMs / BUCKET_MS);
    const bucket = buckets.get(key) ?? [];
    bucket.push(hint);
    buckets.set(key, bucket);
  }
  return Array.from(buckets.values())
    .map(rankBucket)
    .sort(
      (a, b) =>
        b.explicitCount * 100 +
        b.chineseCount * 5 +
        b.bucket.length * 10 +
        b.latest / 1_000_000 -
        (a.explicitCount * 100 + a.chineseCount * 5 + a.bucket.length * 10 + a.latest / 1_000_000)
    )
    .slice(0, limit)
    .map((item) => ({ targetMs: item.targetMs, hint: item.hint, cluster: item.bucket, samples: item.samples }));
}

export function candidateStatus(targetMs: number, nowMs: number, durationMs: number): JumpCandidateStatus {
  if (targetMs <= nowMs + MIN_PROMPT_LEAD_MS) return "past";
  if (targetMs >= durationMs - END_GUARD_MS) return "beyond";
  return "available";
}

/**
 * 悬浮窗里提前展示的空降候选：可选的排前面，已过和超出视频的排后面。
 */
export function buildJumpCandidates(options: JumpOption[], nowMs: number, durationMs: number, limit = MAX_OPTIONS): JumpCandidate[] {
  const rank = (status: JumpCandidateStatus): number => (status === "available" ? 0 : status === "past" ? 1 : 2);
  return options
    .map((option, index) => ({ option, index, status: candidateStatus(option.targetMs, nowMs, durationMs) }))
    .sort((a, b) => rank(a.status) - rank(b.status) || a.index - b.index)
    .slice(0, limit)
    .map(({ option, status }) => ({
      targetMs: option.targetMs,
      count: option.cluster.length,
      samples: option.samples,
      status
    }));
}

export interface JumpHintQuery {
  hints: DanmakuJumpHint[];
  handledIds: ReadonlySet<string>;
  segment: SegmentRange;
  nowMs: number;
  durationMs: number;
}

/**
 * 只保留“发在广告附近、目标晚于广告结束且还没处理过”的弹幕。
 */
export function selectJumpHintsForSegment(query: JumpHintQuery): DanmakuJumpHint[] {
  const fromMs = Math.max(0, query.segment.startMs - 120_000);
  const toMs = query.segment.endMs + 10_000;
  const minimumTarget = Math.max(query.nowMs + MIN_PROMPT_LEAD_MS, query.segment.endMs + 500);
  return query.hints.filter(
    (hint) =>
      !query.handledIds.has(hint.id) &&
      hint.atMs >= fromMs &&
      hint.atMs <= toMs &&
      hint.targetMs > minimumTarget &&
      hint.targetMs < query.durationMs - END_GUARD_MS
  );
}

export interface NearbyJumpQuery {
  hints: DanmakuJumpHint[];
  handledIds: ReadonlySet<string>;
  nowMs: number;
  durationMs: number;
}

/**
 * 弹幕优先：只要空降弹幕刚从屏幕上飘过就纳入候选，不要求先命中广告片段。
 */
export function selectNearbyJumpHints(query: NearbyJumpQuery): DanmakuJumpHint[] {
  const fromMs = Math.max(0, query.nowMs - NEARBY_LOOKBACK_MS);
  const toMs = query.nowMs + NEARBY_LOOKAHEAD_MS;
  const minimumTarget = query.nowMs + MIN_PROMPT_LEAD_MS;
  return query.hints.filter(
    (hint) =>
      !query.handledIds.has(hint.id) &&
      hint.atMs >= fromMs &&
      hint.atMs <= toMs &&
      hint.targetMs > minimumTarget &&
      hint.targetMs < query.durationMs - END_GUARD_MS
  );
}

/** 孤立出现的纯数字弹幕太容易误触，至少要有明确语境或被多条弹幕重复。 */
export function isTrustworthyJumpOption(option: JumpOption): boolean {
  return option.hint.explicit || option.cluster.length >= 2;
}


