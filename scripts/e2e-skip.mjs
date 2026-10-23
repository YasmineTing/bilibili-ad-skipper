import { chromium } from "playwright-core";
import { mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";

const edgePath = process.env.EDGE_PATH || "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const extensionPath = resolve("dist");
const profileDir = resolve(".tmp-e2e-skip-profile");
await rm(profileDir, { recursive: true, force: true }).catch(() => undefined);
await mkdir(profileDir, { recursive: true });

const context = await chromium.launchPersistentContext(profileDir, {
  executablePath: edgePath,
  headless: true,
  args: [
    `--disable-extensions-except=${extensionPath}`,
    `--load-extension=${extensionPath}`,
    "--no-first-run",
    "--autoplay-policy=no-user-gesture-required",
    "--disable-features=msEdgeFirstRunExperience"
  ]
});

try {
  let worker = context.serviceWorkers()[0];
  if (!worker) worker = await context.waitForEvent("serviceworker", { timeout: 10_000 });
  const extensionId = new URL(worker.url()).host;
  const optionsPage = await context.newPage();
  await optionsPage.goto(`chrome-extension://${extensionId}/options.html`);
  await optionsPage.waitForSelector("#ai-provider");
  await optionsPage.waitForTimeout(300);
  const aiPreset = await optionsPage.evaluate(() => ({
    provider: document.querySelector("#ai-provider")?.value,
    endpoint: document.querySelector("#ai-endpoint")?.value,
    model: document.querySelector("#ai-model")?.value
  }));
  await optionsPage.locator("#rules-json").fill(JSON.stringify({
    rules: [{ name: "E2E 规则", keywords: ["ACEMAGIC"], required: ["优惠码"], minHits: 2, action: "skip" }]
  }));
  await optionsPage.locator("#rules-apply").click();
  await optionsPage.waitForFunction(() => document.querySelector("#rules-status")?.textContent?.includes("导入 1 条规则"));
  const rulesUi = await optionsPage.evaluate(() => ({
    count: document.querySelector("#rules-count")?.textContent,
    rows: document.querySelectorAll("#rules-list .rule-row").length,
    status: document.querySelector("#rules-status")?.textContent
  }));
  await optionsPage.locator("button[type='submit']").click();
  await optionsPage.waitForFunction(() => document.querySelector("#save-status")?.textContent?.includes("已保存"));
  const storedRules = await optionsPage.evaluate(async () => {
    const value = await chrome.storage.local.get("settings");
    return value.settings?.customRules;
  });
  if (!Array.isArray(storedRules) || storedRules.length !== 1 || storedRules[0]?.name !== "E2E 规则") {
    throw new Error(`自定义规则未正确保存：${JSON.stringify(storedRules)}`);
  }
  if (rulesUi.rows !== 1 || !rulesUi.status?.includes("导入 1 条规则")) {
    throw new Error(`自定义规则界面状态异常：${JSON.stringify(rulesUi)}`);
  }
  await optionsPage.evaluate(async () => {
    await chrome.storage.local.set({ settings: {
      keywords: ["ACEMAGIC", "优惠码"],
      confirmBeforeSkip: false,
      mergeGapSeconds: 8,
      beforeBufferSeconds: 1,
      afterBufferSeconds: 2
    } });
  });
  await optionsPage.close();

  const videoHtml = `<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0"><video id="v" muted style="width:640px;height:360px;background:#000"></video><script>
  const sampleRate=8000, seconds=20, samples=sampleRate*seconds;
  const buffer=new ArrayBuffer(44+samples*2), view=new DataView(buffer);
  const put=(offset,text)=>[...text].forEach((c,i)=>view.setUint8(offset+i,c.charCodeAt(0)));
  put(0,'RIFF'); view.setUint32(4,36+samples*2,true); put(8,'WAVE'); put(12,'fmt ');
  view.setUint32(16,16,true); view.setUint16(20,1,true); view.setUint16(22,1,true);
  view.setUint32(24,sampleRate,true); view.setUint32(28,sampleRate*2,true);
  view.setUint16(32,2,true); view.setUint16(34,16,true); put(36,'data'); view.setUint32(40,samples*2,true);
  const v=document.querySelector('#v'); v.src=URL.createObjectURL(new Blob([buffer],{type:'audio/wav'}));
  window.__testVideo=v;
</script></body></html>`;
  await context.route("https://www.bilibili.com/video/BV1Test0001/", (route) => route.fulfill({ status: 200, contentType: "text/html", body: videoHtml }));
  await context.route("https://www.bilibili.com/video/BV1Test0001/?p=3", (route) => route.fulfill({ status: 200, contentType: "text/html", body: videoHtml }));
  await context.route("https://www.bilibili.com/video/BV1Test0001/?p=4", (route) => route.fulfill({ status: 200, contentType: "text/html", body: videoHtml }));
  await context.route("https://www.bilibili.com/", (route) => route.fulfill({ status: 200, contentType: "text/html", body: "<!doctype html><html><body><h1>Bilibili Home</h1></body></html>" }));
  await context.route("https://api.bilibili.com/x/web-interface/view?bvid=BV1Test0001", (route) => route.fulfill({
    status: 200, contentType: "application/json", body: JSON.stringify({ code: 0, message: "OK", data: { aid: 1, bvid: "BV1Test0001", title: "测试视频", duration: 20, pages: [{ cid: 2, page: 1, part: "P1", duration: 20 }, { cid: 3, page: 2, part: "P2", duration: 20 }, { cid: 4, page: 3, part: "P3", duration: 20 }, { cid: 5, page: 4, part: "P4", duration: 20 }] } })
  }));
  let playerRequests = 0;
  await context.route("https://api.bilibili.com/x/player/wbi/v2?aid=1&cid=2", (route) => {
    playerRequests += 1;
    const subtitleUrl = playerRequests === 1 ? "" : "https://aisubtitle.hdslb.com/test.json";
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ code: 0, message: "OK", data: { aid: 1, bvid: "BV1Test0001", cid: 2, subtitle: { subtitles: [{ lan: "zh-CN", lan_doc: "中文", subtitle_url: subtitleUrl }] } } })
    });
  });
  await context.route("https://aisubtitle.hdslb.com/test.json", (route) => route.fulfill({
    status: 200, contentType: "application/json", body: JSON.stringify({ body: [{ from: 1.5, to: 2.5, content: "这是 ACEMAGIC 广告" }, { from: 3.8, to: 4.5, content: "优惠码 ABC" }] })
  }));
  await context.route("https://api.bilibili.com/x/player/v2?aid=1&cid=3", (route) => route.fulfill({
    status: 200, contentType: "application/json", body: JSON.stringify({ code: 0, message: "OK", data: { aid: 1, bvid: "BV1Test0001", cid: 3, subtitle: { subtitles: [{ lan: "zh-CN", lan_doc: "中文", subtitle_url: "https://aisubtitle.hdslb.com/test2.json" }] } } })
  }));
  await context.route("https://api.bilibili.com/x/player/wbi/v2?aid=1&cid=3", (route) => route.fulfill({
    status: 200, contentType: "application/json", body: JSON.stringify({ code: 0, message: "OK", data: { aid: 1, bvid: "BV1Test0001", cid: 3, subtitle: { subtitles: [{ lan: "zh-CN", lan_doc: "中文", subtitle_url: "https://aisubtitle.hdslb.com/test2.json" }] } } })
  }));
  await context.route("https://aisubtitle.hdslb.com/test2.json", (route) => route.fulfill({
    status: 200, contentType: "application/json", body: JSON.stringify({ body: [{ from: 10.5, to: 11.5, content: "P2 的 ACEMAGIC 广告" }, { from: 13.5, to: 14.2, content: "P2 优惠码" }] })
  }));
  await context.route("https://api.bilibili.com/x/player/wbi/v2?aid=1&cid=4", (route) => route.fulfill({
    status: 200, contentType: "application/json", body: JSON.stringify({ code: 0, message: "OK", data: { aid: 1, bvid: "BV1Test0001", cid: 4, subtitle: { subtitles: [{ lan: "zh-CN", lan_doc: "中文", subtitle_url: "https://aisubtitle.hdslb.com/test3.json" }] } } })
  }));
  await context.route("https://aisubtitle.hdslb.com/test3.json", (route) => route.fulfill({
    status: 200, contentType: "application/json", body: JSON.stringify({ body: [
      { from: 2.0, to: 3.5, content: "在正式开讲之前先别划走" },
      { from: 3.5, to: 5.0, content: "最近挖到宝了给大家推荐一个效率工具" },
      { from: 5.0, to: 6.5, content: "这款工具价格不贵功能很多" },
      { from: 6.5, to: 8.0, content: "官方旗舰店正品保障" },
      { from: 8.0, to: 9.5, content: "还能领专属优惠券" },
      { from: 9.5, to: 11.0, content: "点击下方链接下单" },
      { from: 13.0, to: 15.0, content: "我们回到案件本身" }
    ] })
  }));
  await context.route("https://api.bilibili.com/x/player/wbi/v2?aid=1&cid=5", (route) => route.fulfill({
    status: 200, contentType: "application/json", body: JSON.stringify({ code: 0, message: "OK", data: { aid: 1, bvid: "BV1Test0001", cid: 5, subtitle: { subtitles: [{ lan: "zh-CN", lan_doc: "中文", subtitle_url: "https://aisubtitle.hdslb.com/test4.json" }] } } })
  }));
  await context.route("https://aisubtitle.hdslb.com/test4.json", (route) => route.fulfill({
    status: 200, contentType: "application/json", body: JSON.stringify({ body: [
      { from: 0.2, to: 1.0, content: "这是一段普通内容" },
      { from: 1.2, to: 2.0, content: "这里开始测试广告" },
      { from: 15.0, to: 16.0, content: "正文继续" }
    ] })
  }));
  await context.route("https://comment.bilibili.com/5.xml", (route) => route.fulfill({
    status: 200, contentType: "application/xml", body: `<i><d p="0.8,1,25,16777215,0,0,0,0">空降0:01</d><d p="1.0,1,25,16777215,0,0,0,0">空降0:14</d><d p="1.05,1,25,16777215,0,0,0,0">空降0:14</d><d p="1.1,1,25,16777215,0,0,0,0">跳到0:16</d><d p="1.15,1,25,16777215,0,0,0,0">空降0:30</d><d p="1.2,1,25,16777215,0,0,0,0">666</d><d p="1.3,1,25,16777215,0,0,0,0">2333</d></i>`
  }));
  for (const cid of [2, 3, 4]) {
    await context.route(`https://comment.bilibili.com/${cid}.xml`, (route) => route.fulfill({
      status: 200, contentType: "application/xml", body: "<i></i>"
    }));
  }
  let aiRequests = 0;
  let aiRequestFormat = null;
  await context.route("https://api.bilibili.com/ai/v1/chat/completions", (route) => {
    aiRequests += 1;
    try { aiRequestFormat = route.request().postDataJSON().response_format ?? null; } catch {}
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ choices: [{ message: { content: JSON.stringify({ segments: [{ start_cue: 0, end_cue: 2, confidence: 0.9 }] }) } }] })
    });
  });
  await context.route("https://api.bilibili.com/x/v2/reply/main?type=1&oid=1&mode=3", (route) => route.fulfill({
    status: 200, contentType: "application/json", body: JSON.stringify({ code: 0, data: { top_replies: [{ rpid: 9, content: { message: "本期由 ACEMAGIC 赞助" }, member: { uname: "UP主" } }] } })
  }));

