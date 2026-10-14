// Drives Flow's web UI with the project's signed-in Chrome profile, for what api-anything can't do
// (clicks, uploads). Logs every Flow API request to .api-anything\ui-traffic\ so it can be learned later.
// Usage: node flow-ui.mjs <command> [args]   (see COMMANDS below). Prints one line of JSON per result.
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(join(process.env.APPDATA, "npm", "node_modules", "api-anything", "package.json"));
const { chromium } = require("playwright-core");

const projectDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const home = join(projectDir, ".api-anything");
const profile = join(home, "profile");
const trafficDir = join(home, "ui-traffic");
const shotsDir = join(home, "ui-shots");
mkdirSync(trafficDir, { recursive: true });
mkdirSync(shotsDir, { recursive: true });
const CHROME = join(process.env.ProgramFiles, "Google", "Chrome", "Application", "chrome.exe");

const out = (o) => console.log(JSON.stringify(o));

async function open({ headless = true } = {}) {
  const ctx = await chromium.launchPersistentContext(profile, {
    executablePath: CHROME,
    headless,
    viewport: { width: 1440, height: 900 },
    acceptDownloads: true,
    args: ["--disable-blink-features=AutomationControlled"],
  });
  const log = join(trafficDir, `${new Date().toISOString().replace(/[:.]/g, "-")}.jsonl`);
  ctx.on("requestfinished", async (req) => {
    const url = req.url();
    if (!/flow\.google\.com\/_\/|googleapis\.com/.test(url) || /play\.google\.com\/log/.test(url)) return;
    let body = null;
    try {
      body = (await (await req.response())?.text())?.slice(0, 20000) ?? null;
    } catch {}
    appendFileSync(log, `${JSON.stringify({ t: Date.now(), method: req.method(), url, post: req.postData()?.slice(0, 20000), body })}\n`);
  });
  const page = ctx.pages()[0] ?? (await ctx.newPage());
  return { ctx, page, log };
}

const shot = async (page, name) => {
  const p = join(shotsDir, `${name}.png`);
  await page.screenshot({ path: p });
  return p;
};

/** Visible buttons, links and inputs with their text, for working out selectors. */
async function controls(page) {
  return page.evaluate(() =>
    [...document.querySelectorAll("button, a[href], input, textarea, [role=button], [contenteditable=true]")]
      .filter((e) => e.offsetParent !== null)
      .map((e) => ({
        tag: e.tagName.toLowerCase(),
        text: (e.innerText || e.getAttribute("aria-label") || e.getAttribute("placeholder") || "").trim().slice(0, 60),
        aria: e.getAttribute("aria-label"),
        href: e.getAttribute("href"),
      }))
      .filter((c) => c.text || c.aria),
  );
}

const projectIdOf = (url) => /\/project\/([0-9a-f-]{36})/.exec(url)?.[1];

/** Large media shown on the page: generated images and video posters. */
const mediaSrcs = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll("img, video")]
      .filter((e) => (e.naturalWidth || e.videoWidth || e.clientWidth) >= 200)
      .map((e) => e.currentSrc || e.src)
      .filter((s) => s && !s.startsWith("data:") && !/gstatic\.com|\/a\/|avatar|photo\.jpg/.test(s)),
  );

const EXT = { "image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp", "video/mp4": ".mp4" };
const slug = (s) => s.toLowerCase().normalize("NFD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 50) || "flow";

const COMMANDS = {
  /** Type a prompt in a project, start generation, wait for the new media, download it.
   *  Uses the project's current model settings. outDir defaults to <project>\downloads. */
  async generate(projectId, prompt, outDir = join(projectDir, "downloads")) {
    if (!projectId || !prompt) throw new Error('usage: generate <projectId> "<prompt>" [outDir]');
    const { ctx, page, log } = await open();
    try {
      await page.goto(`https://flow.google.com/project/${projectId}`, { waitUntil: "networkidle", timeout: 60000 });
      await page.getByText(/^Carregando|^Loading/).first().waitFor({ state: "hidden", timeout: 30000 }).catch(() => {});
      await page.waitForTimeout(2000);
      const before = new Set(await mediaSrcs(page));
      const settings = (await page.getByRole("button", { name: /Gatilho de configura|settings trigger/i }).first().innerText()).replace(/\s+/g, " ");
      const box = page.getByRole("textbox", { name: /O que você quer criar|What do you want to create/i }).or(page.locator('[contenteditable="true"]')).first();
      await box.click();
      await page.keyboard.type(prompt, { delay: 15 });
      await page.getByRole("button", { name: /Iniciar geração|Start generation|Generate/i }).first().click();
      const started = Date.now();
      let fresh = [];
      while (Date.now() - started < 240000) {
        await page.waitForTimeout(5000);
        fresh = (await mediaSrcs(page)).filter((s) => !before.has(s));
        if (fresh.length) {
          await page.waitForTimeout(5000);
          fresh = [...new Set((await mediaSrcs(page)).filter((s) => !before.has(s)))];
          break;
        }
      }
      const shotPath = await shot(page, "generate");
      if (!fresh.length) return out({ ok: false, error: "no new media appeared within 4 minutes", settings, shot: shotPath, traffic: log });
      mkdirSync(outDir, { recursive: true });
      const files = [];
      for (const [i, src] of fresh.entries()) {
        const res = await ctx.request.get(src);
        const ext = EXT[res.headers()["content-type"]?.split(";")[0]] ?? ".bin";
        const file = join(outDir, `${slug(prompt)}-${i + 1}${ext}`);
        writeFileSync(file, await res.body());
        files.push(file);
      }
      out({ ok: true, projectId, prompt, settings, seconds: Math.round((Date.now() - started) / 1000), files, shot: shotPath, traffic: log });
    } finally {
      await ctx.close();
    }
  },

  /** Create a project; optionally rename it. Prints its id. */
  async "new-project"(name) {
    const { ctx, page, log } = await open();
    try {
      await page.goto("https://flow.google.com/", { waitUntil: "networkidle", timeout: 60000 });
      await page.getByText(/^\s*(add\s*)?(Novo projeto|New project)\s*$/i).first().click({ timeout: 20000 });
      await page.waitForURL(/\/project\/[0-9a-f-]{36}/, { timeout: 30000 });
      await page.waitForTimeout(3000);
      const projectId = projectIdOf(page.url());
      out({ ok: true, projectId, url: page.url(), name: name ?? null, shot: await shot(page, "project"), traffic: log, controls: await controls(page) });
    } finally {
      await ctx.close();
    }
  },

  /** Open a page, screenshot it, list its controls. */
  async look(url = "https://flow.google.com/") {
    const { ctx, page, log } = await open();
    try {
      await page.goto(url, { waitUntil: "networkidle", timeout: 60000 });
      await page.getByText(/^Carregando|^Loading/).first().waitFor({ state: "hidden", timeout: 30000 }).catch(() => {});
      await page.waitForTimeout(3000);
      out({ ok: true, url: page.url(), title: await page.title(), shot: await shot(page, "look"), traffic: log, controls: await controls(page) });
    } finally {
      await ctx.close();
    }
  },
};

const [cmd, ...args] = process.argv.slice(2);
if (!COMMANDS[cmd]) {
  out({ ok: false, error: `unknown command "${cmd}"; commands: ${Object.keys(COMMANDS).join(", ")}` });
  process.exit(1);
}
try {
  await COMMANDS[cmd](...args);
} catch (e) {
  out({ ok: false, error: e.message.split("\n")[0] });
  process.exitCode = 1;
}
