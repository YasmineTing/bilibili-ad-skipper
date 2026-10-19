import { buildSegments, matchedKeywords, mergeSegmentList, nextCueForTarget } from "../core/segments";
import { matchAdContext } from "../core/ad-context";
import type { DanmakuJumpHint } from "../core/danmaku";
import type { AiAnalysisResponse, BackgroundRequest, BackgroundResponse, DanmakuResponse, Segment, SubtitleBundle } from "../core/types";
import {
  DEFAULT_SETTINGS,
  loadSettings,
  SETTINGS_KEY,
  sanitizeSettings,
  type Settings
} from "../settings";
import { findVideoElement, parseVideoRef, videoKey, type VideoRef } from "./bilibili";
import { FloatingPanelHost } from "./floating-host";
import { ExtensionUi, type JumpOptionView } from "./ui";
import { VCaptionsAdapter } from "./vcaptions";

const VCAPTIONS_STORE_URL = "https://microsoftedge.microsoft.com/addons/detail/vcaptions-%E7%BD%91%E7%AB%99%E8%A7%86%E9%A2%91%E5%AD%97%E5%B9%95%E5%88%97%E8%A1%A8/lignnlhlpiefmcjkdkmfjdckhlaiajan?hl=zh-CN";

function formatClock(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`
    : `${minutes}:${String(rest).padStart(2, "0")}`;
}

interface DanmakuJumpOption {
  targetMs: number;
  hint: DanmakuJumpHint;
  cluster: DanmakuJumpHint[];
  samples: string[];
}

function sendBackground(message: BackgroundRequest): Promise<BackgroundResponse | AiAnalysisResponse | DanmakuResponse | { ok: true }> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response: BackgroundResponse | AiAnalysisResponse | DanmakuResponse | { ok: true } | undefined) => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
        return;
      }
      if (!response) {
        reject(new Error("扩展后台没有响应"));
        return;
      }
      resolve(response);
    });
  });
}

function cloneDefaults(): Settings {
  return { ...DEFAULT_SETTINGS, keywords: [...DEFAULT_SETTINGS.keywords] };
}

class AdSkipper {
  private settings: Settings = cloneDefaults();
  private readonly ui = new ExtensionUi();
  private readonly floatingPanel = new FloatingPanelHost();
  private readonly vcaptions = new VCaptionsAdapter();
  private ref: VideoRef | null = null;
  private video: HTMLVideoElement | null = null;
  private key = "";
  private bundle: SubtitleBundle | null = null;
  private segments: Segment[] = [];
  private aiSegments: Segment[] = [];
  private danmakuHints: DanmakuJumpHint[] = [];
  private danmakuLoadedForCid = 0;
  private danmakuLoadedForKey = "";
  private readonly handledDanmakuHints = new Set<string>();
  private lastJumpPanelUpdate = -1;
  private readonly ignored = new Set<string>();
  private activePrompt: { segment: Segment; wasPlaying: boolean; jumpOptions?: DanmakuJumpOption[] } | null = null;
  private skipBusy = false;
  private loadToken = 0;
  private refreshing = false;
  private emptyWordsNotified = "";
  private analyzedAiKey = "";
  private vcaptionsCheckTimer = 0;
  private companionPromptShown = false;
  private readonly onPlayback = (): void => { void this.checkPlayback(); };
  private readonly onMetadata = (): void => { this.rebuildSegments(); };

  async start(): Promise<void> {
    await this.floatingPanel.mount();
    this.floatingPanel.update({
      statusTitle: "正在初始化",
      statusDetail: "连接本地规则并等待 B 站页面。",
      statusTone: "info",
      aiStatus: "未启用"
    });
    this.floatingPanel.log("info", "悬浮窗已启动");
    try {
      this.settings = await loadSettings();
    } catch {
      this.settings = cloneDefaults();
    }
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== "local" || !changes[SETTINGS_KEY]) return;
      void this.handleSettingsChanged(changes[SETTINGS_KEY].newValue as Partial<Settings> | undefined);
    });
    await this.refresh(false);
    window.setInterval(() => { void this.refresh(false); }, 1_000);
    window.setInterval(() => { void this.checkPlayback(); }, 500);
  }

  private async handleSettingsChanged(value: Partial<Settings> | undefined): Promise<void> {
    this.settings = sanitizeSettings(value);
    this.floatingPanel.log("info", "设置已更新，重新分析当前视频");
    this.floatingPanel.update({
      aiStatus: this.settings.aiEnabled ? "等待分析" : "未启用",
      ...(this.settings.danmakuJumpEnabled ? {} : { jumpCandidates: [] })
    });
    this.cancelPrompt(true);
    this.ignored.clear();
    this.segments = [];
    this.aiSegments = [];
    this.analyzedAiKey = "";
    this.emptyWordsNotified = "";
    await this.refresh(true);
  }

  private async refresh(forceReload: boolean): Promise<void> {
    if (this.refreshing) return;
    this.refreshing = true;
    try {
      const nextRef = parseVideoRef();
      const nextVideo = findVideoElement();
      const nextKey = videoKey(nextRef);
      if (!nextRef || !nextVideo) {
        window.clearTimeout(this.vcaptionsCheckTimer);
        if (this.key) {
          this.floatingPanel.log("info", "已离开视频页面");
          this.resetPlaybackState();
        }
        this.ref = null;
        this.video = null;
        this.key = "";
        this.ui.clear();
        this.floatingPanel.update({
          statusTitle: "等待进入视频页面",
          statusDetail: "打开 B 站视频后会自动读取字幕并扫描广告。",
          statusTone: "info",
          videoTitle: "—",
          segmentCount: 0,
          aiStatus: this.settings.aiEnabled ? "等待字幕" : "未启用",
          showVCaptionsNotice: false,
          jumpCandidates: []
        });
        return;
      }

      const changed = nextKey !== this.key || nextVideo !== this.video;
      if (changed || forceReload) {
        if (changed) this.replaceVideo(nextVideo);
        this.ref = nextRef;
        this.key = nextKey;
        if (changed) {
          this.floatingPanel.update({
            statusTitle: "正在读取字幕",
            statusDetail: `视频 ${nextKey}`,
            statusTone: "info",
            videoTitle: document.title.replace(/[_\-]哔哩哔哩_bilibili\s*$/i, "").trim(),
            segmentCount: 0,
            aiStatus: this.settings.aiEnabled ? "等待字幕" : "未启用",
            showVCaptionsNotice: false,
            jumpCandidates: []
          });
          this.floatingPanel.log("info", `进入视频 ${nextKey}`);
          this.scheduleVCaptionsCheck(nextKey);
        }
        await this.loadForCurrentVideo(changed);
      }
    } finally {
      this.refreshing = false;
    }
  }

  private replaceVideo(video: HTMLVideoElement): void {
    if (this.video) {
      this.video.removeEventListener("play", this.onPlayback);
      this.video.removeEventListener("timeupdate", this.onPlayback);
      this.video.removeEventListener("seeked", this.onPlayback);
      this.video.removeEventListener("loadedmetadata", this.onMetadata);
    }
    this.video = video;
    video.addEventListener("play", this.onPlayback);
    video.addEventListener("timeupdate", this.onPlayback);
    video.addEventListener("seeked", this.onPlayback);
    video.addEventListener("loadedmetadata", this.onMetadata);
  }

  private scheduleVCaptionsCheck(key: string): void {
    window.clearTimeout(this.vcaptionsCheckTimer);
    this.vcaptionsCheckTimer = window.setTimeout(() => {
      if (this.key !== key) return;
      const detected = this.vcaptions.isDetected();
      this.floatingPanel.update({ showVCaptionsNotice: !detected });
      if (!detected) {
        this.floatingPanel.log("warn", "未检测到 vCaptions 字幕栏；B 站字幕识别仍可继续");
        if (!this.companionPromptShown) {
          this.companionPromptShown = true;
          this.ui.showCompanionNotice(VCAPTIONS_STORE_URL);
        }
      }
    }, 4_000);
  }

  private resetPlaybackState(): void {
    this.cancelPrompt(false);
    this.ignored.clear();
    this.bundle = null;
    this.segments = [];
    this.aiSegments = [];
    this.danmakuHints = [];
    this.danmakuLoadedForCid = 0;
    this.danmakuLoadedForKey = "";
    this.handledDanmakuHints.clear();
    this.lastJumpPanelUpdate = -1;
    this.analyzedAiKey = "";
    this.ui.hideToast();
    this.loadToken += 1;
  }

  private async loadForCurrentVideo(changedVideo: boolean, attempt = 0): Promise<void> {
    const token = ++this.loadToken;
    if (changedVideo) {
      this.ui.clear();
      this.ignored.clear();
      this.bundle = null;
      this.segments = [];
      this.aiSegments = [];
      this.danmakuHints = [];
      this.danmakuLoadedForCid = 0;
      this.danmakuLoadedForKey = "";
      this.handledDanmakuHints.clear();
      this.lastJumpPanelUpdate = -1;
      this.analyzedAiKey = "";
    }

    if (this.settings.keywords.length === 0 && !this.settings.detectContextAds && !this.settings.aiEnabled && !this.settings.danmakuJumpEnabled) {
      this.bundle = null;
      this.segments = [];
      this.aiSegments = [];
      if (this.emptyWordsNotified !== this.key) {
        this.emptyWordsNotified = this.key;
        this.floatingPanel.update({
          statusTitle: "没有启用识别方式",
          statusDetail: "产品词、通用商单检测和 AI 均未启用。",
          statusTone: "warn",
          segmentCount: 0
        });
        this.floatingPanel.log("warn", "产品词、通用检测和 AI 均未启用");
        this.ui.showStatus("产品词、通用检测、AI 和弹幕空降均未启用。请启用至少一种识别方式。", () => { void this.openOptions(); });
      }
      return;
    }

    const ref = this.ref;
    if (!ref) return;
    try {
      const response = await sendBackground({
        type: "loadSubtitles",
        bvid: ref.bvid,
        aid: ref.aid,
        page: ref.page,
        keywords: this.settings.keywords,
        includeCommentEvidence: this.settings.showCommentEvidence
      });
      if (token !== this.loadToken || this.key !== videoKey(ref)) return;
      if (!("ok" in response) || !response.ok) {
        this.bundle = null;
        this.segments = [];
        const code = "code" in response ? response.code : "network";
        const retryable = code === "subtitle_loading" || code === "no_subtitles" || code === "login_required";
        if (retryable && attempt < 5) {
          if (attempt === 0) {
            this.floatingPanel.update({ statusTitle: "等待字幕", statusDetail: "B 站字幕尚未就绪，正在自动重试。", statusTone: "info" });
            this.floatingPanel.log("info", "等待 B 站字幕加载");
            this.ui.showStatus("正在等待 B 站字幕加载，稍后会自动重试。", () => { void this.openOptions(); }, 5_000);
          }
          const scheduledToken = this.loadToken;
          window.setTimeout(() => {
            if (this.loadToken === scheduledToken && this.key === videoKey(ref)) {
              void this.loadForCurrentVideo(false, attempt + 1);
            }
          }, 1_800);
          return;
        }
        const message = "message" in response ? response.message : "读取字幕失败";
        const vcHint = this.vcaptions.isPresent()
          ? " vCaptions 2.4.6 的内嵌栏只显示当前句，扩展需要完整时间轴才能安全跳过。"
          : "";
        this.floatingPanel.update({ statusTitle: "字幕读取失败", statusDetail: message, statusTone: "error", segmentCount: 0 });
        this.floatingPanel.log("error", message);
        this.ui.showStatus(`${message}${vcHint}`, () => { void this.openOptions(); });
        void this.loadDanmakuForCurrentVideo(token);
        return;
      }
      if (!("data" in response)) {
        this.floatingPanel.update({ statusTitle: "字幕数据无效", statusTone: "error" });
        this.floatingPanel.log("error", "扩展后台返回了无效的字幕结果");
        this.ui.showStatus("扩展后台返回了无效的字幕结果");
        return;
      }
      this.bundle = response.data;
      this.rebuildSegments();
      this.floatingPanel.update({
        statusTitle: this.segments.length > 0 ? `已扫描 ${this.segments.length} 个广告片段` : "字幕已就绪",
        statusDetail: this.segments.length > 0 ? "到达片段时会按设置提示或跳过。" : "当前规则未发现广告片段。",
        statusTone: this.segments.length > 0 ? "ok" : "info",
        videoTitle: this.bundle.partTitle ? `${this.bundle.title} · ${this.bundle.partTitle}` : this.bundle.title,
        segmentCount: this.segments.length,
        aiStatus: this.settings.aiEnabled ? "等待 AI" : "未启用"
      });
      this.floatingPanel.log("success", `字幕已载入：${this.bundle.cues.length} 条，扫描到 ${this.segments.length} 个片段`);
      if (this.segments.length > 0) {
        this.ui.showStatus(`字幕已就绪：扫描到 ${this.segments.length} 个广告片段。`, undefined, 4_500);
      } else {
        this.ui.showStatus("字幕已就绪：未发现符合当前规则的广告片段。", undefined, 4_500);
      }
      void this.runAiAnalysis(token);
      void this.loadDanmakuForCurrentVideo(token, response.data.cid);
    } catch (error) {
      if (token !== this.loadToken) return;
      this.floatingPanel.update({ statusTitle: "字幕读取异常", statusDetail: error instanceof Error ? error.message : "未知错误", statusTone: "error" });
      this.floatingPanel.log("error", error instanceof Error ? error.message : "读取字幕失败");
      this.ui.showStatus(error instanceof Error ? error.message : "读取字幕失败", () => { void this.openOptions(); });
      void this.loadDanmakuForCurrentVideo(token);
    }
  }

  private rebuildSegments(): void {
    if (!this.bundle) {
      this.segments = [];
      return;
    }
    const mediaDuration = this.video && Number.isFinite(this.video.duration) ? this.video.duration * 1000 : this.bundle.durationMs;
    const heuristic = buildSegments(this.bundle.cues, this.settings.keywords, this.settings, mediaDuration);
    this.segments = mergeSegmentList([...heuristic, ...this.aiSegments]);
  }

  private async runAiAnalysis(token: number): Promise<void> {
    const bundle = this.bundle;
    if (!bundle || !this.settings.aiEnabled) return;
    const cacheKey = `${this.key}:${bundle.cues.length}:${this.settings.aiModel}:${this.settings.aiMinConfidence}`;
    if (cacheKey === this.analyzedAiKey) return;
    if (!this.settings.aiEndpoint || !this.settings.aiModel) {
      this.floatingPanel.update({ aiStatus: "配置不完整", statusTone: "warn" });
      this.floatingPanel.log("warn", "AI 已启用，但 API 地址或模型未配置");
      this.ui.showStatus("AI 已启用，但 API 地址或模型未配置。", () => this.floatingPanel.openTab("ai"));
      return;
    }
    this.floatingPanel.update({ aiStatus: "正在分析", statusDetail: `模型：${this.settings.aiModel}` });
    this.floatingPanel.log("info", `AI 开始分析 ${bundle.cues.length} 条字幕（${this.settings.aiModel}）`);
    this.ui.showStatus("AI 正在分析字幕中的广告片段…", undefined, 12_000);
    try {
      const response = await sendBackground({
        type: "analyzeAdsWithAi",
        title: bundle.title,
        durationMs: bundle.durationMs,
        cues: bundle.cues
      });
      if (token !== this.loadToken) return;
      if (!("ok" in response) || !response.ok || !("segments" in response)) {
        const message = "message" in response ? response.message : "AI 返回了无效结果";
        this.floatingPanel.update({ aiStatus: "分析失败", statusDetail: message, statusTone: "warn" });
        this.floatingPanel.log("error", `AI 分析失败：${message}`);
        this.ui.showStatus(`AI 分析失败：${message}`, () => this.floatingPanel.openTab("ai"));
        return;
      }
      const duration = bundle.durationMs;
      this.aiSegments = response.segments.flatMap((item) => {
        const startCue = bundle.cues[item.startCueIndex];
        const endCue = bundle.cues[item.endCueIndex];
        if (!startCue || !endCue) return [];
        const startMs = Math.max(0, item.startMs - this.settings.beforeBufferSeconds * 1000);
        const endMs = Math.min(duration, item.endMs + this.settings.afterBufferSeconds * 1000);
        if (endMs <= startMs) return [];
        const included = bundle.cues.filter((cue) => cue.startMs < item.endMs && cue.endMs > item.startMs);
        return [{
          id: `ai:${item.startCueIndex}:${item.endCueIndex}:${Math.round(startMs)}:${Math.round(endMs)}`,
          startMs,
          endMs,
          hitCueIds: included.map((cue) => cue.id),
          matchedKeywords: Array.from(new Set(included.flatMap((cue) => matchedKeywords(cue.text, this.settings.keywords)))),
          adContextTerms: Array.from(new Set(included.flatMap((cue) => matchAdContext(cue.text).terms))),
          aiConfidence: item.confidence,
          cues: included
        } satisfies Segment];
      });
      this.analyzedAiKey = cacheKey;
      this.rebuildSegments();
      this.floatingPanel.update({
        statusTitle: `已扫描 ${this.segments.length} 个广告片段`,
        statusDetail: "本地规则与 AI 结果已合并。",
        statusTone: this.segments.length > 0 ? "ok" : "info",
        segmentCount: this.segments.length,
        aiStatus: response.segments.length > 0 ? `完成（${response.segments.length}）` : "完成，未发现额外片段"
      });
      this.floatingPanel.log(
        response.segments.length > 0 ? "success" : "info",
        response.segments.length > 0 ? `AI 返回 ${response.segments.length} 个片段` : "AI 未发现额外广告片段"
      );
      this.ui.showStatus(
        response.segments.length > 0
          ? `AI 完成：返回 ${response.segments.length} 个广告片段。`
          : "AI 完成：未发现额外广告片段。",
        undefined,
        5_000
      );
    } catch (error) {
      if (token !== this.loadToken) return;
      this.floatingPanel.update({
        aiStatus: "分析失败",
        statusDetail: error instanceof Error ? error.message : "AI 分析失败",
        statusTone: "warn"
      });
      this.floatingPanel.log("error", `AI 分析失败：${error instanceof Error ? error.message : "未知错误"}`);
      this.ui.showStatus(`AI 分析失败：${error instanceof Error ? error.message : "未知错误"}`, () => this.floatingPanel.openTab("ai"));
    }
  }

  private async loadDanmakuForCurrentVideo(token: number, cid?: number): Promise<void> {
    if (!this.settings.danmakuJumpEnabled) return;
    const ref = this.ref;
    if (!ref) return;
    const key = videoKey(ref);
    if ((cid && this.danmakuLoadedForCid === cid) || this.danmakuLoadedForKey === key) return;
    this.floatingPanel.log("info", "正在读取 B 站原生弹幕中的空降时间");
    try {
      const response = await sendBackground({
        type: "loadDanmaku",
        cid,
        bvid: ref.bvid,
        aid: ref.aid,
        page: ref.page
      });
      if (token !== this.loadToken || this.key !== key) return;
      if (!("ok" in response) || !response.ok || !("hints" in response)) {
        const message = "message" in response ? response.message : "弹幕返回格式无效";
        this.floatingPanel.log("warn", `弹幕读取失败：${message}`);
        return;
      }
      this.danmakuHints = response.hints;
      this.danmakuLoadedForCid = response.cid;
      this.danmakuLoadedForKey = key;
      this.lastJumpPanelUpdate = Math.floor(((this.video?.currentTime ?? 0) * 1000) / 2_000);
      const groupedCount = this.updatePanelJumpCandidates();
      this.floatingPanel.log(
        response.hints.length > 0 ? "success" : "info",
        response.hints.length > 0
          ? `弹幕已载入：${response.total} 条，解析到 ${response.hints.length} 条时间弹幕，显示 ${groupedCount} 个目标`
          : `弹幕已载入：${response.total} 条，未发现空降时间`
      );
    } catch (error) {
      if (token !== this.loadToken) return;
      this.floatingPanel.log("warn", `弹幕读取失败：${error instanceof Error ? error.message : "未知错误"}`);
    }
  }

  private findActiveSegment(nowMs: number): Segment | null {
    return this.segments.find((segment) =>
      !this.ignored.has(segment.id) && nowMs >= segment.startMs && nowMs < segment.endMs - 100
    ) ?? null;
  }

  private groupDanmakuOptions(candidates: DanmakuJumpHint[]): DanmakuJumpOption[] {
    if (candidates.length === 0) return [];
    const buckets = new Map<number, DanmakuJumpHint[]>();
    for (const hint of candidates) {
      const key = Math.round(hint.targetMs / 2_000);
      const bucket = buckets.get(key) ?? [];
      bucket.push(hint);
      buckets.set(key, bucket);
    }
    const ranked = Array.from(buckets.values()).map((bucket) => {
      const explicitCount = bucket.filter((hint) => hint.explicit).length;
      const chineseCount = bucket.filter((hint) => hint.kind === "chinese-digits").length;
      const latest = Math.max(...bucket.map((hint) => hint.atMs));
      const targetCounts = new Map<number, DanmakuJumpHint[]>();
      for (const hint of bucket) {
        const target = Math.round(hint.targetMs / 1_000) * 1_000;
        targetCounts.set(target, [...(targetCounts.get(target) ?? []), hint]);
      }
      const representativeGroup = Array.from(targetCounts.values()).sort((a, b) =>
        b.filter((hint) => hint.explicit).length - a.filter((hint) => hint.explicit).length || b.length - a.length
      )[0] ?? bucket;
      const hint = [...representativeGroup].sort((a, b) =>
        Number(b.explicit) - Number(a.explicit) || b.atMs - a.atMs
      )[0] ?? bucket[0]!;
      const samples = Array.from(new Set(bucket.map((item) => item.text))).slice(0, 3);
      return {
        bucket,
        representativeGroup,
        hint,
        samples,
        targetMs: hint.targetMs,
        explicitCount,
        chineseCount,
        latest
      };
    }).sort((a, b) =>
        (b.explicitCount * 100 + b.chineseCount * 5 + b.bucket.length * 10 + b.latest / 1_000_000) -
        (a.explicitCount * 100 + a.chineseCount * 5 + a.bucket.length * 10 + a.latest / 1_000_000)
      ).slice(0, 10);
    return ranked.map((item) => ({
      targetMs: item.targetMs,
      hint: item.hint,
      cluster: item.bucket,
      samples: item.samples
    }));
  }

  private findDanmakuJumpOptions(segment: Segment, nowMs: number): DanmakuJumpOption[] {
    if (!this.settings.danmakuJumpEnabled) return [];
    const video = this.video;
    if (!video || this.danmakuHints.length === 0) return [];
    const durationMs = Number.isFinite(video.duration) ? video.duration * 1000 : this.bundle?.durationMs ?? Number.POSITIVE_INFINITY;
    const fromMs = Math.max(0, segment.startMs - 120_000);
    const toMs = segment.endMs + 10_000;
    const minimumTarget = Math.max(nowMs + 2_000, segment.endMs + 500);
    return this.groupDanmakuOptions(this.danmakuHints.filter((hint) =>
      !this.handledDanmakuHints.has(hint.id) &&
      hint.atMs >= fromMs && hint.atMs <= toMs &&
      hint.targetMs > minimumTarget && hint.targetMs < durationMs - 300
    ));
  }

  private updatePanelJumpCandidates(): number {
    const video = this.video;
    if (!video || !this.settings.danmakuJumpEnabled) {
      this.floatingPanel.update({ jumpCandidates: [] });
      return 0;
    }
    const nowMs = video.currentTime * 1000;
    const durationMs = Number.isFinite(video.duration) ? video.duration * 1000 : this.bundle?.durationMs ?? Number.POSITIVE_INFINITY;
    const options = this.groupDanmakuOptions(this.danmakuHints);
    const candidates = options.map((option, index) => ({
      targetMs: option.targetMs,
      count: option.cluster.length,
      samples: option.samples,
      status: option.targetMs <= nowMs + 2_000 ? "past" as const
        : option.targetMs >= durationMs - 300 ? "beyond" as const
          : "available" as const,
      order: index
    })).sort((a, b) => {
      const rank = (status: "available" | "past" | "beyond"): number => status === "available" ? 0 : status === "past" ? 1 : 2;
      return rank(a.status) - rank(b.status) || a.order - b.order;
    }).slice(0, 10);
    this.floatingPanel.update({
      jumpCandidates: candidates.map(({ order: _order, ...candidate }) => candidate)
    });
    return candidates.length;
  }

  private async checkPlayback(): Promise<void> {
    const video = this.video;
    if (!video || this.skipBusy || this.activePrompt || video.paused || video.ended) return;
    const nowMs = video.currentTime * 1000;
    if (this.settings.danmakuJumpEnabled && Math.floor(nowMs / 2_000) !== this.lastJumpPanelUpdate) {
      this.lastJumpPanelUpdate = Math.floor(nowMs / 2_000);
      this.updatePanelJumpCandidates();
    }
    const segment = this.findActiveSegment(nowMs);
    if (!segment) return;
    const jumpOptions = this.findDanmakuJumpOptions(segment, nowMs);

    if (jumpOptions.length > 0) {
      for (const option of jumpOptions) {
        for (const hint of option.cluster) this.handledDanmakuHints.add(hint.id);
      }
      this.updatePanelJumpCandidates();
      const defaultJump = jumpOptions[0]!;
      this.activePrompt = { segment, wasPlaying: true, jumpOptions };
      video.pause();
      this.floatingPanel.update({
        statusTitle: "检测到空降时间",
        statusDetail: `${jumpOptions.length} 个未来目标，推荐 ${formatClock(defaultJump.targetMs)}`,
        statusTone: "warn"
      });
      this.floatingPanel.log("warn", `弹幕空降候选：${jumpOptions.map((option) => formatClock(option.targetMs)).join("、")}`);
      const view: JumpOptionView[] = jumpOptions.map((option) => ({
        targetMs: option.targetMs,
        count: option.cluster.length,
        samples: option.samples
      }));
      this.ui.showJumpPrompt(view, {
        onJump: (index) => { void this.performDanmakuJump(index); },
        onContinue: () => { this.continueWatching(); },
        onOpenOptions: () => { void this.openOptions(); }
      });
      return;
    }

    if (!segment) return;

    if (this.settings.confirmBeforeSkip) {
      this.activePrompt = { segment, wasPlaying: true };
      video.pause();
      this.floatingPanel.update({ statusTitle: "发现广告，等待确认", statusDetail: "已暂停播放，请在页面提示中选择。", statusTone: "warn" });
      this.floatingPanel.log("warn", `检测到广告片段 ${Math.round(segment.startMs / 1000)}–${Math.round(segment.endMs / 1000)} 秒`);
      const evidence = this.settings.showCommentEvidence ? this.bundle?.commentEvidence ?? null : null;
      this.ui.showPrompt(segment, evidence, {
        onSkip: () => { void this.performSkip(segment, true); },
        onContinue: () => { this.continueWatching(); },
        onOpenOptions: () => { void this.openOptions(); }
      });
    } else {
      await this.performSkip(segment, true);
    }
  }

  private async performSkip(segment: Segment, wasPlaying: boolean): Promise<void> {
    const video = this.video;
    if (!video || this.skipBusy) return;
    this.skipBusy = true;
    this.ui.hidePrompt();
    this.activePrompt = null;
    this.ignored.add(segment.id);
    const previousSeconds = video.currentTime;
    const targetSeconds = Math.min(video.duration || Number.POSITIVE_INFINITY, segment.endMs / 1000);
    const nextCue = this.bundle ? nextCueForTarget(this.bundle.cues, segment.endMs) : undefined;
    const preferredMs = nextCue && nextCue.startMs - segment.endMs <= 2_000 ? nextCue.startMs : segment.endMs;

    try {
      const clicked = this.vcaptions.tryClickTime(preferredMs);
      if (clicked) await new Promise((resolve) => window.setTimeout(resolve, 550));
      if (Math.abs(video.currentTime * 1000 - preferredMs) > 2_000) {
        video.currentTime = Math.min(targetSeconds, preferredMs / 1000);
      }
      if (wasPlaying) await video.play().catch(() => undefined);
      const skippedSeconds = Math.max(1, Math.round(video.currentTime - previousSeconds));
      this.floatingPanel.update({ statusTitle: `已跳过约 ${skippedSeconds} 秒`, statusDetail: "可点击页面底部提示撤销。", statusTone: "ok" });
      this.floatingPanel.log("success", `已跳过约 ${skippedSeconds} 秒广告片段`);
      this.ui.showToast(`已跳过约 ${skippedSeconds} 秒广告片段`, () => this.undoSkip(previousSeconds, wasPlaying, segment));
    } finally {
      this.skipBusy = false;
    }
  }

  private async performDanmakuJump(optionIndex = 0): Promise<void> {
    const active = this.activePrompt;
    const video = this.video;
    const option = active?.jumpOptions?.[optionIndex] ?? active?.jumpOptions?.[0];
    const hint = option?.hint;
    if (!active || !video || !hint || this.skipBusy) return;
    const nowMs = video.currentTime * 1000;
    const durationMs = Number.isFinite(video.duration) ? video.duration * 1000 : this.bundle?.durationMs ?? Number.POSITIVE_INFINITY;
    if (hint.targetMs <= nowMs + 500 || hint.targetMs >= durationMs - 300) {
      this.activePrompt = null;
      this.ignored.add(active.segment.id);
      this.ui.hidePrompt();
      this.floatingPanel.update({ statusTitle: "空降目标已过时", statusDetail: "目标时间必须晚于当前播放位置。", statusTone: "warn" });
      this.floatingPanel.log("warn", `忽略无效空降目标 ${formatClock(hint.targetMs)}`);
      if (active.wasPlaying) void video.play().catch(() => undefined);
      return;
    }

    this.skipBusy = true;
    this.ui.hidePrompt();
    this.activePrompt = null;
    this.ignored.add(active.segment.id);
    const previousSeconds = video.currentTime;
    try {
      video.currentTime = hint.targetMs / 1000;
      if (active.wasPlaying) await video.play().catch(() => undefined);
      this.floatingPanel.update({
        statusTitle: `已空降到 ${formatClock(hint.targetMs)}`,
        statusDetail: `来源弹幕：${hint.text}`,
        statusTone: "ok"
      });
      this.floatingPanel.log("success", `已空降到 ${formatClock(hint.targetMs)}`);
      this.ui.showToast(`已空降到 ${formatClock(hint.targetMs)}`, () =>
        this.undoSkip(previousSeconds, active.wasPlaying, active.segment)
      );
    } finally {
      this.skipBusy = false;
    }
  }

  private undoSkip(previousSeconds: number, wasPlaying: boolean, segment: Segment): void {
    const video = this.video;
    if (!video) return;
    this.ignored.add(segment.id);
    video.currentTime = previousSeconds;
    if (wasPlaying) void video.play().catch(() => undefined);
    this.floatingPanel.update({ statusTitle: "已撤销跳转", statusDetail: "该片段本次不会再次提示。", statusTone: "warn" });
    this.floatingPanel.log("warn", "已撤销跳转");
    this.ui.showStatus("已撤销跳转。这个片段在本次观看中不会再次自动提示。");
  }

  private continueWatching(): void {
    const active = this.activePrompt;
    if (!active) return;
    this.ignored.add(active.segment.id);
    this.activePrompt = null;
    this.ui.hidePrompt();
    this.floatingPanel.update({ statusTitle: "已选择继续观看", statusDetail: "该片段本次不再提示。", statusTone: "info" });
    this.floatingPanel.log("info", "继续观看广告片段");
    if (active.wasPlaying && this.video) void this.video.play().catch(() => undefined);
  }

  private cancelPrompt(restorePlayback: boolean): void {
    if (!this.activePrompt) return;
    const wasPlaying = this.activePrompt.wasPlaying;
    this.activePrompt = null;
    this.ui.hidePrompt();
    if (restorePlayback && wasPlaying && this.video) void this.video.play().catch(() => undefined);
  }

  private openOptions(): void {
    this.floatingPanel.openTab("settings");
  }
}

void new AdSkipper().start();
