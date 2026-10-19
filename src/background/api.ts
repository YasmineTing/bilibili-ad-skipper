import { matchedKeywords } from "../core/segments";
import type { Cue, PinnedCommentEvidence, SubtitleBundle } from "../core/types";

interface ViewResponse {
  code: number;
  message: string;
  data?: {
    aid: number;
    bvid: string;
    title: string;
    pages?: Array<{ cid: number; page: number; part: string; duration: number }>;
    cid?: number;
    duration?: number;
  };
}

interface PlayerResponse {
  code: number;
  message: string;
  data?: {
    aid: number;
    bvid: string;
    cid: number;
    need_login_subtitle?: boolean;
    subtitle?: {
      subtitles?: Array<{ id?: number; lan: string; lan_doc: string; subtitle_url: string; is_lock?: boolean }>;
    };
  };
}

interface SubtitleFile {
  body?: Array<{ from: number; to: number; content: string } | { fromMs: number; toMs: number; text: string }>;
}

interface BaseBundle {
  bvid: string;
  aid: number;
  cid: number;
  page: number;
  title: string;
  partTitle: string;
  durationMs: number;
  language: string;
  cues: Cue[];
}

export class BiliApiError extends Error {
  constructor(
    readonly code: "video_not_found" | "no_subtitles" | "login_required" | "subtitle_loading" | "network" | "invalid_data",
    message: string
  ) {
    super(message);
    this.name = "BiliApiError";
  }
}

const baseCache = new Map<string, BaseBundle>();
const pageCache = new Map<string, number>();

export async function resolveVideoCid(request: { bvid?: string; aid?: number; page: number }): Promise<number> {
  if (!request.bvid && !request.aid) throw new BiliApiError("video_not_found", "缺少视频编号，无法读取弹幕");
  const cacheKey = `${request.bvid ?? `av${request.aid}`}:${request.page}`;
  const cached = pageCache.get(cacheKey);
  if (cached) return cached;
  const query = request.bvid ? `bvid=${encodeURIComponent(request.bvid)}` : `aid=${request.aid}`;
  const view = await fetchJson<ViewResponse>(`https://api.bilibili.com/x/web-interface/view?${query}`);
  if (view.code !== 0 || !view.data) throw new BiliApiError("video_not_found", view.message || "找不到该视频");
  const page = view.data.pages?.find((item) => item.page === request.page) ?? view.data.pages?.[request.page - 1];
  const cid = page?.cid ?? view.data.cid;
  if (!cid) throw new BiliApiError("invalid_data", "视频缺少分 P 信息");
  pageCache.set(cacheKey, cid);
  return cid;
}

async function fetchJson<T>(url: string): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, {
      credentials: "include",
      headers: { Accept: "application/json, text/plain, */*" },
      signal: AbortSignal.timeout(15_000)
    });
  } catch (error) {
    throw new BiliApiError("network", `无法连接 B 站接口：${error instanceof Error ? error.message : "网络错误"}`);
  }
  if (!response.ok) throw new BiliApiError("network", `B 站接口返回 HTTP ${response.status}`);
  try {
    return await response.json() as T;
  } catch {
    throw new BiliApiError("invalid_data", "B 站接口返回的数据不是有效 JSON");
  }
}

function normalizeSubtitleUrl(value: string): string {
  if (value.startsWith("//")) return `https:${value}`;
  if (value.startsWith("http://")) return value.replace("http://", "https://");
  return value;
}

