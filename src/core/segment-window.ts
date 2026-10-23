export interface SegmentRange {
  startMs: number;
  endMs: number;
}

/** 片段末尾 100ms 不再算作“仍在片段内”，避免刚好停在结尾时反复命中。 */
export const SEGMENT_ACTIVE_TAIL_MS = 100;

export function isInsideSegment(segment: SegmentRange, nowMs: number): boolean {
  return nowMs >= segment.startMs && nowMs < segment.endMs - SEGMENT_ACTIVE_TAIL_MS;
}
