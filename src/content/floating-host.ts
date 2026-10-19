export type PanelLogLevel = "info" | "success" | "warn" | "error";

export interface PanelLog {
  time: string;
  level: PanelLogLevel;
  message: string;
}

export interface FloatingPanelState {
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
const STORAGE_KEY = "floatingPanelState";
const COMPACT_WIDTH = 54;
const COMPACT_HEIGHT = 54;
const EXPANDED_WIDTH = 340;
const EXPANDED_HEIGHT = 470;

interface StoredPanelState {
  left?: number;
  top?: number;
}

export class FloatingPanelHost {
  private readonly host = document.createElement("div");
  private readonly frame = document.createElement("iframe");
  private ready = false;
  private hidden = false;
  private collapsed = true;
  private left = 0;
  private top = 0;
  private drag: { startX: number; startY: number; left: number; top: number } | null = null;
  private pendingTab: "status" | "settings" | "ai" | "logs" | null = null;
  private state: FloatingPanelState = {
    statusTitle: "准备中",
    statusDetail: "正在初始化广告识别。",
    statusTone: "info",
    showVCaptionsNotice: false,
    videoTitle: "—",
    segmentCount: 0,
    aiStatus: "未启用",
    jumpCandidates: [],
    logs: [],
    collapsed: true
  };

  constructor() {
    document.getElementById("bili-ad-skipper-floating")?.remove();
    this.host.id = "bili-ad-skipper-floating";
    this.host.style.cssText = "position:fixed;z-index:2147483645;border:0;background:transparent;color-scheme:light;pointer-events:auto;";
    const shadow = this.host.attachShadow({ mode: "open" });
    this.frame.title = "B站广告跳过设置与状态";
    this.frame.style.cssText = "display:block;width:100%;height:100%;border:0;background:transparent;color-scheme:light;";
    this.frame.setAttribute("allowtransparency", "true");
    shadow.append(this.frame);
    document.documentElement.appendChild(this.host);

    window.addEventListener("message", (event) => this.handleMessage(event));
    window.addEventListener("resize", () => this.applyPosition());
    chrome.runtime.onMessage.addListener((message: { type?: string }) => {
      if (message?.type === "toggleFloatingPanel") this.toggle();
      return false;
    });
  }

  async mount(): Promise<void> {
    try {
      const stored = (await chrome.storage.local.get(STORAGE_KEY))[STORAGE_KEY] as StoredPanelState | undefined;
      if (stored) {
        if (Number.isFinite(stored.left) && Number.isFinite(stored.top)) {
          this.left = stored.left!;
          this.top = stored.top!;
        }
      }
    } catch {
      // Use defaults when storage is unavailable.
    }
    this.collapsed = true;
    this.applySize();
    this.snapToSide();
    this.applyPosition();
    this.frame.src = chrome.runtime.getURL("floating.html");
  }

  show(): void {
    this.hidden = false;
    this.host.style.display = "block";
  }

  hide(): void {
    this.hidden = true;
    this.host.style.display = "none";
  }

  toggle(): void {
    if (this.hidden || this.host.style.display === "none") {
      this.show();
      if (this.collapsed) this.setCollapsed(false, true);
    } else {
      this.hide();
    }
  }

  update(patch: Partial<FloatingPanelState>): void {
    const next = { ...this.state, ...patch, collapsed: this.collapsed };
    if (JSON.stringify(next) === JSON.stringify(this.state)) return;
    this.state = next;
    this.postState();
  }

  openTab(tab: "status" | "settings" | "ai" | "logs"): void {
    this.show();
    if (this.collapsed) this.setCollapsed(false, true);
    if (this.ready) this.frame.contentWindow?.postMessage({ source: HOST_SOURCE, type: "select-tab", tab }, "*");
    else this.pendingTab = tab;
  }