async function panelSubtitleState(page) {
  const frame = page.frames().find((item) => item.url().includes("/floating.html"));
  if (!frame) return "unknown";
  const state = await frame
    .evaluate(() => ({
      title: document.querySelector("#status-title")?.textContent ?? "",
      detail: document.querySelector("#status-detail")?.textContent ?? ""
    }))
    .catch(() => ({ title: "", detail: "" }));
  if (state.title.includes("失败")) return "failed";
  if (state.title.includes("扫描") || state.title.includes("字幕已就绪")) return "ready";
  return "pending";
}

async function loadVideoPage(page, url) {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    await page.goto(url, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("#bili-ad-skipper-root");
    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline) {
      const state = await panelSubtitleState(page);
      if (state === "ready") return;
      if (state === "failed") break;
      await page.waitForTimeout(400);
    }
    console.log(`字幕接口未命中（第 ${attempt} 次），重新加载页面`);
  }
  throw new Error("B 站字幕接口始终未返回可用数据，e2e mock 可能未生效");
}

  const page = await context.newPage();
  page.on("pageerror", (error) => console.log("PAGE_EXCEPTION", error.message));
  await loadVideoPage(page, "https://www.bilibili.com/video/BV1Test0001/");
  await page.waitForSelector("#bili-ad-skipper-floating");
  await page.waitForTimeout(700);
  const floatingFrame = page.frames().find((frame) => frame.url().includes("/floating.html"));
  if (!floatingFrame) throw new Error("Floating panel frame did not load");
  await floatingFrame.waitForSelector("#launcher", { state: "visible" });
  const floatingInitial = await floatingFrame.evaluate(() => ({
    version: document.querySelector("#version")?.textContent,
    collapsed: document.body.classList.contains("is-collapsed"),
    status: document.querySelector("#compact-status")?.textContent
  }));
  const floatingCompact = await page.evaluate(() => {
    const iframe = document.getElementById("bili-ad-skipper-floating")?.shadowRoot?.querySelector("iframe");
    const rect = iframe?.getBoundingClientRect();
    return { width: rect?.width, height: rect?.height, left: rect?.left, top: rect?.top };
  });
  await floatingFrame.click("#launcher");
  await floatingFrame.waitForSelector("#panel", { state: "visible" });
  await floatingFrame.click('button[data-tab="settings"]');
  await page.waitForTimeout(250);
  const floatingExpanded = await page.evaluate(() => {
    const host = document.getElementById("bili-ad-skipper-floating");
    const iframe = host?.shadowRoot?.querySelector("iframe");
    return { width: iframe?.getBoundingClientRect().width, height: iframe?.getBoundingClientRect().height };
  });
  await page.waitForFunction(() => {
    const notice = document.querySelector("#bili-ad-skipper-root")?.shadowRoot?.querySelector(".companion");
    return notice && !notice.classList.contains("hidden");
  }, undefined, { timeout: 6_000 });
  const companionNotice = await page.evaluate(() => {
    const root = document.querySelector("#bili-ad-skipper-root")?.shadowRoot;
    return {
      text: root?.querySelector(".companion")?.textContent,
      href: root?.querySelector(".companion-actions a")?.getAttribute("href")
    };
  });

  await page.waitForFunction(() => document.querySelector("#bili-ad-skipper-root")?.shadowRoot?.querySelector(".status")?.classList.contains("hidden"));
  await page.evaluate(() => { const v = document.querySelector("video"); v.currentTime = 0.9; return v.play().catch(() => undefined); });
  await page.waitForFunction(() => document.querySelector("video")?.currentTime >= 5.9, undefined, { timeout: 10_000 });
  const autoSkip = await page.evaluate(() => ({
    time: document.querySelector("video")?.currentTime,
    paused: document.querySelector("video")?.paused,
    toast: document.querySelector("#bili-ad-skipper-root")?.shadowRoot?.querySelector(".toast")?.textContent
  }));
  await page.evaluate(() => document.querySelector("#bili-ad-skipper-root")?.shadowRoot?.querySelector('[data-action="undo"]')?.click());
  await page.waitForFunction(() => (document.querySelector("video")?.currentTime ?? 99) < 1.5);
  const undoTime = await page.evaluate(() => document.querySelector("video")?.currentTime);

  await page.evaluate(() => history.pushState({}, "", "/video/BV1Test0001/?p=2"));
  await page.waitForTimeout(1_600);
  await page.evaluate(() => { const v = document.querySelector("video"); v.currentTime = 9.5; return v.play().catch(() => undefined); });
  await page.waitForFunction(() => (document.querySelector("video")?.currentTime ?? 0) >= 15.5, undefined, { timeout: 10_000 });
  const pageSwitchSkip = await page.evaluate(() => ({
    time: document.querySelector("video")?.currentTime,
    toast: document.querySelector("#bili-ad-skipper-root")?.shadowRoot?.querySelector(".toast")?.textContent
  }));
  await worker.evaluate(async () => {
    const result = await chrome.storage.local.get("settings");
    await chrome.storage.local.set({ settings: { ...result.settings, keywords: [], detectContextAds: true } });
  });
  await page.goto("https://www.bilibili.com/video/BV1Test0001/?p=3", { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#bili-ad-skipper-root");
  await page.waitForTimeout(2_500);
  const genericLoadState = await page.evaluate(() => ({
    url: location.href,
    status: document.querySelector("#bili-ad-skipper-root")?.shadowRoot?.querySelector(".status")?.textContent
  }));
  console.log("GENERIC_LOAD_STATE", JSON.stringify(genericLoadState));
  await page.evaluate(() => { const v = document.querySelector("video"); v.currentTime = 1.2; return v.play().catch(() => undefined); });
  await page.waitForFunction(() => {
    const toast = document.querySelector("#bili-ad-skipper-root")?.shadowRoot?.querySelector(".toast");
    return toast && !toast.classList.contains("hidden") && toast.textContent?.includes("已跳过");
  }, undefined, { timeout: 10_000 });
  const genericSkip = await page.evaluate(() => ({
    time: document.querySelector("video")?.currentTime,
    toast: document.querySelector("#bili-ad-skipper-root")?.shadowRoot?.querySelector(".toast")?.textContent
  }));

  await worker.evaluate(async () => {
    const result = await chrome.storage.local.get("settings");
    await chrome.storage.local.set({ settings: {
      ...result.settings,
      keywords: [],
      detectContextAds: false,
      aiEnabled: true,
      aiEndpoint: "https://api.bilibili.com/ai/v1",
      aiModel: "mock-model",
      aiApiKey: "test-key",
      aiMinConfidence: 0.5
    } });
  });
  await page.goto("https://www.bilibili.com/video/BV1Test0001/?p=3", { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#bili-ad-skipper-root");
  await page.waitForFunction(() => {
    const status = document.querySelector("#bili-ad-skipper-root")?.shadowRoot?.querySelector(".status");
    return status?.textContent?.includes("AI 完成");
  }, undefined, { timeout: 15_000 });
  await page.evaluate(() => { const v = document.querySelector("video"); v.currentTime = 1.2; return v.play().catch(() => undefined); });
  await page.waitForFunction(() => {
    const toast = document.querySelector("#bili-ad-skipper-root")?.shadowRoot?.querySelector(".toast");
    return toast && !toast.classList.contains("hidden") && toast.textContent?.includes("已跳过");
  }, undefined, { timeout: 10_000 });
  const aiSkip = await page.evaluate(() => ({
    time: document.querySelector("video")?.currentTime,
    toast: document.querySelector("#bili-ad-skipper-root")?.shadowRoot?.querySelector(".toast")?.textContent
  }));

  await worker.evaluate(async () => {
    const result = await chrome.storage.local.get("settings");
    await chrome.storage.local.set({ settings: {
      ...result.settings,
      keywords: [],
      detectContextAds: false,
      aiEnabled: false,
      danmakuJumpEnabled: true
    } });
  });
  await page.goto("https://www.bilibili.com/video/BV1Test0001/?p=4", { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#bili-ad-skipper-root");
  await page.waitForTimeout(2_200);
  const p4Frame = page.frames().find((frame) => frame.url().includes("/floating.html"));
  if (!p4Frame) throw new Error("Floating panel missing on danmaku page");
  await p4Frame.waitForSelector("#launcher", { state: "visible" });
  await p4Frame.click("#launcher");
  await p4Frame.waitForSelector("#jump-candidates-card", { state: "visible" });
  const danmakuPanelCandidates = await p4Frame.evaluate(() => document.querySelector("#jump-candidates")?.textContent);
  await page.evaluate(() => { const v = document.querySelector("video"); v.currentTime = 0.5; return v.play().catch(() => undefined); });
  await page.waitForFunction(() => (document.querySelector("video")?.currentTime ?? 0) >= 13.5, undefined, { timeout: 10_000 });
  const danmakuPriorityJump = await page.evaluate(() => ({
    time: document.querySelector("video")?.currentTime,
    paused: document.querySelector("video")?.paused,
    toast: document.querySelector("#bili-ad-skipper-root")?.shadowRoot?.querySelector(".toast")?.textContent
  }));

  await page.goto("https://www.bilibili.com/", { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#bili-ad-skipper-floating");
  await page.waitForTimeout(700);
  const homeFloatingFrame = page.frames().find((frame) => frame.url().includes("/floating.html"));
  if (!homeFloatingFrame) throw new Error("Floating panel did not load on the Bilibili home page");
  const homepagePanel = await homeFloatingFrame.evaluate(() => ({
    status: document.querySelector("#compact-status")?.textContent,
    panelExists: Boolean(document.querySelector("#panel")),
    collapsed: document.body.classList.contains("is-collapsed")
  }));

  console.log(JSON.stringify({ aiPreset, rulesUi, storedRules, aiRequestFormat, floatingInitial, floatingCompact, floatingExpanded, homepagePanel, playerRequests, aiRequests, autoSkip, undoTime, pageSwitchSkip, companionNotice, genericLoadState, genericSkip, aiSkip, danmakuPanelCandidates, danmakuPriorityJump }, null, 2));
} finally {
  await context.close();
  await rm(profileDir, { recursive: true, force: true }).catch((error) => {
    console.warn(`清理临时目录失败（不影响测试结果）：${error instanceof Error ? error.message : error}`);
  });
}
