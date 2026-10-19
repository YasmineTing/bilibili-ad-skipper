import {
  DEFAULT_SETTINGS,
  loadSettings,
  normalizeKeywords,
  type Settings,
  saveSettings
} from "../settings";

function must<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`设置页缺少必要元素：${selector}`);
  return element;
}

const form = must<HTMLFormElement>("#settings-form");
const keywordsInput = must<HTMLTextAreaElement>("#keywords");
const confirmInput = must<HTMLInputElement>("#confirm-before-skip");
const commentInput = must<HTMLInputElement>("#show-comment-evidence");
const contextAdsInput = must<HTMLInputElement>("#detect-context-ads");
const danmakuJumpInput = must<HTMLInputElement>("#danmaku-jump");
const aiEnabledInput = must<HTMLInputElement>("#ai-enabled");
const aiProviderInput = must<HTMLSelectElement>("#ai-provider");
const aiEndpointInput = must<HTMLInputElement>("#ai-endpoint");
const aiModelInput = must<HTMLInputElement>("#ai-model");
const aiApiKeyInput = must<HTMLInputElement>("#ai-api-key");
const aiConfidenceInput = must<HTMLInputElement>("#ai-confidence");
const aiFields = must<HTMLElement>("#ai-fields");
const mergeGapInput = must<HTMLInputElement>("#merge-gap");
const beforeBufferInput = must<HTMLInputElement>("#before-buffer");
const afterBufferInput = must<HTMLInputElement>("#after-buffer");
const countLabel = must<HTMLElement>("#keyword-count");
const statusLabel = must<HTMLElement>("#save-status");
const resetButton = must<HTMLButtonElement>("#reset");

function parseKeywords(): string[] {
  return normalizeKeywords(keywordsInput.value.split(/\r?\n/));
}

function updateCount(): void {
  const count = parseKeywords().length;
  countLabel.textContent = `${count} 个词`;
}

function updateAiFields(): void {
  aiFields.classList.toggle("disabled", !aiEnabledInput.checked);
}

function render(settings: Settings): void {
  keywordsInput.value = settings.keywords.join("\n");
  confirmInput.checked = settings.confirmBeforeSkip;
  commentInput.checked = settings.showCommentEvidence;
  contextAdsInput.checked = settings.detectContextAds;
  danmakuJumpInput.checked = settings.danmakuJumpEnabled;
  aiEnabledInput.checked = settings.aiEnabled;
  aiProviderInput.value = settings.aiProvider;
  aiEndpointInput.value = settings.aiEndpoint;
  aiModelInput.value = settings.aiModel;
  aiApiKeyInput.value = settings.aiApiKey;
  aiConfidenceInput.value = String(settings.aiMinConfidence);
  mergeGapInput.value = String(settings.mergeGapSeconds);
  beforeBufferInput.value = String(settings.beforeBufferSeconds);
  afterBufferInput.value = String(settings.afterBufferSeconds);
  updateCount();
  updateAiFields();
}

keywordsInput.addEventListener("input", updateCount);
aiEnabledInput.addEventListener("change", updateAiFields);
aiProviderInput.addEventListener("change", () => {
  if (aiProviderInput.value === "deepseek") {
    aiEndpointInput.value = "https://api.deepseek.com/v1";
    aiModelInput.value = "deepseek-chat";
  } else if (aiProviderInput.value === "openai") {
    aiEndpointInput.value = "https://api.openai.com/v1";
    aiModelInput.value = "gpt-4.1-mini";
  }
});

async function requestAiHostPermission(endpoint: string): Promise<boolean> {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    throw new Error("AI API 地址不是有效 URL");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("AI API 地址必须使用 http 或 https");
  }
  return chrome.permissions.request({ origins: [`${url.origin}/*`] });
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const next: Settings = {
    keywords: parseKeywords(),
    confirmBeforeSkip: confirmInput.checked,
    showCommentEvidence: commentInput.checked,
    detectContextAds: contextAdsInput.checked,
    danmakuJumpEnabled: danmakuJumpInput.checked,
    aiEnabled: aiEnabledInput.checked,
    aiProvider: aiProviderInput.value === "openai" || aiProviderInput.value === "custom"
      ? aiProviderInput.value
      : "deepseek",
    aiEndpoint: aiEndpointInput.value,
    aiModel: aiModelInput.value,
    aiApiKey: aiApiKeyInput.value,
    aiMinConfidence: Number(aiConfidenceInput.value),
    mergeGapSeconds: Number(mergeGapInput.value),
    beforeBufferSeconds: Number(beforeBufferInput.value),
    afterBufferSeconds: Number(afterBufferInput.value)
  };
  let permissionGranted = true;
  if (next.aiEnabled) {
    try {
      permissionGranted = await requestAiHostPermission(next.aiEndpoint);
    } catch (error) {
      statusLabel.textContent = error instanceof Error ? error.message : "AI API 权限请求失败";
      return;
    }
  }
  const saved = await saveSettings(next);
  render(saved);
  statusLabel.textContent = permissionGranted
    ? "已保存，正在播放的视频会自动重新计算"
    : "设置已保存，但未授权访问 AI API；启用 AI 前请重新保存并允许权限";
  window.setTimeout(() => { statusLabel.textContent = ""; }, 3500);
});

resetButton.addEventListener("click", async () => {
  const saved = await saveSettings(DEFAULT_SETTINGS);
  render(saved);
  statusLabel.textContent = "已恢复默认设置";
  window.setTimeout(() => { statusLabel.textContent = ""; }, 3000);
});

void loadSettings().then(render);
