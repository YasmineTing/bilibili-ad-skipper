import { chromium } from "playwright-core";
import { mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";

const edgePath = process.env.EDGE_PATH || "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const extensionPath = resolve("dist");
const profileDir = resolve(".tmp-e2e-profile");
await rm(profileDir, { recursive: true, force: true });
await mkdir(profileDir, { recursive: true });

const context = await chromium.launchPersistentContext(profileDir, {
  executablePath: edgePath,
  headless: true,
  args: [
    `--disable-extensions-except=${extensionPath}`,
    `--load-extension=${extensionPath}`,
    "--no-first-run",
    "--disable-features=msEdgeFirstRunExperience"
  ]
});

try {
let worker = context.serviceWorkers()[0];
if (!worker) worker = await context.waitForEvent("serviceworker", { timeout: 10_000 });
const extensionId = new URL(worker.url()).host;
const danmakuEndpoint = await worker.evaluate(async () => {
  const response = await fetch("https://comment.bilibili.com/42138929211.xml");
  const text = await response.text();
  return { status: response.status, isXml: /<d\b[^>]*\bp=/.test(text), preview: text.slice(0, 160) };
});
const optionsPage = await context.newPage();
await optionsPage.goto(`chrome-extension://${extensionId}/options.html`);
await optionsPage.waitForTimeout(400);
await optionsPage.locator("#keywords").fill("ACEMAGIC\n优惠码\nacemagic");
await optionsPage.locator("#confirm-before-skip").evaluate((element) => {
  element.checked = false;
});
await optionsPage.locator("button[type='submit']").click();
await optionsPage.waitForFunction(() => document.querySelector("#save-status")?.textContent?.includes("已保存"), undefined, { timeout: 5000 });
const saved = await optionsPage.evaluate(async () => {
  const value = await chrome.storage.local.get("settings");
  return value.settings;
});
if (JSON.stringify(saved.keywords) !== JSON.stringify(["ACEMAGIC", "优惠码"])) {
  throw new Error(`设置保存错误：${JSON.stringify(saved)}`);
}
await optionsPage.close();

const page = await context.newPage();
await page.goto("https://www.bilibili.com/video/BV1ef421i7CD/", { waitUntil: "domcontentloaded", timeout: 60_000 });
await page.waitForSelector("#bili-ad-skipper-root", { timeout: 20_000 });
await page.waitForSelector("#bili-ad-skipper-floating", { timeout: 20_000 });
await page.waitForTimeout(800);
const floatingFrame = page.frames().find((frame) => frame.url().includes("/floating.html"));
const floatingPanel = floatingFrame ? await floatingFrame.evaluate(() => ({
  exists: Boolean(document.querySelector("#panel")),
  version: document.querySelector("#version")?.textContent,
  status: document.querySelector("#compact-status")?.textContent
})) : null;
const observed = await page.waitForFunction(() => {
  const status = document.querySelector("#bili-ad-skipper-root")?.shadowRoot?.querySelector(".status");
  if (!status || status.classList.contains("hidden")) return false;
  return { status: status.textContent, title: document.title, url: location.href };
}, undefined, { timeout: 25_000 }).then((handle) => handle.jsonValue());

console.log(JSON.stringify({ extensionId, danmakuEndpoint, saved, floatingPanel, observed }, null, 2));
} finally {
  await context.close();
  await rm(profileDir, { recursive: true, force: true });
}
