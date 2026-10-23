import { parseRulePack, RuleImportError, type CustomRule } from "../core/rules";
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
const rulesCount = must<HTMLElement>("#rules-count");
const rulesFileInput = must<HTMLInputElement>("#rules-file");
const rulesJsonInput = must<HTMLTextAreaElement>("#rules-json");
const rulesApplyButton = must<HTMLButtonElement>("#rules-apply");
const rulesExportButton = must<HTMLButtonElement>("#rules-export");
const rulesClearButton = must<HTMLButtonElement>("#rules-clear");
const rulesStatus = must<HTMLElement>("#rules-status");
const rulesList = must<HTMLElement>("#rules-list");

let draftRules: CustomRule[] = [];

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

function setRulesStatus(message: string, isError = false): void {
  rulesStatus.textContent = message;
  rulesStatus.classList.toggle("error", isError);
}

function ruleSummary(rule: CustomRule): string {
  return [
    rule.keywords.length > 0 ? `关键词 ${rule.keywords.length}` : "",
    rule.required.length > 0 ? `必含 ${rule.required.length}` : "",
    rule.exclude.length > 0 ? `排除 ${rule.exclude.length}` : "",
    rule.pattern ? "正则" : "",
    `最少 ${rule.minHits} 句`
  ].filter(Boolean).join(" · ");
}

function renderRules(): void {
  rulesCount.textContent = `${draftRules.length} 条规则`;
  rulesList.replaceChildren(...draftRules.map((rule, index) => {
    const row = document.createElement("div");
    row.className = "rule-row";
    const copy = document.createElement("div");
    const name = document.createElement("strong");
    name.textContent = rule.name;
    const meta = document.createElement("span");
    meta.className = "rule-meta";
    meta.textContent = ruleSummary(rule);
    copy.append(name, meta);
    const toggle = document.createElement("input");
    toggle.type = "checkbox";
    toggle.checked = rule.enabled;
    toggle.title = "启用或停用这条规则";
    toggle.addEventListener("change", () => {
      draftRules[index] = { ...rule, enabled: toggle.checked };
      setRulesStatus(`「${rule.name}」已${toggle.checked ? "启用" : "停用"}，保存后生效。`);
    });
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "rule-delete";
    remove.textContent = "删除";
    remove.addEventListener("click", () => {
      draftRules.splice(index, 1);
      renderRules();
      setRulesStatus(`已删除「${rule.name}」，保存后生效。`);
    });
    row.append(copy, toggle, remove);
    return row;
  }));
}

function applyRules(input: string, source: string): void {
  try {
    draftRules = parseRulePack(input);
    renderRules();
    rulesJsonInput.value = "";
    setRulesStatus(`${source}导入 ${draftRules.length} 条规则，点击“保存设置”后生效。`);
  } catch (error) {
    setRulesStatus(error instanceof RuleImportError ? error.message : "规则导入失败，请检查 JSON 格式", true);
  }
}

function render(settings: Settings): void {
  keywordsInput.value = settings.keywords.join("\n");
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
  draftRules = settings.customRules.map((rule) => ({ ...rule }));
  renderRules();
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

rulesFileInput.addEventListener("change", async () => {
  const file = rulesFileInput.files?.[0];
  if (!file) return;
  try {
    applyRules(await file.text(), `已从 ${file.name} `);
  } catch {
    setRulesStatus("读取规则文件失败", true);
  } finally {
    rulesFileInput.value = "";
  }
});

rulesApplyButton.addEventListener("click", () => {
  if (!rulesJsonInput.value.trim()) {
    setRulesStatus("请先粘贴规则 JSON", true);
    return;
  }
  applyRules(rulesJsonInput.value, "");
});

rulesClearButton.addEventListener("click", () => {
  draftRules = [];
  renderRules();
  setRulesStatus("已清空规则，保存后生效。");
});

rulesExportButton.addEventListener("click", () => {
  const pack = { version: 1, name: "B站广告跳过规则包", rules: draftRules };
  const blob = new Blob([`${JSON.stringify(pack, null, 2)}\n`], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "bilibili-ad-rules.json";
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  setRulesStatus(`已导出 ${draftRules.length} 条规则。`);
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const next: Settings = {
    keywords: parseKeywords(),
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
    afterBufferSeconds: Number(afterBufferInput.value),
    customRules: draftRules.map((rule) => ({ ...rule }))
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
