import type { Settings } from "../settings";
import type { Cue, Segment } from "./types";
import { matchAdContext, type AdContextMatch } from "./ad-context";

const MAX_CONTEXT_BRIDGE_MS = 30_000;
const MAX_CONTEXT_HOLE_MS = 8_000;
const INTRO_LOOKBACK_MS = 2_000;
const TAIL_LOOKAHEAD_MS = 2_000;
const MAX_TAIL_EXTENSION_MS = 15_000;
const MAX_GENERIC_SIGNAL_GAP_MS = 20_000;
const MAX_GENERIC_SPAN_MS = 120_000;
const MIN_GENERIC_SPAN_MS = 8_000;
const SEGMENT_MERGE_GAP_MS = 1_000;

interface ProductHit {
  cue: Cue;
  index: number;
  matches: string[];
}

interface ContextSignal {
  cue: Cue;
  index: number;
  context: AdContextMatch;
}

export function searchText(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase().replace(/[\s\u200b-\u200d\ufeff]+/g, "");
}

export function matchedKeywords(text: string, keywords: string[]): string[] {
  const haystack = searchText(text);
  return keywords.filter((keyword) => haystack.includes(searchText(keyword)));
}

function segmentId(first: Cue, last: Cue, startMs: number, endMs: number, prefix = "product"): string {
  return `${prefix}:${first.id}:${last.id}:${Math.round(startMs)}:${Math.round(endMs)}`;
}

export function mergeSegmentList(segments: Segment[]): Segment[] {
  const sorted = [...segments].sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);
  const merged: Segment[] = [];
  for (const segment of sorted) {
    const previous = merged.at(-1);
    if (!previous || segment.startMs > previous.endMs + SEGMENT_MERGE_GAP_MS) {
      merged.push({ ...segment, cues: [...segment.cues] });
      continue;
    }
    const cueMap = new Map(previous.cues.map((cue) => [cue.id, cue]));
    for (const cue of segment.cues) cueMap.set(cue.id, cue);
    previous.cues = Array.from(cueMap.values()).sort((a, b) => a.startMs - b.startMs);
    previous.endMs = Math.max(previous.endMs, segment.endMs);
    previous.hitCueIds = Array.from(new Set([...previous.hitCueIds, ...segment.hitCueIds]));
    previous.matchedKeywords = Array.from(new Set([...previous.matchedKeywords, ...segment.matchedKeywords]));
    previous.adContextTerms = Array.from(new Set([...previous.adContextTerms, ...segment.adContextTerms]));
    if (segment.aiConfidence != null) {
      previous.aiConfidence = Math.max(previous.aiConfidence ?? 0, segment.aiConfidence);
    }
    previous.ruleName ??= segment.ruleName;
  }
  return merged;
}

