import { describe, expect, it } from "vitest";
import {
  buildJumpCandidates,
  candidateStatus,
  groupDanmakuOptions,
  isTrustworthyJumpOption,
  selectJumpHintsForSegment,
  selectNearbyJumpHints,
  type JumpOption
} from "../src/core/jump-options";
import type { DanmakuJumpHint } from "../src/core/danmaku";

function hint(
  id: string,
  atSec: number,
  targetSec: number,
  text: string,
  explicit = true,
  kind: DanmakuJumpHint["kind"] = "time"
): DanmakuJumpHint {
  return { id, atMs: atSec * 1000, targetMs: targetSec * 1000, text, explicit, kind };
}

describe("danmaku jump grouping", () => {
  it("merges hints pointing at the same second and keeps the explicit one as representative", () => {
    const options = groupDanmakuOptions([
      hint("a", 100, 496, "空降8:16"),
      hint("b", 120, 496, "空降8:16"),
      hint("c", 110, 496.5, "八一六", false, "chinese-digits"),
      hint("d", 130, 512, "跳到8:32")
    ]);
    expect(options).toHaveLength(2);
    expect(options[0]?.targetMs).toBe(496_000);
    expect(options[0]?.hint.id).toBe("b");
    expect(options[0]?.cluster).toHaveLength(3);
    expect(options[0]?.samples).toContain("空降8:16");
    expect(options[1]?.targetMs).toBe(512_000);
  });

  it("prefers bigger and more explicit clusters", () => {
    const options = groupDanmakuOptions([
      hint("single", 10, 300, "空降5:00"),
      hint("x1", 20, 420, "空降7:00"),
      hint("x2", 21, 420.2, "空降7:00", false),
      hint("x3", 22, 420.6, "空降7:01", false)
    ]);
    expect(options[0]?.targetMs).toBe(420_000);
    expect(options[0]?.cluster).toHaveLength(3);
  });

  it("caps the number of candidates", () => {
    const hints = Array.from({ length: 12 }, (_, index) => hint(`h${index}`, 10 + index, 300 + index * 10, `空降${index}`));
    expect(groupDanmakuOptions(hints, 5)).toHaveLength(5);
    expect(groupDanmakuOptions([])).toEqual([]);
  });
});

describe("jump candidate status", () => {
  it("marks targets inside the guard windows as past or beyond", () => {
    expect(candidateStatus(100_000, 99_000, 600_000)).toBe("past");
    expect(candidateStatus(200_000, 100_000, 600_000)).toBe("available");
    expect(candidateStatus(599_800, 100_000, 600_000)).toBe("beyond");
  });

  it("lists available targets before past and beyond ones", () => {
    const options: JumpOption[] = [
      { targetMs: 100_000, hint: hint("a", 1, 100, "x"), cluster: [hint("a", 1, 100, "x")], samples: ["x"] },
      { targetMs: 400_000, hint: hint("b", 1, 400, "y"), cluster: [hint("b", 1, 400, "y")], samples: ["y"] },
      { targetMs: 900_000, hint: hint("c", 1, 900, "z"), cluster: [hint("c", 1, 900, "z")], samples: ["z"] }
    ];
    const candidates = buildJumpCandidates(options, 300_000, 800_000);
    expect(candidates.map((item) => item.status)).toEqual(["available", "past", "beyond"]);
    expect(candidates[0]?.targetMs).toBe(400_000);
    expect(candidates[0]).not.toHaveProperty("order");
  });
});

describe("jump hints for an active segment", () => {
  const segment = { startMs: 600_000, endMs: 660_000 };
  const base = { segment, nowMs: 610_000, durationMs: 1_800_000, handledIds: new Set<string>() };

  it("keeps hints posted near the segment whose target lands after it", () => {
    const hints = [hint("ok", 605, 670, "空降11:10"), hint("edge", 670, 700, "空降11:40")];
    expect(selectJumpHintsForSegment({ ...base, hints }).map((item) => item.id)).toEqual(["ok", "edge"]);
  });

  it("drops targets that end inside the segment or too close to the current position", () => {
    const hints = [hint("inside", 605, 655, "空降10:55"), hint("tooSoon", 605, 612, "空降10:12")];
    expect(selectJumpHintsForSegment({ ...base, hints })).toEqual([]);
  });

  it("drops hints posted too early or already handled", () => {
    const hints = [hint("far", 400, 700, "空降11:40"), hint("handled", 605, 700, "空降11:40")];
    const handledIds = new Set(["handled"]);
    expect(selectJumpHintsForSegment({ ...base, hints, handledIds })).toEqual([]);
  });

  it("drops targets beyond the video duration", () => {
    const hints = [hint("late", 605, 1_799.9, "空降29:59")];
    expect(selectJumpHintsForSegment({ ...base, hints })).toEqual([]);
  });
});

describe("danmaku priority without an ad segment", () => {
  const base = { nowMs: 30_000, durationMs: 1_800_000, handledIds: new Set<string>() };

  it("keeps hints that just flew across the screen", () => {
    const hints = [
      hint("justNow", 29, 496, "空降8:16"),
      hint("ahead", 30.8, 500, "跳到8:20"),
      hint("old", 24, 600, "空降10:00")
    ];
    expect(selectNearbyJumpHints({ ...base, hints }).map((item) => item.id)).toEqual(["justNow", "ahead"]);
  });

  it("ignores hints whose target is too close or already handled", () => {
    const hints = [hint("tooSoon", 30, 31, "空降0:31"), hint("handled", 30, 500, "空降8:20")];
    expect(selectNearbyJumpHints({ ...base, hints, handledIds: new Set(["handled"]) })).toEqual([]);
  });

  it("requires an explicit hint or a repeated one before prompting on its own", () => {
    const bare = groupDanmakuOptions([hint("bare", 30, 496, "八一六", false, "chinese-digits")])[0]!;
    expect(isTrustworthyJumpOption(bare)).toBe(false);
    const repeated = groupDanmakuOptions([
      hint("r1", 30, 496, "八一六", false, "chinese-digits"),
      hint("r2", 31, 496, "八一六", false, "chinese-digits")
    ])[0]!;
    expect(isTrustworthyJumpOption(repeated)).toBe(true);
    const explicit = groupDanmakuOptions([hint("explicit", 30, 496, "空降8:16")])[0]!;
    expect(isTrustworthyJumpOption(explicit)).toBe(true);
  });
});
