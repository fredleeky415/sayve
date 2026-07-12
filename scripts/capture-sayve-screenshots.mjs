#!/usr/bin/env node

import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { createRequire } from "node:module";

const runtimeRequire = createRequire("/Users/fred/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/package.json");
const { chromium } = runtimeRequire("playwright");

const outputDir = join(process.cwd(), "outputs", "pdf", "assets");
await mkdir(outputDir, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
});
const page = await browser.newPage({
  viewport: { width: 430, height: 930 },
  deviceScaleFactor: 2
});

async function screenshot(name) {
  await page.screenshot({ path: join(outputDir, name), fullPage: true });
}

const baseUrl = process.env.SAYVE_SCREENSHOT_URL ?? "http://127.0.0.1:3100";

await page.goto(`${baseUrl}/`, { waitUntil: "domcontentloaded", timeout: 15000 });
await page.waitForTimeout(1200);
await screenshot("sayve-home.png");

await page.mouse.move(120, 480);
await page.mouse.down();
await page.mouse.move(360, 480, { steps: 12 });
await page.mouse.up();
await page.waitForTimeout(600);
await page.getByLabel("跟 Sayve 對話").fill("上個月食飯用咗幾多錢？");
await screenshot("sayve-ask.png");

await page.goto(`${baseUrl}/`, { waitUntil: "domcontentloaded", timeout: 15000 });
await page.waitForTimeout(800);
await page.mouse.move(360, 480);
await page.mouse.down();
await page.mouse.move(120, 480, { steps: 12 });
await page.mouse.up();
await page.waitForTimeout(1200);
await screenshot("sayve-dashboard.png");

await page.setViewportSize({ width: 1280, height: 900 });
await page.goto(`${baseUrl}/admin`, { waitUntil: "domcontentloaded", timeout: 15000 });
await page.waitForTimeout(1200);
await screenshot("sayve-founder-console.png");

await browser.close();
console.log(outputDir);
