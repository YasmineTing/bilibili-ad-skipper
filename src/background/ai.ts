import type { AiSegmentResult, Cue } from "../core/types";
import type { Settings } from "../settings";

const MAX_CHUNK_CHARS = 45_000;
const CHUNK_OVERLAP_CUES = 40;
const CONCURRENCY = 2;
const analysisCache = new Map<string, { segments: AiSegmentResult[]; model: string }>();

interface TranscriptChunk {
  cues: Cue[];
  startIndex: number;
  endIndex: number;
}

interface ChatCompletionResponse {
  choices?: Array<{
    message?: { content?: string | Array<{ text?: string; content?: string }> };
    text?: string;
  }>;
  output_text?: string;
}

function formatTime(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

function lineForCue(cue: Cue, index: number): string {
  return `[${index}] ${formatTime(cue.startMs)} ${cue.text}`;
}

export function createTranscriptChunks(
  cues: Cue[],
  maxChars = MAX_CHUNK_CHARS,
  overlapCues = CHUNK_OVERLAP_CUES
): TranscriptChunk[] {
  const chunks: TranscriptChunk[] = [];
  let startIndex = 0;
  while (startIndex < cues.length) {
    let endIndex = startIndex;
    let chars = 0;
    while (endIndex < cues.length) {
      const nextLength = lineForCue(cues[endIndex]!, endIndex).length + 1;
      if (endIndex > startIndex && chars + nextLength > maxChars) break;
      chars += nextLength;
      endIndex += 1;
    }
    if (endIndex === startIndex) endIndex = startIndex + 1;
    const chunk = {
      cues: cues.slice(startIndex, endIndex),
      startIndex,
      endIndex: endIndex - 1
    };
    chunks.push(chunk);
    if (endIndex >= cues.length) break;
    startIndex = Math.max(startIndex + 1, endIndex - overlapCues);
  }
  return chunks;
}

function extractJson(content: string): unknown {
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const source = (fenced ?? content).trim();
  if (!source) throw new Error("AI 返回内容为空");
  if (/^\[\s*\]$/.test(source)) return [];
  if (/^(?:未发现|没有发现|未识别到|暂未发现)(?:疑似|明显|相关)?广告/i.test(source) || /no\s+(?:ads?|advertisements?)/i.test(source)) {
    return [];
  }
  if (source.startsWith("[")) {
    try {
      return JSON.parse(source);
    } catch {
      // Fall through to the object extractor so its error includes a useful preview.
    }
  }
  const start = source.indexOf("{");
  const end = source.lastIndexOf("}");
  if (start < 0 || end < start) {
    const preview = source.replace(/\s+/g, " ").slice(0, 180);
    throw new Error(`AI 返回内容不是有效 JSON：${preview}`);
  }
  const objectSource = source.slice(start, end + 1);
  try {
    return JSON.parse(objectSource);
  } catch {
    const preview = objectSource.replace(/\s+/g, " ").slice(0, 180);
    throw new Error(`AI 返回的 JSON 无法解析（可能被截断）：${preview}`);
  }
}

function responseText(body: ChatCompletionResponse): string {
  if (typeof body.output_text === "string") return body.output_text;
  const choice = body.choices?.[0];
  if (typeof choice?.text === "string") return choice.text;
  const content = choice?.message?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map((part) => part.text ?? part.content ?? "").join("");
  return "";
}

export function parseAiSegments(
  response: string,
  chunk: TranscriptChunk,
  allCues: Cue[],
  minConfidence: number
): AiSegmentResult[] {
  const parsed = extractJson(response);
  const segmentsValue = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === "object"
      ? (parsed as { segments?: unknown }).segments
      : undefined;
  if (!Array.isArray(segmentsValue)) throw new Error("AI JSON 缺少 segments 数组");
  const results: AiSegmentResult[] = [];
  for (const raw of segmentsValue) {
    if (!raw || typeof raw !== "object") continue;
    const record = raw as Record<string, unknown>;
    let start = Number(record.start_cue);
    let end = Number(record.end_cue);
    const confidence = Number(record.confidence ?? 0.7);
    if (!Number.isInteger(start) || !Number.isInteger(end)) continue;
    if (start > end) [start, end] = [end, start];
    if (start < chunk.startIndex || end > chunk.endIndex) continue;
    if (!Number.isFinite(confidence) || confidence < minConfidence) continue;
    const startCue = allCues[start];
    const endCue = allCues[end];
    if (!startCue || !endCue) continue;
    results.push({
      startCueIndex: start,
      endCueIndex: end,
      startMs: startCue.startMs,
      endMs: endCue.endMs,
      confidence: Math.max(0, Math.min(1, confidence))
    });
  }
  return results;
}

function chatEndpoint(baseUrl: string): string {
  const value = baseUrl.trim().replace(/\/+$/, "");
  return /\/chat\/completions$/i.test(value) ? value : `${value}/chat/completions`;
}

function buildMessages(title: string, durationMs: number, chunk: TranscriptChunk) {
  const transcript = chunk.cues.map((cue, offset) => lineForCue(cue, chunk.startIndex + offset)).join("\n");
  return [
    {
      role: "system",
      content: [
        "你是视频字幕广告片段检测器。广告包括商单口播、品牌赞助、促销导购、课程/游戏/App 推广、下载或购买号召。",
        "剧情、新闻和普通产品评测只有在出现明确商业推广意图时才标记。",
        "同一广告要从话题引导、产品露出、体验演示、功能讲解、优惠保障、购买号召一路合并到恢复正文，不能因为中间没有重复产品名而断开。",
        "只返回严格 JSON，不要解释。格式：{\"segments\":[{\"start_cue\":整数,\"end_cue\":整数,\"confidence\":0到1}]}。",
        "start_cue 和 end_cue 必须使用输入字幕行方括号中的编号，且包含首尾；即使没有广告，也只能返回 {\"segments\":[]}，不能返回自然语言或空响应。"
      ].join("\n")
    },
    {
      role: "user",
      content: `视频标题：${title}\n视频总时长：${formatTime(durationMs)}\n这是字幕块 ${chunk.startIndex}-${chunk.endIndex}：\n${transcript}`
    }
  ];
}

async function callModel(
  settings: Settings,
  title: string,
  durationMs: number,
  chunk: TranscriptChunk,
  cues: Cue[]
): Promise<AiSegmentResult[]> {
  const headers: Record<string, string> = { "Content-Type": "application/json", Accept: "application/json" };
  if (settings.aiApiKey) headers.Authorization = `Bearer ${settings.aiApiKey}`;
  let response: Response;
  try {
    response = await fetch(chatEndpoint(settings.aiEndpoint), {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: settings.aiModel,
        messages: buildMessages(title, durationMs, chunk),
        temperature: 0,
        max_tokens: 3000,
        stream: false,
        ...(settings.aiProvider === "deepseek" || settings.aiProvider === "openai"
          ? { response_format: { type: "json_object" } }
          : {})
      }),
      signal: AbortSignal.timeout(60_000)
    });
  } catch (error) {
    throw new Error(`AI API 连接失败：${error instanceof Error ? error.message : "网络错误"}`);
  }
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 300);
    throw new Error(`AI API HTTP ${response.status}${detail ? `：${detail}` : ""}`);
  }
  const body = await response.json() as ChatCompletionResponse;
  const text = responseText(body);
  if (!text) throw new Error("AI API 没有返回文本内容");
  return parseAiSegments(text, chunk, cues, settings.aiMinConfidence);
}

