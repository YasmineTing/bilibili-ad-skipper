const STYLES = `
:host { all: initial; }
*, *::before, *::after { box-sizing: border-box; }
.layer { position: fixed; inset: 0; z-index: 2147483647; pointer-events: none; font-family: "Segoe UI", "Microsoft YaHei", system-ui, sans-serif; }
.toast { position: fixed; left: 50%; bottom: 30px; display: flex; align-items: center; gap: 14px; padding: 11px 14px 11px 16px; border: 1px solid rgba(255,255,255,.14); border-radius: 12px; color: #eef4fa; background: rgba(20,25,33,.95); box-shadow: 0 12px 36px rgba(0,0,0,.3); transform: translateX(-50%); pointer-events: auto; font-size: 13px; }
.toast button { padding: 5px 9px; border: 1px solid rgba(255,255,255,.16); border-radius: 7px; color: #9fe3ff; background: transparent; cursor: pointer; font: inherit; }
.toast button:hover { background: rgba(255,255,255,.08); }
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
@media (max-width: 620px) { .status { left: 12px; } }
`;

export class ExtensionUi {
  private readonly root: ShadowRoot;
  private readonly toast: HTMLElement;
  private readonly status: HTMLElement;
  private toastTimer = 0;
  private statusTimer = 0;

  constructor() {
    document.getElementById("bili-ad-skipper-root")?.remove();
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
      <div class="toast hidden"><span class="toast-text"></span><button type="button" data-action="undo">回到跳转前</button></div>
      <div class="companion hidden" role="note" aria-label="vCaptions 安装提示">
        <div class="companion-copy"><strong>可选依赖：未检测到 vCaptions</strong><span>广告跳过仍可使用 B 站字幕；安装并启用 vCaptions 后还可查看完整字幕列表、翻译和点击字幕。</span><div class="companion-actions"><a href="#" target="_blank" rel="noopener noreferrer">安装或检查 vCaptions</a></div></div>
        <button type="button" class="companion-close" aria-label="关闭提示">×</button>
      </div>
      <div class="status hidden" role="status"></div>`;
    this.root.append(style, layer);
    document.documentElement.appendChild(host);
    this.toast = this.must<HTMLElement>(".toast");
    this.status = this.must<HTMLElement>(".status");
    this.must<HTMLButtonElement>(".companion-close").addEventListener("click", () => this.hideCompanionNotice());
  }

  private must<T extends Element>(selector: string): T {
    const element = this.root.querySelector<T>(selector);
    if (!element) throw new Error(`UI element missing: ${selector}`);
    return element;
  }

  showToast(message: string, onUndo?: () => void): void {
    window.clearTimeout(this.toastTimer);
    const text = this.must<HTMLElement>(".toast-text");
    const button = this.must<HTMLButtonElement>('[data-action="undo"]');
    text.textContent = message;
    button.classList.toggle("hidden", !onUndo);
    button.onclick = onUndo
      ? () => {
          this.toast.classList.add("hidden");
          onUndo();
        }
      : null;
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
    this.hideToast();
    this.hideCompanionNotice();
    window.clearTimeout(this.statusTimer);
    this.status.classList.add("hidden");
  }
}