  log(level: PanelLogLevel, message: string): void {
    const time = new Date().toLocaleTimeString("zh-CN", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
    this.state.logs = [...this.state.logs.slice(-99), { time, level, message }];
    this.postState();
  }

  private postState(): void {
    if (!this.ready) return;
    this.frame.contentWindow?.postMessage({
      source: HOST_SOURCE,
      type: "state",
      state: { ...this.state, collapsed: this.collapsed }
    }, "*");
  }

  private handleMessage(event: MessageEvent): void {
    if (event.source !== this.frame.contentWindow) return;
    const data = event.data as { source?: string; type?: string; collapsed?: boolean; screenX?: number; screenY?: number } | undefined;
    if (data?.source !== PANEL_SOURCE) return;
    if (data.type === "ready") {
      this.ready = true;
      this.postState();
      if (this.pendingTab) {
        this.frame.contentWindow?.postMessage({ source: HOST_SOURCE, type: "select-tab", tab: this.pendingTab }, "*");
        this.pendingTab = null;
      }
      return;
    }
    if (data.type === "set-collapsed") {
      this.setCollapsed(data.collapsed !== false, true);
      return;
    }
    if (data.type === "drag-start" && Number.isFinite(data.screenX) && Number.isFinite(data.screenY)) {
      const rect = this.host.getBoundingClientRect();
      this.drag = { startX: data.screenX!, startY: data.screenY!, left: rect.left, top: rect.top };
      return;
    }
    if (data.type === "drag-move" && this.drag && Number.isFinite(data.screenX) && Number.isFinite(data.screenY)) {
      this.left = this.drag.left + data.screenX! - this.drag.startX;
      this.top = this.drag.top + data.screenY! - this.drag.startY;
      this.applyPosition();
      return;
    }
    if (data.type === "drag-end") {
      this.drag = null;
      void this.persist();
    }
  }

  private setCollapsed(collapsed: boolean, persist: boolean): void {
    this.collapsed = collapsed;
    this.applySize();
    if (collapsed) this.snapToSide();
    this.applyPosition();
    this.state.collapsed = collapsed;
    this.postState();
    if (persist) void this.persist();
  }

  private dimensions(): { width: number; height: number } {
    const maxWidth = Math.max(300, window.innerWidth - 24);
    const maxHeight = Math.max(COMPACT_HEIGHT, window.innerHeight - 24);
    return this.collapsed
      ? { width: Math.min(COMPACT_WIDTH, maxWidth), height: Math.min(COMPACT_HEIGHT, maxHeight) }
      : { width: Math.min(EXPANDED_WIDTH, maxWidth), height: Math.min(EXPANDED_HEIGHT, maxHeight) };
  }

  private applySize(): void {
    const size = this.dimensions();
    this.host.style.width = `${size.width}px`;
    this.host.style.height = `${size.height}px`;
    if (this.left === 0 && this.top === 0) {
      this.left = Math.max(8, window.innerWidth - size.width - 8);
      this.top = Math.max(8, Math.round((window.innerHeight - size.height) / 2));
    }
    this.applyPosition();
  }

  private applyPosition(): void {
    const size = this.dimensions();
    this.host.style.width = `${size.width}px`;
    this.host.style.height = `${size.height}px`;
    this.left = Math.min(Math.max(8, this.left), Math.max(8, window.innerWidth - size.width - 8));
    this.top = Math.min(Math.max(8, this.top), Math.max(8, window.innerHeight - size.height - 8));
    this.host.style.left = `${this.left}px`;
    this.host.style.top = `${this.top}px`;
    this.host.style.right = "auto";
    this.host.style.bottom = "auto";
  }

  private async persist(): Promise<void> {
    try {
      await chrome.storage.local.set({
        [STORAGE_KEY]: { left: this.left, top: this.top }
      });
    } catch {
      // Dragging and collapsing still work for the current page.
    }
  }

  private snapToSide(): void {
    const size = this.dimensions();
    const center = this.left + size.width / 2;
    this.left = center <= window.innerWidth / 2 ? 8 : Math.max(8, window.innerWidth - size.width - 8);
    this.top = Math.max(8, Math.round((window.innerHeight - size.height) / 2));
  }
}
