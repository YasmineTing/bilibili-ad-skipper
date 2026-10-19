import { parseDanmakuJump, type DanmakuJumpHint } from "../core/danmaku";

interface DanmakuCacheEntry {
  hints: DanmakuJumpHint[];
  total: number;
  createdAt: number;
}

const CACHE_TTL_MS = 30 * 60 * 1000;
const MAX_DANMAKU = 120_000;
const cache = new Map<number, DanmakuCacheEntry>();

function decodeEntities(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, decimal: string) => String.fromCodePoint(Number(decimal)))
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/<[^>]*>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function parseDanmakuXml(xml: string, cid: number): { hints: DanmakuJumpHint[]; total: number } {
  const hints: DanmakuJumpHint[] = [];
  let total = 0;
  const pattern = /<d\b[^>]*\bp="([^"]*)"[^>]*>([\s\S]*?)<\/d>/gi;
  for (const match of xml.matchAll(pattern)) {
    total += 1;
    if (total > MAX_DANMAKU) break;
    const seconds = Number((match[1] ?? "").split(",")[0]);
    if (!Number.isFinite(seconds) || seconds < 0) continue;
    const text = decodeEntities(match[2] ?? "");
    const parsed = parseDanmakuJump(text);
    if (!parsed) continue;
    hints.push({
      id: `${cid}:${total}:${Math.round(seconds * 1000)}`,
      atMs: Math.round(seconds * 1000),
      targetMs: parsed.targetMs,
      text,
      explicit: parsed.explicit,
      kind: parsed.kind
    });
    if (hints.length >= 5_000) break;
  }
  return { hints, total };
}

async function fetchDanmakuXml(cid: number): Promise<string> {
  const urls = [
    `https://comment.bilibili.com/${cid}.xml`,
    `https://api.bilibili.com/x/v1/dm/list.so?oid=${cid}`
  ];
  let lastError: unknown = null;
  for (const url of urls) {
    try {
      const response = await fetch(url, {
        credentials: "include",
        headers: {
          Accept: "application/xml,text/xml,text/plain,*/*",
          Referer: "https://www.bilibili.com/"
        },
        signal: AbortSignal.timeout(35_000)
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const text = await response.text();
      if (!/<d\b[^>]*\bp=/.test(text)) throw new Error("返回内容不是 B 站 XML 弹幕");
      return text;
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error(`读取 B 站原生弹幕失败：${lastError instanceof Error ? lastError.message : "网络错误"}`);
}

export async function loadDanmakuHints(cid: number): Promise<{ hints: DanmakuJumpHint[]; total: number }> {
  const cached = cache.get(cid);
  if (cached && Date.now() - cached.createdAt < CACHE_TTL_MS) {
    return { hints: cached.hints.map((hint) => ({ ...hint })), total: cached.total };
  }
  const xml = await fetchDanmakuXml(cid);
  const parsed = parseDanmakuXml(xml, cid);
  cache.set(cid, { ...parsed, createdAt: Date.now() });
  return { hints: parsed.hints.map((hint) => ({ ...hint })), total: parsed.total };
}
