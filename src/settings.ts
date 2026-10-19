export interface Settings {
  keywords: string[];
  confirmBeforeSkip: boolean;
  showCommentEvidence: boolean;
  detectContextAds: boolean;
  danmakuJumpEnabled: boolean;
  aiEnabled: boolean;
  aiProvider: "deepseek" | "openai" | "custom";
  aiEndpoint: string;
  aiModel: string;
  aiApiKey: string;
  aiMinConfidence: number;
  mergeGapSeconds: number;
  beforeBufferSeconds: number;
  afterBufferSeconds: number;
}

export const SETTINGS_KEY = "settings";

export const DEFAULT_SETTINGS: Settings = {
  keywords: [],
  confirmBeforeSkip: true,
  showCommentEvidence: true,
  detectContextAds: true,
  danmakuJumpEnabled: true,
  aiEnabled: false,
  aiProvider: "deepseek",
  aiEndpoint: "https://api.deepseek.com/v1",
  aiModel: "deepseek-chat",
  aiApiKey: "",
  aiMinConfidence: 0.65,
  mergeGapSeconds: 8,
  beforeBufferSeconds: 1,
  afterBufferSeconds: 2
};

export function normalizeKeyword(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ");
}

export function normalizeKeywords(values: Iterable<string>): string[] {
  const output: string[] = [];
  const seen = new Set<string>();
  for (const raw of values) {
    const keyword = normalizeKeyword(raw);
    if (!keyword) continue;
    const identity = keyword.toLocaleLowerCase();
    if (seen.has(identity)) continue;
    seen.add(identity);
    output.push(keyword);
  }
  return output;
}

function clampNumber(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

export function sanitizeSettings(value: Partial<Settings> | undefined): Settings {
  return {
    keywords: normalizeKeywords(Array.isArray(value?.keywords) ? value.keywords.filter((word): word is string => typeof word === "string") : []),
    confirmBeforeSkip: value?.confirmBeforeSkip !== false,
    showCommentEvidence: value?.showCommentEvidence !== false,
    detectContextAds: value?.detectContextAds !== false,
    danmakuJumpEnabled: value?.danmakuJumpEnabled !== false,
    aiEnabled: value?.aiEnabled === true,
    aiProvider: value?.aiProvider === "openai" || value?.aiProvider === "custom" ? value.aiProvider : "deepseek",
    aiEndpoint: typeof value?.aiEndpoint === "string" && value.aiEndpoint.trim()
      ? value.aiEndpoint.trim()
      : DEFAULT_SETTINGS.aiEndpoint,
    aiModel: typeof value?.aiModel === "string" && value.aiModel.trim()
      ? value.aiModel.trim()
      : DEFAULT_SETTINGS.aiModel,
    aiApiKey: typeof value?.aiApiKey === "string" ? value.aiApiKey.trim() : "",
    aiMinConfidence: clampNumber(value?.aiMinConfidence, DEFAULT_SETTINGS.aiMinConfidence, 0, 1),
    mergeGapSeconds: clampNumber(value?.mergeGapSeconds, DEFAULT_SETTINGS.mergeGapSeconds, 0, 120),
    beforeBufferSeconds: clampNumber(value?.beforeBufferSeconds, DEFAULT_SETTINGS.beforeBufferSeconds, 0, 10),
    afterBufferSeconds: clampNumber(value?.afterBufferSeconds, DEFAULT_SETTINGS.afterBufferSeconds, 0, 30)
  };
}

export async function loadSettings(): Promise<Settings> {
  const stored = await chrome.storage.local.get(SETTINGS_KEY);
  return sanitizeSettings(stored[SETTINGS_KEY] as Partial<Settings> | undefined);
}

export async function saveSettings(settings: Settings): Promise<Settings> {
  const sanitized = sanitizeSettings(settings);
  await chrome.storage.local.set({ [SETTINGS_KEY]: sanitized });
  return sanitized;
}
