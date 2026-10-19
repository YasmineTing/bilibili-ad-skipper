import type { DanmakuJumpHint } from "./danmaku";

export interface Cue {
  id: string;
  startMs: number;
  endMs: number;
  text: string;
}

export interface Segment {
  id: string;
  startMs: number;
  endMs: number;
  hitCueIds: string[];
  matchedKeywords: string[];
  adContextTerms: string[];
  aiConfidence?: number;
  cues: Cue[];
}

export interface PinnedCommentEvidence {
  found: boolean;
  author?: string;
  text?: string;
  keyword?: string;
}

export interface SubtitleBundle {
  bvid: string;
  aid: number;
  cid: number;
  page: number;
  title: string;
  partTitle: string;
  durationMs: number;
  language: string;
  cues: Cue[];
  commentEvidence: PinnedCommentEvidence | null;
}

export interface AiSegmentResult {
  startCueIndex: number;
  endCueIndex: number;
  startMs: number;
  endMs: number;
  confidence: number;
}

export type BackgroundRequest =
  | { type: "loadSubtitles"; bvid?: string; aid?: number; page: number; keywords: string[]; includeCommentEvidence: boolean }
  | { type: "analyzeAdsWithAi"; title: string; durationMs: number; cues: Cue[] }
  | { type: "loadDanmaku"; cid?: number; bvid?: string; aid?: number; page: number };

export interface BackgroundError {
  ok: false;
  code: "video_not_found" | "no_subtitles" | "login_required" | "subtitle_loading" | "network" | "invalid_data";
  message: string;
}

export interface BackgroundSuccess {
  ok: true;
  data: SubtitleBundle;
}

export type BackgroundResponse = BackgroundSuccess | BackgroundError;

export type AiAnalysisResponse =
  | { ok: true; segments: AiSegmentResult[]; model: string }
  | { ok: false; message: string };

export type DanmakuResponse =
  | { ok: true; cid: number; hints: DanmakuJumpHint[]; total: number }
  | { ok: false; message: string };
