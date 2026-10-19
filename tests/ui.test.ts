// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ExtensionUi } from "../src/content/ui";
import { VCaptionsAdapter } from "../src/content/vcaptions";
import type { Segment } from "../src/core/types";

const segment: Segment = {
  id: "segment-1",
  startMs: 10_000,
  endMs: 20_000,
  matchedKeywords: ["ACEMAGIC"],
  adContextTerms: ["严选", "优惠", "质保"],
  hitCueIds: ["1", "2"],
  cues: [
    { id: "1", startMs: 10_000, endMs: 13_000, text: "介绍一下 ACEMAGIC" },
    { id: "2", startMs: 17_000, endMs: 18_000, text: "进入评论区领优惠" }
  ]
};

describe("vCaptions adapter", () => {
  beforeEach(() => {
    document.documentElement.innerHTML = "<body></body>";
  });

  it("reads the current embedded subtitle", () => {
    const host = document.createElement("div");
    host.id = "vcaptions-subtitle-bar-root";
    const shadow = host.attachShadow({ mode: "open" });
    const bar = document.createElement("div");
    bar.id = "vcaptions-subtitle";
    bar.innerText = "当前字幕";
    shadow.append(bar);
    document.body.append(host);
    expect(new VCaptionsAdapter().getCurrentSubtitle()).toBe("当前字幕");
  });

  it("clicks a timestamped subtitle item when the current version exposes one", () => {
    const host = document.createElement("div");
    host.id = "vcaptions-subtitle-bar-root";
    const shadow = host.attachShadow({ mode: "open" });
    const button = document.createElement("button");
    button.setAttribute("data-from-ms", "12300");
    button.textContent = "字幕项";
    const click = vi.fn();
    button.addEventListener("click", click);
    shadow.append(button);
    document.body.append(host);
    expect(new VCaptionsAdapter().tryClickTime(12_000)).toBe(true);
    expect(click).toHaveBeenCalledOnce();
  });
});

describe("prompt UI", () => {
  beforeEach(() => {
    document.documentElement.innerHTML = "<body></body>";
  });

  it("shows keywords, subtitle quotes, comment evidence, and skip action", () => {
    const ui = new ExtensionUi();
    const onSkip = vi.fn();
    ui.showPrompt(segment, {
      found: true,
      keyword: "ACEMAGIC",
      author: "UP主",
      text: "本期由 ACEMAGIC 赞助"
    }, { onSkip, onContinue: vi.fn(), onOpenOptions: vi.fn() });
    const root = document.getElementById("bili-ad-skipper-root")?.shadowRoot;
    expect(root?.textContent).toContain("检测到广告片段");
    expect(root?.textContent).toContain("UP 主置顶评论也提及该产品");
    expect(root?.textContent).toContain("介绍一下 ACEMAGIC");
    expect(root?.textContent).toContain("同时识别到推广语境");
    root?.querySelector<HTMLButtonElement>('[data-action="skip"]')?.click();
    expect(onSkip).toHaveBeenCalledOnce();
  });

  it("labels context-only detections as suspected sponsored segments", () => {
    const ui = new ExtensionUi();
    ui.showPrompt({ ...segment, matchedKeywords: [], adContextTerms: ["好消息", "官方旗舰店", "优惠券", "点击"] }, null, {
      onSkip: vi.fn(), onContinue: vi.fn(), onOpenOptions: vi.fn()
    });
    const root = document.getElementById("bili-ad-skipper-root")?.shadowRoot;
    expect(root?.textContent).toContain("检测到疑似商单片段");
    expect(root?.textContent).toContain("推广语境触发");
  });

  it("shows AI confidence for AI-detected segments", () => {
    const ui = new ExtensionUi();
    ui.showPrompt({ ...segment, matchedKeywords: [], aiConfidence: 0.91 }, null, {
      onSkip: vi.fn(), onContinue: vi.fn(), onOpenOptions: vi.fn()
    });
    const root = document.getElementById("bili-ad-skipper-root")?.shadowRoot;
    expect(root?.textContent).toContain("AI 识别到疑似广告片段");
    expect(root?.textContent).toContain("AI 91%");
  });

  it("shows an optional vCaptions installation notice with the store link", () => {
    const ui = new ExtensionUi();
    ui.showCompanionNotice("https://microsoftedge.microsoft.com/addons/detail/example");
    const root = document.getElementById("bili-ad-skipper-root")?.shadowRoot;
    expect(root?.textContent).toContain("可选依赖：未检测到 vCaptions");
    expect(root?.querySelector<HTMLAnchorElement>(".companion-actions a")?.href).toBe("https://microsoftedge.microsoft.com/addons/detail/example");
  });

  it("shows a danmaku jump prompt with the target time", () => {
    const ui = new ExtensionUi();
    const onSkip = vi.fn();
    ui.showJumpPrompt([
      { targetMs: 496_000, count: 3, samples: ["空降八一六"] },
      { targetMs: 512_000, count: 1, samples: ["跳到8:32"] }
    ], { onJump: onSkip, onContinue: vi.fn(), onOpenOptions: vi.fn() });
    const root = document.getElementById("bili-ad-skipper-root")?.shadowRoot;
    expect(root?.textContent).toContain("检测到空降时间");
    expect(root?.textContent).toContain("8:16");
    expect(root?.textContent).toContain("8:32");
    expect(root?.textContent).toContain("空降八一六");
    root?.querySelector<HTMLButtonElement>('[data-action="skip"]')?.click();
    expect(onSkip).toHaveBeenCalledWith(0);
    onSkip.mockClear();
    root?.querySelector<HTMLButtonElement>('[data-jump-option="1"]')?.click();
    expect(onSkip).toHaveBeenCalledWith(1);
  });
});
