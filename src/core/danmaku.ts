export interface DanmakuJumpHint {
  id: string;
  atMs: number;
  targetMs: number;
  text: string;
  explicit: boolean;
  kind: "time" | "chinese-digits" | "number";
}

const CN_DIGITS: Record<string, number> = {
  零: 0, 〇: 0, 一: 1, 幺: 1, 二: 2, 两: 2, 三: 3, 四: 4,
  五: 5, 六: 6, 七: 7, 八: 8, 九: 9
};

const EXPLICIT_PATTERN = /(空降|跳到|跳转|直接到|直接看|直达|转到|拖到|正片|广告结束|前方高能|空降成功|传送门|进度条|skip|jump)/i;
const COMMON_NOISE = /^(?:1{3,}|6{3,}|8{3,}|9{3,}|233+|520|521|1314|114514|114)+$/i;
const MIN_TARGET_SECONDS = 10;

function normalized(text: string): string {
  return text.normalize("NFKC").replace(/\s+/g, " ").trim();
}

function parseChineseNumber(value: string): number | null {
  if (!value) return null;
  if (/^[零〇一二三四五六七八九幺两]+$/.test(value)) {
    if (value.length === 1) return CN_DIGITS[value] ?? null;
    let total = 0;
    for (const char of value) {
      const digit = CN_DIGITS[char];
      if (digit == null) return null;
      total = total * 10 + digit;
    }
    return total;
  }
  const tenIndex = value.indexOf("十");
  if (tenIndex >= 0) {
    const tensRaw = value.slice(0, tenIndex);
    const onesRaw = value.slice(tenIndex + 1);
    const tens = tensRaw ? CN_DIGITS[tensRaw.at(-1) ?? ""] : 1;
    const ones = onesRaw ? CN_DIGITS[onesRaw[0] ?? ""] : 0;
    if (tens == null || ones == null) return null;
    return tens * 10 + ones;
  }
  return null;
}

function splitDigits(value: string): number | null {
  if (value.length === 3) {
    const seconds = Number(value.slice(1));
    return seconds < 60 ? Number(value[0]) * 60 + seconds : null;
  }
  if (value.length === 4) {
    const seconds = Number(value.slice(2));
    return seconds < 60 ? Number(value.slice(0, 2)) * 60 + seconds : null;
  }
  return null;
}

function validateTarget(totalSeconds: number, kind: DanmakuJumpHint["kind"], explicit: boolean, raw: string): DanmakuJumpHint["kind"] | null {
  if (!Number.isFinite(totalSeconds) || totalSeconds < MIN_TARGET_SECONDS || totalSeconds > 24 * 3600) return null;
  const compact = raw.replace(/[\s，。,.!！?？~～【】\[\]()（）]/g, "");
  if (!explicit && COMMON_NOISE.test(compact)) return null;
  if (!explicit) {
    const numeric = Array.from(raw).map((char) => CN_DIGITS[char] ?? (/\d/.test(char) ? char : "")).join("");
    if (/^(?:233+|666+|888+|999+|520|1314|114514)$/.test(numeric)) return null;
  }
  if (!explicit && kind === "chinese-digits" && /^([零〇一二三四五六七八九幺两])\1{2,}$/.test(compact)) return null;
  return kind;
}