function stripMarkup(value: string): string {
  return value
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function rankSubtitles(subtitles: Array<{ lan: string; lan_doc: string; subtitle_url: string }>) {
  const score = (lan: string): number => {
    const value = lan.toLowerCase();
    if (value === "zh-cn" || value === "zh-hans") return 100;
    if (value.includes("ai-zh")) return 90;
    if (value.startsWith("zh")) return 80;
    if (value.includes("en")) return 20;
    return 10;
  };
  return [...subtitles].filter((item) => item.subtitle_url).sort((a, b) => score(b.lan) - score(a.lan));
}

function parseSubtitles(file: SubtitleFile, cid: number): Cue[] {
  if (!Array.isArray(file.body)) return [];
  const cues: Cue[] = [];
  file.body.forEach((item, index) => {
    const startMs = "from" in item ? Number(item.from) * 1000 : Number(item.fromMs);
    const endMs = "to" in item ? Number(item.to) * 1000 : Number(item.toMs);
    const text = stripMarkup("content" in item ? item.content : item.text);
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs || !text) return;
    cues.push({ id: `${cid}:${index}:${Math.round(startMs)}`, startMs, endMs, text });
  });
  return cues
    .sort((a, b) => a.startMs - b.startMs)
    .filter((cue, index, all) => index === 0 || cue.startMs !== all[index - 1]?.startMs || cue.text !== all[index - 1]?.text);
}

async function loadBaseBundle(bvid: string | undefined, aid: number | undefined, pageNumber: number): Promise<BaseBundle> {
  if (!bvid && !aid) throw new BiliApiError("video_not_found", "当前页面没有识别到 B 站视频编号");
  const cacheKey = `${bvid ?? `av${aid}`}:${pageNumber}`;
  const cached = baseCache.get(cacheKey);
  if (cached) return cached;

  const viewQuery = bvid ? `bvid=${encodeURIComponent(bvid)}` : `aid=${aid}`;
  const view = await fetchJson<ViewResponse>(`https://api.bilibili.com/x/web-interface/view?${viewQuery}`);
  if (view.code !== 0 || !view.data) throw new BiliApiError("video_not_found", view.message || "找不到该视频");

  const page = view.data.pages?.find((item) => item.page === pageNumber) ?? view.data.pages?.[pageNumber - 1];
  const cid = page?.cid ?? view.data.cid;
  const durationSeconds = page?.duration ?? view.data.duration;
  if (!cid || typeof durationSeconds !== "number" || !Number.isFinite(durationSeconds)) {
    throw new BiliApiError("invalid_data", "视频缺少分 P 或时长信息");
  }

  let player: PlayerResponse | null = null;
  for (const endpoint of ["https://api.bilibili.com/x/player/wbi/v2", "https://api.bilibili.com/x/player/v2"]) {
    const playerUrl = new URL(endpoint);
    playerUrl.searchParams.set("aid", String(view.data.aid));
    playerUrl.searchParams.set("cid", String(cid));
    try {
      const candidate = await fetchJson<PlayerResponse>(playerUrl.toString());
      if (candidate.code === 0 && candidate.data) {
        player = candidate;
        break;
      }
    } catch {
      // Some videos expose captions through only one of the player endpoints.
    }
  }
  if (!player || player.code !== 0 || !player.data) {
    throw new BiliApiError("video_not_found", player?.message || "无法读取播放器信息");
  }

  const subtitles = player.data.subtitle?.subtitles ?? [];
  const ranked = rankSubtitles(subtitles);
  if (ranked.length === 0) {
    if (subtitles.length > 0 && !player.data.need_login_subtitle) {
      throw new BiliApiError("subtitle_loading", "B 站字幕仍在准备中，正在自动重试。");
    }
    const message = player.data.need_login_subtitle
      ? "没有可用字幕。若视频显示有字幕，请先在 B 站登录后刷新页面。"
      : "这个视频在当前播放器里没有可用字幕。";
    throw new BiliApiError(player.data.need_login_subtitle ? "login_required" : "no_subtitles", message);
  }

  let best: { selected: (typeof ranked)[number]; cues: Cue[]; coverage: number } | null = null;
  const candidates = ranked.slice(0, 3);
  for (const selected of candidates) {
    try {
      const subtitleFile = await fetchJson<SubtitleFile>(normalizeSubtitleUrl(selected.subtitle_url));
      const cues = parseSubtitles(subtitleFile, cid);
      if (cues.length === 0) continue;
      const lastEndMs = Math.max(...cues.map((cue) => cue.endMs));
      const coverage = durationSeconds > 0 ? lastEndMs / (durationSeconds * 1000) : 1;
      if (!best || coverage > best.coverage) best = { selected, cues, coverage };
      if (coverage >= 0.8) break;
    } catch {
      // A subtitle track can be published before its file is ready; try the next one.
    }
  }
  if (!best) throw new BiliApiError("subtitle_loading", "字幕文件仍在生成，正在自动重试。");
  const requiredCoverage = durationSeconds >= 180 ? 0.45 : 0.2;
  if (best.coverage < requiredCoverage) {
    throw new BiliApiError("subtitle_loading", "B 站返回的字幕时间轴尚不完整，正在自动重试。");
  }

  const bundle: BaseBundle = {
    bvid: view.data.bvid,
    aid: view.data.aid,
    cid,
    page: page?.page ?? pageNumber,
    title: view.data.title,
    partTitle: page?.part ?? "",
    durationMs: durationSeconds * 1000,
    language: best.selected.lan_doc || best.selected.lan || "字幕",
    cues: best.cues
  };
  baseCache.set(cacheKey, bundle);
  return bundle;
}

