export interface VideoRef {
  bvid?: string;
  aid?: number;
  page: number;
}

export function parseVideoRef(url = window.location.href): VideoRef | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const bvidMatch = parsed.pathname.match(/\/video\/(BV[0-9A-Za-z]+)/i);
  const aidMatch = parsed.pathname.match(/\/video\/av(\d+)/i);
  if (!bvidMatch && !aidMatch) return null;
  const rawPage = Number(parsed.searchParams.get("p") ?? "1");
  return {
    bvid: bvidMatch?.[1],
    aid: aidMatch ? Number(aidMatch[1]) : undefined,
    page: Number.isFinite(rawPage) && rawPage > 0 ? Math.trunc(rawPage) : 1
  };
}

export function videoKey(ref: VideoRef | null): string {
  if (!ref) return "";
  return `${ref.bvid ?? `av${ref.aid}`}:p${ref.page}`;
}

export function findVideoElement(): HTMLVideoElement | null {
  const videos = Array.from(document.querySelectorAll<HTMLVideoElement>("video"));
  if (videos.length === 0) return null;
  const visible = videos.filter((video) => {
    const rect = video.getBoundingClientRect();
    const style = window.getComputedStyle(video);
    return rect.width > 240 && rect.height > 120 && style.visibility !== "hidden" && style.display !== "none";
  });
  const pool = visible.length > 0 ? visible : videos;
  return pool.sort((a, b) => {
    const aCaptions = a.hasAttribute("data-vcaptions-target-video") ? 1_000_000 : 0;
    const bCaptions = b.hasAttribute("data-vcaptions-target-video") ? 1_000_000 : 0;
    const ar = a.getBoundingClientRect();
    const br = b.getBoundingClientRect();
    return bCaptions + br.width * br.height - (aCaptions + ar.width * ar.height);
  })[0] ?? null;
}