function collectTimes(text: string, explicit: boolean): Array<{ seconds: number; kind: DanmakuJumpHint["kind"] }> {
  const found: Array<{ seconds: number; kind: DanmakuJumpHint["kind"] }> = [];
  const push = (seconds: number, kind: DanmakuJumpHint["kind"]): void => {
    if (Number.isFinite(seconds) && seconds > 0) found.push({ seconds, kind });
  };

  for (const match of text.matchAll(/(\d{1,2})\s*[:：]\s*(\d{1,2})(?:\s*[:：]\s*(\d{1,2}))?/g)) {
    const first = Number(match[1]);
    const second = Number(match[2]);
    const third = match[3] == null ? null : Number(match[3]);
    if (third == null && second < 60) push(first * 60 + second, "time");
    if (third != null && second < 60 && third < 60) push(first * 3600 + second * 60 + third, "time");
  }
  if (explicit) {
    for (const match of text.matchAll(/(\d{1,2})\s*(?:小时|时)\s*(?:(\d{1,2})\s*分)?\s*(?:(\d{1,2})\s*秒)?/g)) {
      const hours = Number(match[1]);
      const minutes = Number(match[2] ?? 0);
      const seconds = Number(match[3] ?? 0);
      if (minutes < 60 && seconds < 60) push(hours * 3600 + minutes * 60 + seconds, "time");
    }
    for (const match of text.matchAll(/(\d{1,2})\s*分\s*(\d{1,2})?\s*秒?/g)) {
      const minutes = Number(match[1]);
      const seconds = Number(match[2] ?? 0);
      if (minutes < 60 && seconds < 60) push(minutes * 60 + seconds, "time");
    }
    for (const match of text.matchAll(/(\d{1,2})\s*点\s*(\d{1,2})?\s*分?/g)) {
      const minutes = Number(match[1]);
      const seconds = Number(match[2] ?? 0);
      if (minutes < 60 && seconds < 60) push(minutes * 60 + seconds, "time");
    }
    for (const match of text.matchAll(/([零〇一二三四五六七八九十两]{1,5})分([零〇一二三四五六七八九十两]{0,5})秒?/g)) {
      const minutes = parseChineseNumber(match[1] ?? "");
      const seconds = parseChineseNumber(match[2] ?? "") ?? 0;
      if (minutes != null && minutes < 60 && seconds < 60) push(minutes * 60 + seconds, "time");
    }
    for (const match of text.matchAll(/([零〇一二三四五六七八九十两]{1,5})点([零〇一二三四五六七八九十两]{0,5})分?/g)) {
      const minutes = parseChineseNumber(match[1] ?? "");
      const seconds = parseChineseNumber(match[2] ?? "") ?? 0;
      if (minutes != null && minutes < 60 && seconds < 60) push(minutes * 60 + seconds, "time");
    }
    for (const match of text.matchAll(/([零〇一二三四五六七八九十两]{1,5})(?:小时|时)(?:(\d{1,2})\s*分)?\s*(?:(\d{1,2})\s*秒)?/g)) {
      const hours = parseChineseNumber(match[1] ?? "");
      const minutes = Number(match[2] ?? 0);
      const seconds = Number(match[3] ?? 0);
      if (hours != null && minutes < 60 && seconds < 60) push(hours * 3600 + minutes * 60 + seconds, "time");
    }
  }
  for (const match of text.matchAll(/([零〇一二三四五六七八九幺两]{3,4})/g)) {
    const digits = Array.from(match[1] ?? "").map((char) => CN_DIGITS[char]);
    if (digits.some((digit) => digit == null)) continue;
    const value = digits.join("");
    const seconds = splitDigits(value);
    if (seconds != null) push(seconds, "chinese-digits");
  }
  if (EXPLICIT_PATTERN.test(text)) {
    for (const match of text.matchAll(/(?:^|[^\d])(\d{3,4})(?:[^\d]|$)/g)) {
      const seconds = splitDigits(match[1] ?? "");
      if (seconds != null) push(seconds, "number");
    }
  }
  return found;
}

export function parseDanmakuJump(text: string): { targetMs: number; explicit: boolean; kind: DanmakuJumpHint["kind"] } | null {
  const source = normalized(text);
  const explicit = EXPLICIT_PATTERN.test(source);
  if (!source) return null;
  if (/^(?:[1１]|[一幺])$/.test(source)) return null;
  const times = collectTimes(source, explicit).filter((item) => validateTarget(item.seconds, item.kind, explicit, source));
  if (times.length === 0) return null;
  const match = times.at(-1)!;

  if (!explicit && match.kind === "chinese-digits") {
    const contextlessChinese = source.replace(/[零〇一二三四五六七八九幺两]/g, "").trim();
    if (contextlessChinese.length > 8) return null;
  }
  return { targetMs: Math.round(match.seconds * 1000), explicit, kind: match.kind };
}