interface ReplyNode {
  content?: { message?: string };
  member?: { uname?: string };
  is_top?: boolean;
  isTop?: boolean;
}

interface ReplyResponse {
  code: number;
  data?: Record<string, unknown>;
}

function collectPinnedReplies(root: unknown): Array<ReplyNode & { path: string }> {
  const found: Array<ReplyNode & { path: string }> = [];
  const seen = new WeakSet<object>();

  const visit = (value: unknown, path: string, depth: number): void => {
    if (depth > 10 || value == null || typeof value !== "object") return;
    if (seen.has(value)) return;
    seen.add(value);
    const record = value as Record<string, unknown>;
    const message = (record.content as { message?: unknown } | undefined)?.message;
    const hasReplyShape = typeof message === "string" && typeof record.rpid !== "undefined";
    const pinnedByPath = /(^|\.)(top|top_replies|topReplies|pinned|upper)(\.|$)/i.test(path);
    const pinnedByFlag = record.is_top === true || record.isTop === true || record.top === true;
    if (hasReplyShape && (pinnedByPath || pinnedByFlag)) {
      found.push({ ...(record as ReplyNode), path });
    }
    for (const [key, child] of Object.entries(record)) visit(child, `${path}.${key}`, depth + 1);
  };

  visit(root, "data", 0);
  return found;
}

async function loadPinnedCommentEvidence(aid: number, keywords: string[]): Promise<PinnedCommentEvidence | null> {
  if (keywords.length === 0) return null;
  try {
    const response = await fetchJson<ReplyResponse>(`https://api.bilibili.com/x/v2/reply/main?type=1&oid=${aid}&mode=3`);
    if (response.code !== 0 || !response.data) return null;
    const candidates = collectPinnedReplies(response.data);
    for (const reply of candidates) {
      const text = stripMarkup(reply.content?.message ?? "");
      if (!text) continue;
      const matches = matchedKeywords(text, keywords);
      if (matches.length === 0) continue;
      return {
        found: true,
        author: reply.member?.uname,
        text: text.length > 220 ? `${text.slice(0, 217)}…` : text,
        keyword: matches[0]
      };
    }
  } catch {
    return null;
  }
  return null;
}

export async function loadSubtitleBundle(request: {
  bvid?: string;
  aid?: number;
  page: number;
  keywords: string[];
  includeCommentEvidence: boolean;
}): Promise<SubtitleBundle> {
  const base = await loadBaseBundle(request.bvid, request.aid, Math.max(1, Math.trunc(request.page)));
  const commentEvidence = request.includeCommentEvidence
    ? await loadPinnedCommentEvidence(base.aid, request.keywords)
    : null;
  return { ...base, commentEvidence };
}
