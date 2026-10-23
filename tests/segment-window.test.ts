import { describe, expect, it } from "vitest";
import { isInsideSegment } from "../src/core/segment-window";

const segment = { startMs: 10_000, endMs: 20_000 };

describe("segment active window", () => {
  it("counts the start as inside and the last 100ms as outside", () => {
    expect(isInsideSegment(segment, 9_999)).toBe(false);
    expect(isInsideSegment(segment, 10_000)).toBe(true);
    expect(isInsideSegment(segment, 19_899)).toBe(true);
    expect(isInsideSegment(segment, 19_900)).toBe(false);
    expect(isInsideSegment(segment, 25_000)).toBe(false);
  });

  it("handles a segment starting at the very beginning of the video", () => {
    expect(isInsideSegment({ startMs: 0, endMs: 5_000 }, 0)).toBe(true);
    expect(isInsideSegment({ startMs: 0, endMs: 5_000 }, 4_899)).toBe(true);
    expect(isInsideSegment({ startMs: 0, endMs: 5_000 }, 4_900)).toBe(false);
    expect(isInsideSegment({ startMs: 0, endMs: 5_000 }, 5_000)).toBe(false);
  });
});