function mergeAiSegments(segments: AiSegmentResult[]): AiSegmentResult[] {
  const sorted = [...segments].sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);
  const merged: AiSegmentResult[] = [];
  for (const segment of sorted) {
    const previous = merged.at(-1);
    if (!previous || segment.startMs > previous.endMs + 1_000) {
      merged.push({ ...segment });
      continue;
    }
    previous.endMs = Math.max(previous.endMs, segment.endMs);
    previous.endCueIndex = Math.max(previous.endCueIndex, segment.endCueIndex);
    previous.confidence = Math.max(previous.confidence, segment.confidence);
  }
  return merged;
}

export async function analyzeAdsWithAi(
  request: { title: string; durationMs: number; cues: Cue[] },
  settings: Settings
): Promise<{ segments: AiSegmentResult[]; model: string }> {
  if (!settings.aiEnabled) throw new Error("AI 识别未启用");
  if (!settings.aiEndpoint || !settings.aiModel) throw new Error("AI API 地址或模型未配置");
  if (request.cues.length === 0) return { segments: [], model: settings.aiModel };
  const cacheKey = [
    settings.aiEndpoint,
    settings.aiModel,
    settings.aiMinConfidence,
    request.cues.length,
    request.cues[0]?.id,
    request.cues.at(-1)?.id
  ].join("|");
  const cached = analysisCache.get(cacheKey);
  if (cached) return { segments: cached.segments.map((segment) => ({ ...segment })), model: cached.model };
  const chunks = createTranscriptChunks(request.cues);
  const collected: AiSegmentResult[] = [];
  let firstError: unknown = null;
  for (let index = 0; index < chunks.length; index += CONCURRENCY) {
    const batch = chunks.slice(index, index + CONCURRENCY);
    const results = await Promise.allSettled(batch.map((chunk) =>
      callModel(settings, request.title, request.durationMs, chunk, request.cues)
    ));
    for (const result of results) {
      if (result.status === "fulfilled") collected.push(...result.value);
      else if (firstError == null) firstError = result.reason;
    }
  }
  if (collected.length === 0 && firstError) throw firstError;
  const response = { segments: mergeAiSegments(collected), model: settings.aiModel };
  analysisCache.set(cacheKey, response);
  return { segments: response.segments.map((segment) => ({ ...segment })), model: response.model };
}
