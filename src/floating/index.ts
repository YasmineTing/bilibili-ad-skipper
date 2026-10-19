import {
  loadSettings,
  normalizeKeywords,
  type Settings,
  saveSettings
} from "../settings";

type LogLevel = "info" | "success" | "warn" | "error";

interface PanelLog {
  time: string;
  level: LogLevel;
  message: string;
}

interface PanelState {
  statusTitle: string;
  statusDetail: string;
  statusTone: "info" | "ok" | "warn" | "error";
  showVCaptionsNotice: boolean;
  videoTitle: string;
  segmentCount: number;
  aiStatus: string;
  jumpCandidates: Array<{ targetMs: number; count: number; samples: string[]; status: "available" | "past" | "beyond" }>;
  logs: PanelLog[];
  collapsed: boolean;
}

const PANEL_SOURCE = "bili-ad-skipper-panel";
const HOST_SOURCE = "bili-ad-skipper-host";

function formatTarget(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`
    : `${minutes}:${String(rest).padStart(2, "0")}`;
}

function must<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`悬浮窗缺少元素：${selector}`);
  return element;
}

function post(type: string, payload: Record<string, unknown> = {}): void {
  window.parent.postMessage({ source: PANEL_SOURCE, type, ...payload }, "*");
}

const panel = must<HTMLElement>("#panel");
const launcher = must<HTMLButtonElement>("#launcher");
const dragHandle = must<HTMLElement>("#drag-handle");
const minimizeButton = must<HTMLButtonElement>("#minimize");
const versionNode = must<HTMLElement>("#version");
const statusDot = must<HTMLElement>("#status-dot");
const compactStatus = must<HTMLElement>("#compact-status");
const statusBanner = must<HTMLElement>("#status-banner");
const statusTitle = must<HTMLElement>("#status-title");
const statusDetail = must<HTMLElement>("#status-detail");
const vcaptionsNotice = must<HTMLElement>("#vcaptions-notice");
const videoTitle = must<HTMLElement>("#video-title");
const segmentCount = must<HTMLElement>("#segment-count");
const aiStatus = must<HTMLElement>("#ai-status");
const jumpCandidatesCard = must<HTMLElement>("#jump-candidates-card");
const jumpCandidatesList = must<HTMLElement>("#jump-candidates");
const logList = must<HTMLElement>("#log-list");
const saveMessage = must<HTMLElement>("#save-message");
const saveButton = must<HTMLButtonElement>("#save-settings");

const keywordsInput = must<HTMLTextAreaElement>("#keywords");
const confirmInput = must<HTMLInputElement>("#confirm-skip");
const contextInput = must<HTMLInputElement>("#context-ads");
const danmakuInput = must<HTMLInputElement>("#danmaku-jump");
const commentInput = must<HTMLInputElement>("#comment-evidence");
const mergeGapInput = must<HTMLInputElement>("#merge-gap");
const beforeBufferInput = must<HTMLInputElement>("#before-buffer");
const afterBufferInput = must<HTMLInputElement>("#after-buffer");
const aiEnabledInput = must<HTMLInputElement>("#ai-enabled");
const aiProviderInput = must<HTMLSelectElement>("#ai-provider");
const aiEndpointInput = must<HTMLInputElement>("#ai-endpoint");
const aiModelInput = must<HTMLInputElement>("#ai-model");
const aiApiKeyInput = must<HTMLInputElement>("#ai-api-key");
const aiConfidenceInput = must<HTMLInputElement>("#ai-confidence");

let currentState: PanelState = {
  statusTitle: "等待进入视频页面",
  statusDetail: "打开 B 站视频后会自动读取字幕并扫描广告。",
  statusTone: "info",
  showVCaptionsNotice: false,
  videoTitle: "—",
  segmentCount: 0,
  aiStatus: "未启用",
  jumpCandidates: [],
  logs: [],
  collapsed: true
};

function setCollapsed(collapsed: boolean): void {
  document.body.classList.toggle("is-collapsed", collapsed);
  minimizeButton.textContent = collapsed ? "+" : "—";
  minimizeButton.title = collapsed ? "展开悬浮窗" : "收起悬浮窗";
  currentState.collapsed = collapsed;
}

function activateTab(name: string, expand = true): void {
  if (expand && document.body.classList.contains("is-collapsed")) {
    setCollapsed(false);
    post("set-collapsed", { collapsed: false });
  }
  document.querySelectorAll<HTMLElement>(".tab").forEach((tab) => tab.classList.toggle("active", tab.dataset.tab === name));
  document.querySelectorAll<HTMLElement>(".tab-panel").forEach((tab) => tab.classList.toggle("active", tab.dataset.panel === name));
}

document.querySelectorAll<HTMLButtonElement>(".tab").forEach((tab) => {
  tab.addEventListener("click", () => activateTab(tab.dataset.tab ?? "status"));
});

minimizeButton.addEventListener("click", (event) => {
  event.stopPropagation();
  const collapsed = !document.body.classList.contains("is-collapsed");
  setCollapsed(collapsed);
  post("set-collapsed", { collapsed });
});

launcher.addEventListener("click", () => {
  setCollapsed(false);
  post("set-collapsed", { collapsed: false });
});

dragHandle.addEventListener("pointerdown", (event) => {
  if ((event.target as Element).closest("button")) return;
  dragHandle.setPointerCapture(event.pointerId);
  post("drag-start", { screenX: event.screenX, screenY: event.screenY });
});
dragHandle.addEventListener("pointermove", (event) => {
  if (!dragHandle.hasPointerCapture(event.pointerId)) return;
  post("drag-move", { screenX: event.screenX, screenY: event.screenY });
});
const finishDrag = (event: PointerEvent): void => {
  if (dragHandle.hasPointerCapture(event.pointerId)) dragHandle.releasePointerCapture(event.pointerId);
  post("drag-end");
};
dragHandle.addEventListener("pointerup", finishDrag);
dragHandle.addEventListener("pointercancel", finishDrag);

function renderState(state: PanelState): void {
  currentState = state;
  setCollapsed(state.collapsed);
  statusTitle.textContent = state.statusTitle;
  statusDetail.textContent = state.statusDetail;
  compactStatus.textContent = state.statusTitle;
  statusDot.className = `status-dot ${state.statusTone === "info" ? "" : state.statusTone}`.trim();
  statusBanner.className = `status-banner ${state.statusTone}`;
  vcaptionsNotice.classList.toggle("hidden", !state.showVCaptionsNotice);
  videoTitle.textContent = state.videoTitle || "—";
  segmentCount.textContent = `${state.segmentCount} 个片段`;
  aiStatus.textContent = state.aiStatus;
  jumpCandidatesCard.classList.toggle("hidden", state.jumpCandidates.length === 0);
  jumpCandidatesList.replaceChildren(...state.jumpCandidates.map((candidate) => {
    const row = document.createElement("div");
    row.className = `jump-candidate ${candidate.status}`;
    const time = document.createElement("strong");
    time.textContent = formatTarget(candidate.targetMs);
    const count = document.createElement("span");
    count.textContent = `${candidate.count} 条 · ${{ available: "可选", past: "已过", beyond: "超出视频" }[candidate.status]}`;
    const sample = document.createElement("small");
    sample.textContent = candidate.samples[0] ?? "";
    row.append(time, count, sample);
    return row;
  }));
  logList.replaceChildren();
  if (state.logs.length === 0) {
    const empty = document.createElement("div");
    empty.className = "log-empty";
    empty.textContent = "暂无日志";
    logList.append(empty);
  } else {
    for (const log of state.logs.slice(-100)) {
      const line = document.createElement("div");
      line.className = "log-line";
      const time = document.createElement("span");
      time.className = "log-time";
      time.textContent = log.time;
      const level = document.createElement("span");
      level.className = `log-level ${log.level}`;
      level.textContent = { info: "信息", success: "完成", warn: "注意", error: "错误" }[log.level];
      const message = document.createElement("span");
      message.className = "log-message";
      message.textContent = log.message;
      line.append(time, level, message);
      logList.append(line);
    }
    logList.scrollTop = logList.scrollHeight;
  }
}

function renderSettings(settings: Settings): void {
  keywordsInput.value = settings.keywords.join("\n");
  confirmInput.checked = settings.confirmBeforeSkip;
  contextInput.checked = settings.detectContextAds;
  danmakuInput.checked = settings.danmakuJumpEnabled;
  commentInput.checked = settings.showCommentEvidence;
  mergeGapInput.value = String(settings.mergeGapSeconds);
  beforeBufferInput.value = String(settings.beforeBufferSeconds);
  afterBufferInput.value = String(settings.afterBufferSeconds);
  aiEnabledInput.checked = settings.aiEnabled;
  aiProviderInput.value = settings.aiProvider;
  aiEndpointInput.value = settings.aiEndpoint;
  aiModelInput.value = settings.aiModel;
  aiApiKeyInput.value = settings.aiApiKey;
  aiConfidenceInput.value = String(settings.aiMinConfidence);
}

function collectSettings(): Settings {
  return {
    keywords: normalizeKeywords(keywordsInput.value.split(/\r?\n/)),
    confirmBeforeSkip: confirmInput.checked,
    showCommentEvidence: commentInput.checked,
    detectContextAds: contextInput.checked,
    danmakuJumpEnabled: danmakuInput.checked,
    mergeGapSeconds: Number(mergeGapInput.value),
    beforeBufferSeconds: Number(beforeBufferInput.value),
    afterBufferSeconds: Number(afterBufferInput.value),
    aiEnabled: aiEnabledInput.checked,
    aiProvider: aiProviderInput.value === "openai" || aiProviderInput.value === "custom" ? aiProviderInput.value : "deepseek",
    aiEndpoint: aiEndpointInput.value,
    aiModel: aiModelInput.value,
    aiApiKey: aiApiKeyInput.value,
    aiMinConfidence: Number(aiConfidenceInput.value)
  };
}

async function requestAiPermission(endpoint: string): Promise<boolean> {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    throw new Error("API 地址不是有效 URL");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("API 地址必须使用 http/https");
  return chrome.permissions.request({ origins: [`${url.origin}/*`] });
}

aiProviderInput.addEventListener("change", () => {
  if (aiProviderInput.value === "deepseek") {
    aiEndpointInput.value = "https://api.deepseek.com/v1";
    aiModelInput.value = "deepseek-chat";
  } else if (aiProviderInput.value === "openai") {
    aiEndpointInput.value = "https://api.openai.com/v1";
    aiModelInput.value = "gpt-4.1-mini";
  }
});

saveButton.addEventListener("click", async () => {
  saveButton.disabled = true;
  saveMessage.textContent = "保存中…";
  try {
    const next = collectSettings();
    if (next.aiEnabled) {
      const granted = await requestAiPermission(next.aiEndpoint);
      if (!granted) {
        saveMessage.textContent = "未授权访问 AI API";
        return;
      }
    }
    const saved = await saveSettings(next);
    renderSettings(saved);
    saveMessage.textContent = "已保存，当前视频会自动重新识别";
    post("settings-saved");
    window.setTimeout(() => { saveMessage.textContent = ""; }, 3500);
  } catch (error) {
    saveMessage.textContent = error instanceof Error ? error.message : "保存失败";
  } finally {
    saveButton.disabled = false;
  }
});

window.addEventListener("message", (event) => {
  const data = event.data as { source?: string; type?: string; state?: PanelState; tab?: string } | undefined;
  if (data?.source !== HOST_SOURCE) return;
  if (data.type === "state" && data.state) renderState(data.state);
  if (data.type === "select-tab" && data.tab) activateTab(data.tab);
});

versionNode.textContent = `v${chrome.runtime.getManifest().version}`;
void loadSettings().then(renderSettings);
post("ready");
