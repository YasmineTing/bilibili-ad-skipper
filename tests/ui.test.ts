// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ExtensionUi } from "../src/content/ui";
import { VCaptionsAdapter } from "../src/content/vcaptions";

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

describe("jump feedback", () => {
  beforeEach(() => {
    document.documentElement.innerHTML = "<body></body>";
  });

  it("offers a return-to-previous-position button after a jump", () => {
    const ui = new ExtensionUi();
    const onUndo = vi.fn();
    ui.showToast("已跳过约 6 秒广告片段", onUndo);
    const root = document.getElementById("bili-ad-skipper-root")?.shadowRoot;
    expect(root?.textContent).toContain("已跳过约 6 秒广告片段");
    expect(root?.textContent).toContain("回到跳转前");
    root?.querySelector<HTMLButtonElement>('[data-action="undo"]')?.click();
    expect(onUndo).toHaveBeenCalledOnce();
  });

  it("hides the return button when there is nothing to undo", () => {
    const ui = new ExtensionUi();
    ui.showToast("已就绪");
    const root = document.getElementById("bili-ad-skipper-root")?.shadowRoot;
    expect(root?.querySelector('[data-action="undo"]')?.classList.contains("hidden")).toBe(true);
  });

  it("shows an optional vCaptions installation notice with the store link", () => {
    const ui = new ExtensionUi();
    ui.showCompanionNotice("https://microsoftedge.microsoft.com/addons/detail/example");
    const root = document.getElementById("bili-ad-skipper-root")?.shadowRoot;
    expect(root?.textContent).toContain("可选依赖：未检测到 vCaptions");
    expect(root?.querySelector<HTMLAnchorElement>(".companion-actions a")?.href).toBe(
      "https://microsoftedge.microsoft.com/addons/detail/example"
    );
  });

  it("shows a status line with an optional settings shortcut", () => {
    const ui = new ExtensionUi();
    const onOpen = vi.fn();
    ui.showStatus("正在等待 B 站字幕加载", onOpen);
    const root = document.getElementById("bili-ad-skipper-root")?.shadowRoot;
    expect(root?.textContent).toContain("正在等待 B 站字幕加载");
    root?.querySelector<HTMLButtonElement>(".status button")?.click();
    expect(onOpen).toHaveBeenCalledOnce();
  });
});
