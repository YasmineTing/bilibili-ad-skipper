import { loadSubtitleBundle, BiliApiError } from "./background/api";
import { resolveVideoCid } from "./background/api";
import { analyzeAdsWithAi } from "./background/ai";
import { loadDanmakuHints } from "./background/danmaku";
import type { AiAnalysisResponse, BackgroundError, BackgroundRequest, BackgroundResponse, DanmakuResponse } from "./core/types";
import { loadSettings } from "./settings";

chrome.action.onClicked.addListener((tab) => {
  if (!tab.id) return;
  void chrome.tabs.sendMessage(tab.id, { type: "toggleFloatingPanel" }).catch(() => undefined);
});

function asError(error: unknown): BackgroundError {
  if (error instanceof BiliApiError) return { ok: false, code: error.code, message: error.message };
  return {
    ok: false,
    code: "network",
    message: error instanceof Error ? error.message : "读取字幕时发生未知错误"
  };
}

chrome.runtime.onMessage.addListener((message: BackgroundRequest, _sender, sendResponse: (response: BackgroundResponse | AiAnalysisResponse | DanmakuResponse | { ok: true }) => void) => {
  if (message.type === "loadDanmaku") {
    void (async () => {
      const cid = message.cid ?? await resolveVideoCid(message);
      return { cid, ...(await loadDanmakuHints(cid)) };
    })()
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((error: unknown) => sendResponse({
        ok: false,
        message: error instanceof Error ? error.message : "读取弹幕失败"
      }));
    return true;
  }
  if (message.type === "analyzeAdsWithAi") {
    void loadSettings()
      .then((settings) => analyzeAdsWithAi(message, settings))
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((error: unknown) => sendResponse({
        ok: false,
        message: error instanceof Error ? error.message : "AI 分析失败"
      }));
    return true;
  }

  if (message.type !== "loadSubtitles") return false;

  void loadSubtitleBundle(message)
    .then((data) => sendResponse({ ok: true, data }))
    .catch((error: unknown) => sendResponse(asError(error)));
  return true;
});