export function buildSegments(cues: Cue[], keywords: string[], settings: Settings, videoDurationMs?: number): Segment[] {
  if (cues.length === 0 || (keywords.length === 0 && !settings.detectContextAds)) return [];

  const validCues = cues
    .filter((cue) => Number.isFinite(cue.startMs) && Number.isFinite(cue.endMs) && cue.endMs > cue.startMs && cue.text.trim())
    .sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);
  if (validCues.length === 0) return [];

  const totalMs = typeof videoDurationMs === "number" && Number.isFinite(videoDurationMs) && videoDurationMs > 0
    ? videoDurationMs
    : Number.POSITIVE_INFINITY;
  const contexts = validCues.map((cue) => matchAdContext(cue.text));
  const productMatches = validCues.map((cue) => matchedKeywords(cue.text, keywords));

  const finalizeCandidate = (
    startIndex: number,
    endIndex: number,
    hitCueIds: string[],
    knownKeywords: string[],
    prefix: string
  ): Segment | null => {
    const first = validCues[startIndex];
    const last = validCues[endIndex];
    if (!first || !last) return null;
    const rawStart = first.startMs;
    const rawEnd = last.endMs;
    let startMs = Math.max(0, rawStart - settings.beforeBufferSeconds * 1000);
    let endMs = Math.min(totalMs, rawEnd + settings.afterBufferSeconds * 1000);

    const previousCue = validCues[startIndex - 1];
    const previousContext = contexts[startIndex - 1];
    if (previousCue && previousContext && previousCue.endMs > startMs && productMatches[startIndex - 1]?.length === 0 &&
      !previousContext.intro && !previousContext.offer && !previousContext.cta) {
      startMs = previousCue.endMs;
    }
    const nextCue = validCues[endIndex + 1];
    const nextContext = contexts[endIndex + 1];
    if (nextCue && nextContext && nextCue.startMs < endMs && productMatches[endIndex + 1]?.length === 0 &&
      (nextContext.reset || (!nextContext.intro && !nextContext.offer && !nextContext.cta))) {
      endMs = Math.max(rawEnd, nextCue.startMs);
    }
    if (endMs <= startMs) return null;

    const included = validCues.slice(startIndex, endIndex + 1);
    const matched = Array.from(new Set([
      ...knownKeywords,
      ...included.flatMap((_, offset) => productMatches[startIndex + offset] ?? [])
    ]));
    const adContextTerms = Array.from(new Set(
      contexts.slice(startIndex, endIndex + 1).flatMap((context) => context.terms)
    ));
    return {
      id: segmentId(first, last, startMs, endMs, prefix),
      startMs,
      endMs,
      hitCueIds,
      matchedKeywords: matched,
      adContextTerms,
      cues: included
    };
  };

  const productSegments: Segment[] = [];
  if (keywords.length > 0) {
    const hits: ProductHit[] = validCues.flatMap((cue, index) =>
      (productMatches[index]?.length ?? 0) > 0 ? [{ cue, index, matches: productMatches[index] ?? [] }] : []
    );
    const groups: ProductHit[][] = [];
    let group: ProductHit[] = [];
    const gapMs = settings.mergeGapSeconds * 1000;

    const canBridgeContext = (left: ProductHit, right: ProductHit): boolean => {
      const gap = right.cue.startMs - left.cue.endMs;
      if (gap <= gapMs || gap > MAX_CONTEXT_BRIDGE_MS) return gap <= gapMs;
      const between = validCues.slice(left.index + 1, right.index);
      if (between.length === 0) return false;
      let previousEnd = left.cue.endMs;
      for (const cue of between) {
        if (cue.startMs - previousEnd > MAX_CONTEXT_HOLE_MS) return false;
        previousEnd = cue.endMs;
      }
      if (right.cue.startMs - previousEnd > MAX_CONTEXT_HOLE_MS) return false;

      const betweenContexts = contexts.slice(left.index + 1, right.index);
      if (betweenContexts.some((context) => context.reset)) return false;
      const contextCues = betweenContexts.filter((context) => context.intro || context.offer || context.cta).length;
      const contextTerms = new Set(betweenContexts.flatMap((context) => context.terms));
      return (contextCues >= 2 && contextCues / between.length >= 0.25) || contextTerms.size >= 3;
    };

    for (const hit of hits) {
      const previous = group.at(-1);
      if (previous && !canBridgeContext(previous, hit)) {
        groups.push(group);
        group = [];
      }
      group.push(hit);
    }
    if (group.length > 0) groups.push(group);

    for (const groupHits of groups) {
      const firstHit = groupHits[0];
      const finalHit = groupHits.at(-1);
      if (!firstHit || !finalHit) continue;
      let startIndex = firstHit.index;
      let cursorStart = firstHit.cue.startMs;
      while (startIndex > 0) {
        const previous = validCues[startIndex - 1];
        const context = contexts[startIndex - 1];
        if (!previous || !context || cursorStart - previous.endMs > INTRO_LOOKBACK_MS || context.reset || !context.intro) break;
        startIndex -= 1;
        cursorStart = previous.startMs;
      }

      let endIndex = finalHit.index;
      let cursorEnd = finalHit.cue.endMs;
      while (endIndex + 1 < validCues.length && cursorEnd - finalHit.cue.endMs <= MAX_TAIL_EXTENSION_MS) {
        const next = validCues[endIndex + 1];
        const context = contexts[endIndex + 1];
        if (!next || !context || next.startMs - cursorEnd > TAIL_LOOKAHEAD_MS || context.reset ||
          (!context.intro && !context.offer && !context.cta)) break;
        endIndex += 1;
        cursorEnd = next.endMs;
      }

      const segment = finalizeCandidate(
        startIndex,
        endIndex,
        groupHits.map((hit) => hit.cue.id),
        Array.from(new Set(groupHits.flatMap((hit) => hit.matches))),
        "product"
      );
      if (segment) productSegments.push(segment);
    }
  }

  const genericSegments: Segment[] = [];
  if (settings.detectContextAds) {
    const signals: ContextSignal[] = validCues.flatMap((cue, index) => {
      const context = contexts[index];
      if (!context || context.reset || (!context.intro && !context.offer && !context.cta)) return [];
      return [{ cue, index, context }];
    });
    const signalGroups: ContextSignal[][] = [];
    let current: ContextSignal[] = [];
    for (const signal of signals) {
      const previous = current.at(-1);
      const first = current[0];
      if (previous && first) {
        const hasResetBetween = validCues
          .slice(previous.index + 1, signal.index)
          .some((_, offset) => contexts[previous.index + 1 + offset]?.reset);
        const outOfGap = signal.cue.startMs - previous.cue.endMs > MAX_GENERIC_SIGNAL_GAP_MS;
        const outOfSpan = signal.cue.endMs - first.cue.startMs > MAX_GENERIC_SPAN_MS;
        if (hasResetBetween || outOfGap || outOfSpan) {
          signalGroups.push(current);
          current = [];
        }
      }
      current.push(signal);
    }
    if (current.length > 0) signalGroups.push(current);

    for (const signalGroup of signalGroups) {
      const first = signalGroup[0];
      const last = signalGroup.at(-1);
      if (!first || !last) continue;
      const span = last.cue.endMs - first.cue.startMs;
      if (span < MIN_GENERIC_SPAN_MS) continue;
      const groupContexts = signalGroup.map((signal) => signal.context);
      const introTerms = new Set(groupContexts.flatMap((context) => context.introTerms));
      const strongTerms = new Set(groupContexts.flatMap((context) => context.strongTerms));
      const weakTerms = new Set(groupContexts.flatMap((context) => context.weakTerms));
      const ctaTerms = new Set(groupContexts.flatMap((context) => context.ctaTerms));
      const allTerms = new Set(groupContexts.flatMap((context) => context.terms));
      const hasPrice = groupContexts.some((context) => context.price);
      const hasDisclosure = ["赞助", "品牌赞助", "广告", "恰饭", "商务合作"].some((term) => strongTerms.has(term));
      const qualified =
        (hasDisclosure && (weakTerms.size >= 1 || strongTerms.size >= 2) && allTerms.size >= 3) ||
        (introTerms.size > 0 && strongTerms.size >= 1 && weakTerms.size >= 2 && ctaTerms.size >= 1 && allTerms.size >= 5) ||
        (introTerms.size > 0 && strongTerms.size >= 1 && ctaTerms.size >= 1 && allTerms.size >= 4) ||
        (strongTerms.size >= 2 && weakTerms.size >= 2 && allTerms.size >= 5) ||
        (strongTerms.size >= 1 && weakTerms.size >= 4 && ctaTerms.size >= 1 && (hasPrice || allTerms.size >= 6)) ||
        (introTerms.size > 0 && weakTerms.size >= 6 && ctaTerms.size >= 1 && allTerms.size >= 8);
      if (!qualified) continue;

      const startSignal = signalGroup.find((signal) => signal.context.intro || signal.context.strong) ?? first;
      const lastStrongOrCta = [...signalGroup].reverse().find((signal) => signal.context.strong || signal.context.cta);
      const endSignal = lastStrongOrCta ?? last;
      const segment = finalizeCandidate(
        startSignal.index,
        endSignal.index,
        signalGroup.filter((signal) => signal.index >= startSignal.index && signal.index <= endSignal.index).map((signal) => signal.cue.id),
        [],
        "context"
      );
      if (segment) genericSegments.push(segment);
    }
  }

  return mergeSegmentList([...productSegments, ...genericSegments]);
}

export function nextCueForTarget(cues: Cue[], targetMs: number): Cue | undefined {
  return cues.find((cue) => cue.startMs >= targetMs);
}
