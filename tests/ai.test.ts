import { describe, expect, it } from "vitest";
import { createTranscriptChunks, parseAiSegments } from "../src/background/ai";
import type { Cue } from "../src/core/types";

function cue(index: number): Cue {
  return { id: `cue-${index}`, startMs: index * 10_000, endMs: index * 10_000 + 5_000, text: `第${index}句字幕` };
}

describe("AI transcript chunking", () => {
  it("covers every cue and adds overlap for boundaries", () => {
    const cues = Array.from({ length: 12 }, (_, index) => cue(index));
    const chunks = createTranscriptChunks(cues, 80, 2);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0]?.startIndex).toBe(0);
    expect(chunks.at(-1)?.endIndex).toBe(11);
    for (let index = 0; index < chunks.length - 1; index += 1) {
      expect(chunks[index + 1]!.startIndex).toBeLessThanOrEqual(chunks[index]!.endIndex);
    }
  });
});

describe("AI segment parsing", () => {
  const cues = Array.from({ length: 8 }, (_, index) => cue(index));
  const chunk = { cues: cues.slice(2, 6), startIndex: 2, endIndex: 5 };

  it("maps inclusive cue ids to subtitle times and filters low confidence", () => {
    const result = parseAiSegments(JSON.stringify({
      segments: [
        { start_cue: 2, end_cue: 4, confidence: 0.9 },
        { start_cue: 4, end_cue: 5, confidence: 0.4 }
      ]
    }), chunk, cues, 0.65);
    expect(result).toEqual([{ startCueIndex: 2, endCueIndex: 4, startMs: 20_000, endMs: 45_000, confidence: 0.9 }]);
  });

  it("accepts fenced JSON and ignores out-of-chunk ranges", () => {
    const result = parseAiSegments("```json\n{\"segments\":[{\"start_cue\":1,\"end_cue\":3,\"confidence\":0.8},{\"start_cue\":3,\"end_cue\":5,\"confidence\":0.8}]}\n```", chunk, cues, 0.5);
    expect(result).toHaveLength(1);
    expect(result[0]?.startCueIndex).toBe(3);
  });

  it("treats an empty array or a plain no-ad response as no detections", () => {
    expect(parseAiSegments("[]", chunk, cues, 0.5)).toEqual([]);
    expect(parseAiSegments("没有发现广告片段。", chunk, cues, 0.5)).toEqual([]);
  });

  it("accepts a bare JSON array of segment objects", () => {
    const result = parseAiSegments('[{"start_cue":2,"end_cue":3,"confidence":0.8}]', chunk, cues, 0.5);
    expect(result[0]?.startCueIndex).toBe(2);
    expect(result[0]?.endCueIndex).toBe(3);
  });

  it("rejects a response without a segments array", () => {
    expect(() => parseAiSegments('{"error":"bad"}', chunk, cues, 0.5)).toThrow("segments");
  });

  it("includes the model response preview when no JSON can be found", () => {
    expect(() => parseAiSegments("抱歉，我无法分析这段字幕", chunk, cues, 0.5)).toThrow("抱歉，我无法分析这段字幕");
  });
});
