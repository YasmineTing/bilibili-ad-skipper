import type { PinnedCommentEvidence, Segment } from "../core/types";

function formatTime(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`
    : `${minutes}:${String(rest).padStart(2, "0")}`;
}

export interface PromptHandlers {
  onSkip: () => void;
  onContinue: () => void;
  onOpenOptions: () => void;
}

export interface JumpOptionView {
  targetMs: number;
  count: number;
  samples: string[];
}

export interface JumpPromptHandlers {
  onJump: (index: number) => void;
  onContinue: () => void;
  onOpenOptions: () => void;
}

const STYLES = `
:host { all: initial; }
*, *::before, *::after { box-sizing: border-box; }
.layer { position: fixed; inset: 0; z-index: 2147483647; pointer-events: none; font-family: "Segoe UI", "Microsoft YaHei", system-ui, sans-serif; }
.panel { position: fixed; left: 22px; bottom: 92px; width: min(380px, calc(100vw - 32px)); padding: 18px; border: 1px solid rgba(255,255,255,.16); border-radius: 16px; color: #f7f9fc; background: rgba(18,22,29,.96); box-shadow: 0 20px 60px rgba(0,0,0,.4); pointer-events: auto; animation: enter .18s ease-out; }
.header { display: flex; align-items: center; gap: 10px; }
.dot { width: 9px; height: 9px; border-radius: 50%; background: #ffb648; box-shadow: 0 0 0 5px rgba(255,182,72,.13); }
.title { margin: 0; flex: 1; font-size: 17px; line-height: 1.35; }
.icon-button { width: 30px; height: 30px; border: 0; border-radius: 9px; color: #aeb7c4; background: transparent; cursor: pointer; font-size: 18px; }
.icon-button:hover { color: white; background: rgba(255,255,255,.09); }
.time { margin: 12px 0 10px; color: #aeb7c4; font-size: 13px; }
.chips { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 12px; }
.chip { padding: 4px 8px; border-radius: 999px; color: #9fe3ff; background: rgba(0,174,236,.14); border: 1px solid rgba(0,174,236,.28); font-size: 12px; }
.context { margin: -4px 0 12px; color: #b9c4d0; font-size: 12px; line-height: 1.55; }
.jump-options { display: grid; gap: 6px; max-height: 210px; overflow: auto; margin: 0 0 12px; }
.jump-option { width: 100%; display: grid; grid-template-columns: auto 1fr; gap: 4px 10px; padding: 8px 10px; border: 1px solid rgba(255,255,255,.12); border-radius: 9px; color: #e9eef5; background: rgba(255,255,255,.045); text-align: left; cursor: pointer; }
.jump-option:hover { border-color: rgba(0,174,236,.55); background: rgba(0,174,236,.1); }
.jump-time { grid-row: 1 / 3; align-self: center; min-width: 56px; color: #7fdcff; font-size: 17px; font-weight: 800; }
.jump-meta { color: #aeb8c4; font-size: 11px; }
.jump-sample { color: #d6dde6; font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.jump-recommend { margin-left: 5px; padding: 1px 5px; border-radius: 4px; color: #ffe2a8; background: rgba(255,180,72,.16); }
.quotes { display: grid; gap: 6px; max-height: 150px; overflow: auto; margin: 0 0 12px; padding: 0; list-style: none; }
.quote { padding: 8px 10px; border-left: 2px solid rgba(0,174,236,.6); border-radius: 0 7px 7px 0; color: #e2e7ef; background: rgba(255,255,255,.045); font-size: 13px; line-height: 1.55; }
.evidence { padding: 10px 11px; margin-bottom: 13px; border: 1px solid rgba(108,215,165,.18); border-radius: 10px; background: rgba(44,136,94,.13); color: #c9f0dc; font-size: 12px; line-height: 1.6; }
.evidence strong { color: #7ee2b2; }
.actions { display: flex; gap: 9px; align-items: center; }
.actions .spacer { flex: 1; }
button.action, button.link { font: inherit; cursor: pointer; }
.action { padding: 9px 14px; border-radius: 10px; border: 1px solid rgba(255,255,255,.15); color: #eaf0f7; background: rgba(255,255,255,.06); }
.action:hover { background: rgba(255,255,255,.1); }
.action.primary { color: white; border-color: #00aeec; background: #00aeec; font-weight: 700; }
.action.primary:hover { background: #009bd4; }
.link { padding: 7px 2px; border: 0; color: #8ddcf8; background: transparent; font-size: 12px; }
.toast { position: fixed; left: 50%; bottom: 30px; display: flex; align-items: center; gap: 14px; padding: 11px 14px 11px 16px; border: 1px solid rgba(255,255,255,.14); border-radius: 12px; color: #eef4fa; background: rgba(20,25,33,.95); box-shadow: 0 12px 36px rgba(0,0,0,.3); transform: translateX(-50%); pointer-events: auto; font-size: 13px; }
.toast button { padding: 5px 9px; border: 1px solid rgba(255,255,255,.16); border-radius: 7px; color: #9fe3ff; background: transparent; cursor: pointer; }
.companion { position: fixed; left: 22px; top: 82px; width: min(390px, calc(100vw - 44px)); display: flex; align-items: flex-start; gap: 12px; padding: 12px 13px; border: 1px solid #f0cfda; border-radius: 12px; color: #5c3d47; background: rgba(255,247,250,.97); box-shadow: 0 12px 34px rgba(50,30,38,.18); pointer-events: auto; font-size: 12px; line-height: 1.55; }
.companion-copy { flex: 1; display: grid; gap: 3px; }
.companion-copy strong { color: #3f3035; font-size: 13px; }
.companion-actions { display: flex; align-items: center; gap: 7px; margin-top: 6px; }
.companion-actions a { padding: 4px 8px; border-radius: 6px; color: #fff; background: #d94f78; text-decoration: none; font-size: 11px; font-weight: 700; }
.companion-close { width: 24px; height: 24px; border: 0; border-radius: 6px; color: #8c6b76; background: transparent; cursor: pointer; }
.companion-close:hover { background: rgba(217,79,120,.09); }
.status { position: fixed; left: 22px; bottom: 28px; max-width: min(420px, calc(100vw - 44px)); padding: 10px 13px; border: 1px solid rgba(255,255,255,.13); border-radius: 10px; color: #e6ebf2; background: rgba(20,25,33,.94); box-shadow: 0 10px 30px rgba(0,0,0,.25); pointer-events: auto; font-size: 12px; line-height: 1.55; }
.status button { margin-left: 8px; padding: 0; border: 0; color: #88dbff; background: transparent; cursor: pointer; }
.hidden { display: none !important; }
@keyframes enter { from { opacity: 0; transform: translateY(8px) scale(.985); } to { opacity: 1; transform: none; } }
@media (max-width: 620px) { .panel { left: 12px; bottom: 70px; } .status { left: 12px; } }
`;

export class ExtensionUi {
  private readonly root: ShadowRoot;
  private readonly panel: HTMLElement;
  private readonly toast: HTMLElement;
  private readonly status: HTMLElement;
  private toastTimer = 0;
  private statusTimer = 0;

  constructor() {
    const old = document.getElementById("bili-ad-skipper-root");
    old?.remove();
    const host = document.createElement("div");
    host.id = "bili-ad-skipper-root";
    host.style.position = "fixed";
    host.style.inset = "0";
    host.style.zIndex = "2147483647";
    host.style.pointerEvents = "none";
    this.root = host.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = STYLES;
    const layer = document.createElement("div");
    layer.className = "layer";
    layer.innerHTML = `
      <section class="panel hidden" role="dialog" aria-live="polite" aria-label="检测到广告片段">
        <div class="header"><span class="dot"></span><h2 class="title">检测到广告片段</h2><button class="icon-button" type="button" data-action="continue" aria-label="继续观看">×</button></div>
        <p class="time"></p><div class="chips"></div><p class="context hidden"></p><div class="jump-options hidden"></div><ul class="quotes"></ul>
        <div class="evidence hidden"></div>
        <div class="actions"><button type="button" class="link" data-action="options">调整词库</button><span class="spacer"></span><button type="button" class="action" data-action="continue">继续观看</button><button type="button" class="action primary" data-action="skip">跳过</button></div>
      </section>
      <div class="toast hidden"><span class="toast-text"></span><button type="button" data-action="undo">撤销</button></div>
      <div class="companion hidden" role="note" aria-label="vCaptions 安装提示">
        <div class="companion-copy"><strong>可选依赖：未检测到 vCaptions</strong><span>广告跳过仍可使用 B 站字幕；安装并启用 vCaptions 后还可查看完整字幕列表、翻译和点击字幕。</span><div class="companion-actions"><a href="#" target="_blank" rel="noopener noreferrer">安装或检查 vCaptions</a></div></div>
        <button type="button" class="companion-close" aria-label="关闭提示">×</button>
      </div>
      <div class="status hidden" role="status"></div>`;
    this.root.append(style, layer);
    document.documentElement.appendChild(host);
    this.panel = this.must<HTMLElement>(".panel");
    this.toast = this.must<HTMLElement>(".toast");
    this.status = this.must<HTMLElement>(".status");
    this.must<HTMLButtonElement>(".companion-close").addEventListener("click", () => this.hideCompanionNotice());
  }

  private must<T extends Element>(selector: string): T {
    const element = this.root.querySelector<T>(selector);
    if (!element) throw new Error(`UI element missing: ${selector}`);
    return element;
  }

  hidePrompt(): void {
    this.panel.classList.add("hidden");
  }

  showPrompt(segment: Segment, evidence: PinnedCommentEvidence | null, handlers: PromptHandlers): void {
    const title = this.must<HTMLElement>(".title");
    const time = this.must<HTMLElement>(".time");
    const chips = this.must<HTMLElement>(".chips");
    const quotes = this.must<HTMLElement>(".quotes");
    const contextNode = this.must<HTMLElement>(".context");
    const evidenceNode = this.must<HTMLElement>(".evidence");
    const jumpOptionsNode = this.must<HTMLElement>(".jump-options");
    const lengthSeconds = Math.max(1, Math.round((segment.endMs - segment.startMs) / 1000));
    const skipButton = this.must<HTMLButtonElement>('[data-action="skip"]');
    skipButton.textContent = "跳过";
    title.textContent = segment.aiConfidence != null
      ? "AI 识别到疑似广告片段"
      : segment.matchedKeywords.length > 0 ? "检测到广告片段" : "检测到疑似商单片段";
    time.textContent = `${formatTime(segment.startMs)} – ${formatTime(segment.endMs)} · 约 ${lengthSeconds} 秒`;
    jumpOptionsNode.classList.add("hidden");
    jumpOptionsNode.replaceChildren();
    const chipLabels = [
      ...(segment.matchedKeywords.length > 0 ? segment.matchedKeywords : segment.aiConfidence == null ? ["推广语境触发"] : []),
      ...(segment.aiConfidence != null ? [`AI ${Math.round(segment.aiConfidence * 100)}%`] : [])
    ];
    chips.replaceChildren(...chipLabels.map((keyword) => {
      const chip = document.createElement("span");
      chip.className = "chip";
      chip.textContent = keyword;
      return chip;
    }));
    if (segment.adContextTerms.length > 0) {
      contextNode.classList.remove("hidden");
      contextNode.textContent = `同时识别到推广语境：${segment.adContextTerms.slice(0, 8).join("、")}`;
    } else {
      contextNode.classList.add("hidden");
      contextNode.textContent = "";
    }
    quotes.replaceChildren(...segment.cues.slice(0, 4).map((cue) => {
      const item = document.createElement("li");
      item.className = "quote";
      item.textContent = cue.text;
      return item;
    }));
    if (evidence?.found && evidence.keyword && segment.matchedKeywords.includes(evidence.keyword)) {
      evidenceNode.classList.remove("hidden");
      evidenceNode.replaceChildren();
      const strong = document.createElement("strong");
      strong.textContent = "UP 主置顶评论也提及该产品";
      evidenceNode.append(strong, document.createElement("br"));
      const quote = document.createElement("span");
      quote.textContent = `“${evidence.text ?? ""}”`;
      evidenceNode.append(quote);
    } else {
      evidenceNode.classList.add("hidden");
    }
    this.panel.classList.remove("hidden");
    this.panel.querySelector<HTMLButtonElement>('[data-action="skip"]')?.focus({ preventScroll: true });
    this.panel.onclick = (event) => {
      const target = (event.target as Element).closest<HTMLElement>("[data-action]");
      if (!target) return;
      switch (target.dataset.action) {
        case "skip": handlers.onSkip(); break;
        case "continue": handlers.onContinue(); break;
        case "options": handlers.onOpenOptions(); break;
      }
    };
  }

  showJumpPrompt(options: JumpOptionView[], handlers: JumpPromptHandlers): void {
    if (options.length === 0) return;
    const title = this.must<HTMLElement>(".title");
    const time = this.must<HTMLElement>(".time");
    const chips = this.must<HTMLElement>(".chips");
    const quotes = this.must<HTMLElement>(".quotes");
    const contextNode = this.must<HTMLElement>(".context");
    const evidenceNode = this.must<HTMLElement>(".evidence");
    const jumpOptionsNode = this.must<HTMLElement>(".jump-options");
    const continueButton = this.must<HTMLButtonElement>('[data-action="continue"].action');
    const skipButton = this.must<HTMLButtonElement>('[data-action="skip"]');
    const target = formatTime(options[0]!.targetMs);
    title.textContent = "检测到空降时间";
    time.textContent = `发现 ${options.length} 个晚于当前播放时间的待选目标`;
    chips.replaceChildren(...["弹幕空降", `${options.length} 个候选`].map((label) => {
      const chip = document.createElement("span");
      chip.className = "chip";
      chip.textContent = label;
      return chip;
    }));
    contextNode.textContent = "点击任意时间即可跳转；推荐项根据明确程度和弹幕数量排序。";
    contextNode.classList.remove("hidden");
    quotes.replaceChildren();
    jumpOptionsNode.classList.remove("hidden");
    jumpOptionsNode.replaceChildren(...options.map((option, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "jump-option";
      button.dataset.jumpOption = String(index);
      const timeLabel = document.createElement("span");
      timeLabel.className = "jump-time";
      timeLabel.textContent = formatTime(option.targetMs);
      const meta = document.createElement("span");
      meta.className = "jump-meta";
      meta.textContent = `${option.count} 条弹幕`;
      if (index === 0) {
        const recommended = document.createElement("span");
        recommended.className = "jump-recommend";
        recommended.textContent = "推荐";
        meta.append(recommended);
      }
      const sample = document.createElement("span");
      sample.className = "jump-sample";
      sample.textContent = option.samples[0] ?? "";
      button.append(timeLabel, meta, sample);
      return button;
    }));
    evidenceNode.classList.add("hidden");
    continueButton.textContent = "继续观看";
    skipButton.textContent = `跳到 ${target}`;
    this.panel.classList.remove("hidden");
    skipButton.focus({ preventScroll: true });
    this.panel.onclick = (event) => {
      const targetElement = (event.target as Element).closest<HTMLElement>("[data-action]");
      const optionElement = (event.target as Element).closest<HTMLElement>("[data-jump-option]");
      if (optionElement) {
        handlers.onJump(Number(optionElement.dataset.jumpOption));
        return;
      }
      if (!targetElement) return;
      switch (targetElement.dataset.action) {
        case "skip": handlers.onJump(0); break;
        case "continue": handlers.onContinue(); break;
        case "options": handlers.onOpenOptions(); break;
      }
    };
  }

  showToast(message: string, onUndo?: () => void): void {
    window.clearTimeout(this.toastTimer);
    const text = this.must<HTMLElement>(".toast-text");
    const button = this.must<HTMLButtonElement>('[data-action="undo"]');
    text.textContent = message;
    button.classList.toggle("hidden", !onUndo);
    button.onclick = onUndo ? () => {
      this.toast.classList.add("hidden");
      onUndo();
    } : null;
    this.toast.classList.remove("hidden");
    this.toastTimer = window.setTimeout(() => this.toast.classList.add("hidden"), 8_000);
  }

  hideToast(): void {
    window.clearTimeout(this.toastTimer);
    this.toast.classList.add("hidden");
  }

  showCompanionNotice(storeUrl: string): void {
    const notice = this.must<HTMLElement>(".companion");
    this.must<HTMLAnchorElement>(".companion-actions a").href = storeUrl;
    notice.classList.remove("hidden");
  }

  hideCompanionNotice(): void {
    this.must<HTMLElement>(".companion").classList.add("hidden");
  }

  showStatus(message: string, onOpenOptions?: () => void, visibleMs = 9_000): void {
    window.clearTimeout(this.statusTimer);
    this.status.replaceChildren(document.createTextNode(message));
    if (onOpenOptions) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = "打开设置";
      button.onclick = onOpenOptions;
      this.status.append(button);
    }
    this.status.classList.remove("hidden");
    this.statusTimer = window.setTimeout(() => this.status.classList.add("hidden"), visibleMs);
  }

  clear(): void {
    this.hidePrompt();
    this.hideToast();
    this.hideCompanionNotice();
    window.clearTimeout(this.statusTimer);
    this.status.classList.add("hidden");
  }
}
