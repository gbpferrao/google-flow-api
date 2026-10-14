// Drives Flow's web UI with the project's signed-in Chrome profile, for what api-anything can't do
// (clicks, uploads). Logs every Flow API request to .api-anything\ui-traffic\ so it can be learned later.
// Usage: node flow-ui.mjs <command> [args]   (see COMMANDS below). Prints one line of JSON per result.
import { appendFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
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
    [...document.querySelectorAll("button, a[href], input, textarea, [role=button], [role=tab], [role=option], [role=radio], [role=menuitem], [role=menuitemradio], [contenteditable=true]")]
      .filter((e) => e.offsetParent !== null)
      .map((e) => ({
        tag: e.getAttribute("role") || e.tagName.toLowerCase(),
        selected: e.getAttribute("aria-selected") ?? e.getAttribute("aria-checked") ?? e.getAttribute("aria-pressed") ?? undefined,
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

const fileInputs = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll('input[type="file"]')].map((e) => ({
      accept: e.accept,
      multiple: e.multiple,
      label: e.getAttribute("aria-label"),
      parent: e.parentElement?.getAttribute("aria-label") || e.parentElement?.className?.toString().slice(0, 60),
    })),
  );

async function openProject(page, projectId) {
  await page.goto(`https://flow.google.com/project/${projectId}`, { waitUntil: "networkidle", timeout: 60000 });
  await page.getByText(/^Carregando|^Loading/).first().waitFor({ state: "hidden", timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(2000);
}

/** A visible clickable control (button, menu item, tab, option, radio) whose accessible name matches. */
const CLICKABLE = ["button", "menuitem", "menuitemradio", "tab", "option", "radio"];
const btn = (page, re) =>
  CLICKABLE.map((role) => page.getByRole(role, { name: re }))
    .reduce((a, b) => a.or(b))
    .filter({ visible: true })
    .first();

/** Click whatever opens the OS file picker and hand it the files instead. */
async function injectFiles(page, clickTarget, files) {
  const [chooser] = await Promise.all([page.waitForEvent("filechooser", { timeout: 15000 }), clickTarget.click()]);
  await chooser.setFiles(files);
}

/** Wait until `count` media not in `before` show up (uploads or generations). */
async function waitForNewMedia(page, before, count, ms) {
  const until = Date.now() + ms;
  let fresh = [];
  while (Date.now() < until) {
    await page.waitForTimeout(2000);
    fresh = [...new Set((await mediaSrcs(page)).filter((s) => !before.has(s)))];
    if (fresh.length >= count) break;
  }
  return fresh;
}

const checkFiles = (files) => {
  const full = files.map((f) => resolve(f));
  const missing = full.filter((f) => !existsSync(f));
  if (missing.length) throw new Error(`file not found: ${missing.join(", ")}`);
  return full;
};

const SETTING_FLAGS = ["type", "mode", "aspect", "model", "count", "max-credits"];

/** Split argv into positionals, repeated --ref values, --dry, and the settings flags. */
function parseArgs(args) {
  const pos = [];
  const refs = [];
  const opts = {};
  let dry = false;
  for (let i = 0; i < args.length; i++) {
    const flag = args[i].startsWith("--") ? args[i].slice(2) : null;
    if (flag === "ref") refs.push(args[++i]);
    else if (flag === "dry") dry = true;
    else if (SETTING_FLAGS.includes(flag)) opts[flag] = args[++i];
    else if (flag) throw new Error(`unknown flag --${flag}; flags: --ref --dry ${SETTING_FLAGS.map((f) => `--${f}`).join(" ")}`);
    else pos.push(args[i]);
  }
  return { pos, refs, dry, opts };
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const radio = (page, re) => page.getByRole("radio", { name: re }).filter({ visible: true }).first();
const TYPE = { image: /(Imagem|Image)$/i, video: /(Vídeo|Video)$/i };
const MODE = { frames: /Frames$/i, elements: /(Elementos|Elements|Ingredients)$/i };

/** Open the settings panel, apply the given options, read back the summary and credit cost, close it. */
async function applySettings(page, opts) {
  const trigger = btn(page, /Gatilho de configura|settings trigger/i);
  await trigger.click();
  await page.waitForTimeout(800);
  const pick = async (what, value, re) => {
    const r = radio(page, re);
    if (!(await r.count())) throw new Error(`--${what} ${value}: not offered for this type. Run "probe <projectId> \\"Gatilho de configura\\"" to see the options`);
    await r.click();
    await page.waitForTimeout(500);
  };
  if (opts.type) {
    const re = TYPE[opts.type.toLowerCase()];
    if (!re) throw new Error(`--type must be image or video`);
    await pick("type", opts.type, re);
  }
  if (opts.mode) {
    const re = MODE[opts.mode.toLowerCase()];
    if (!re) throw new Error(`--mode must be frames or elements (video only)`);
    await pick("mode", opts.mode, re);
  }
  if (opts.aspect) await pick("aspect", opts.aspect, new RegExp(`${escapeRe(opts.aspect)}$`));
  if (opts.model) {
    await btn(page, /Selecionar fam|model family/i).click();
    await page.waitForTimeout(600);
    const items = page.getByRole("menuitem").filter({ visible: true });
    const names = (await items.allInnerTexts()).map((t) => t.replace(/^volume_up\s*/, "").replace(/^[^\p{L}\p{N}]+/u, "").trim());
    const want = opts.model.toLowerCase();
    const i = names.findIndex((n) => n.toLowerCase() === want) >= 0 ? names.findIndex((n) => n.toLowerCase() === want) : names.findIndex((n) => n.toLowerCase().includes(want));
    if (i < 0) throw new Error(`--model "${opts.model}" not found; available: ${names.join(", ")}`);
    await items.nth(i).click();
    await page.waitForTimeout(600);
  }
  if (opts.count) await pick("count", opts.count, new RegExp(`^x${escapeRe(String(opts.count).replace(/^x/i, ""))}$`, "i"));
  const costText = (await page.getByText(/créditos|credits/i).filter({ visible: true }).first().innerText().catch(() => "")) || "";
  const credits = Number(/(\d+)/.exec(costText)?.[1] ?? NaN);
  // Read back what the panel actually has selected, so the caller can report it.
  const checked = await page
    .getByRole("radio", { checked: true })
    .filter({ visible: true })
    .allInnerTexts()
    .then((ts) => ts.map((t) => t.split("\n").pop().trim()));
  const model = (await btn(page, /Selecionar fam|model family/i).innerText()).replace(/arrow_drop_down/, "").replace(/^[^\p{L}\p{N}]+/u, "").trim();
  const summary = (await trigger.innerText()).replace(/\s+/g, " ").replace(/crop_\S+/g, "").trim();
  await page.keyboard.press("Escape");
  await page.waitForTimeout(500);
  const [type, ...rest] = checked;
  const settings = {
    type,
    mode: rest.find((t) => /Frames|Elementos|Elements|Ingredients/i.test(t)) ?? null,
    aspect: rest.find((t) => /^\d+:\d+$/.test(t)) ?? null,
    model,
    count: rest.find((t) => /^x\d$/i.test(t)) ?? null,
    output: /\d+p · \d+s/.exec(summary)?.[0] ?? null,
  };
  return { settings, credits: Number.isNaN(credits) ? null : credits };
}

/** Attach references to the prompt box: local files are uploaded, other values pick existing project media by name. */
async function attachRefs(page, refs) {
  if (!refs.length) return [];
  const local = refs.filter((r) => existsSync(resolve(r)));
  const named = refs.filter((r) => !existsSync(resolve(r)));
  const attached = [];
  const openPicker = () => btn(page, /Adicionar elementos|Add elements/i).click();
  if (local.length) {
    await openPicker();
    await page.waitForTimeout(1000);
    const before = new Set(await mediaSrcs(page));
    await injectFiles(page, btn(page, /Enviar mídia|Upload media/i), checkFiles(local));
    await waitForNewMedia(page, before, local.length, 90000);
    attached.push(...local);
    await page.waitForTimeout(1500);
  }
  if (named.length) {
    if (!(await btn(page, /Incluir no comando|Add to prompt/i).isVisible())) await openPicker();
    await page.waitForTimeout(1000);
    for (const name of named) {
      // Picker items' accessible names differ from their visible text, so match the text.
      await page.locator("button").filter({ hasText: name }).filter({ visible: true }).first().click();
      attached.push(name);
    }
  }
  const include = btn(page, /Incluir no comando|Add to prompt/i);
  if (await include.count()) await include.click();
  await page.waitForTimeout(1000);
  return attached;
}

const COMMANDS = {
  /** Download URLs with the signed-in profile's cookies, without opening a page. target: a file
   *  (one URL only) or a folder (default <project>\downloads). Names come from --name or the URL. */
  async fetch(...args) {
    const urls = args.filter((a) => /^https?:\/\//.test(a));
    const target = args.find((a) => !/^https?:\/\//.test(a));
    if (!urls.length) throw new Error("usage: fetch <url> [url...] [target]");
    const toFile = target && urls.length === 1 && /\.\w{2,4}$/.test(target);
    const dir = toFile ? dirname(resolve(target)) : resolve(target ?? join(projectDir, "downloads"));
    mkdirSync(dir, { recursive: true });
    const { ctx } = await open();
    try {
      const files = [];
      for (const [i, url] of urls.entries()) {
        const res = await ctx.request.get(url);
        const type = res.headers()["content-type"]?.split(";")[0] ?? "";
        if (!res.ok() || type === "text/html") throw new Error(`HTTP ${res.status()} ${type} for ${url}`);
        const file = toFile ? resolve(target) : join(dir, `${slug(new URL(url).pathname.split("/").pop() || "flow")}-${i + 1}${EXT[type] ?? ".bin"}`);
        writeFileSync(file, await res.body());
        files.push(file);
      }
      out({ ok: true, files });
    } finally {
      await ctx.close();
    }
  },

  /** Upload files into a project's media. */
  async upload(projectId, ...files) {
    if (!projectId || !files.length) throw new Error("usage: upload <projectId> <file> [file...]");
    const paths = checkFiles(files);
    const { ctx, page, log } = await open();
    try {
      await openProject(page, projectId);
      const before = new Set(await mediaSrcs(page));
      await btn(page, /Menu para adicionar arquivos|Add files menu/i).click();
      await page.waitForTimeout(800);
      await injectFiles(page, btn(page, /^\s*(upload\s*)?(Enviar|Upload)\s*$/i), paths);
      const fresh = await waitForNewMedia(page, before, paths.length, 120000);
      out({ ok: fresh.length >= paths.length, projectId, uploaded: paths, newMedia: fresh.length, shot: await shot(page, "upload"), traffic: log });
    } finally {
      await ctx.close();
    }
  },

  /** In a project, click the button whose aria-label matches, then report file inputs and controls. */
  async probe(projectId, ariaRegex) {
    const { ctx, page } = await open();
    try {
      await openProject(page, projectId);
      const beforeInputs = await fileInputs(page);
      // ariaRegex may chain several clicks: "first button >> second button"
      for (const step of (ariaRegex ?? "").split(">>").map((s) => s.trim()).filter(Boolean)) {
        page.once("filechooser", () => out({ note: `file chooser opened after "${step}"` }));
        await btn(page, new RegExp(step, "i")).click();
        await page.waitForTimeout(1500);
      }
      out({ ok: true, beforeInputs, afterInputs: await fileInputs(page), shot: await shot(page, "probe"), controls: await controls(page) });
    } finally {
      await ctx.close();
    }
  },

  /** Type a prompt in a project, start generation, wait for the new media, download it.
   *  Uses the project's current model settings. outDir defaults to <project>\downloads.
   *  --ref <file|media name> (repeatable) attaches a reference: a local file is uploaded, any other
   *  value picks existing project media by name. --dry stops before generating (no credits spent). */
  async generate(...args) {
    const { pos, refs, dry, opts } = parseArgs(args);
    const [projectId, prompt, outDir = join(projectDir, "downloads")] = pos;
    if (!projectId || !prompt)
      throw new Error('usage: generate <projectId> "<prompt>" [outDir] [--type image|video] [--mode frames|elements] [--aspect 16:9] [--model <name>] [--count 1-4] [--max-credits N] [--ref <file|name>]... [--dry]');
    const { ctx, page, log } = await open();
    try {
      await openProject(page, projectId);
      const { settings, credits } = await applySettings(page, opts);
      if (opts["max-credits"] != null && credits != null && credits > Number(opts["max-credits"]))
        return out({ ok: false, error: `would use ${credits} credits, over --max-credits ${opts["max-credits"]}`, settings, credits });
      const attached = await attachRefs(page, refs);
      const before = new Set(await mediaSrcs(page));
      const box = page.getByRole("textbox", { name: /O que você quer criar|What do you want to create/i }).or(page.locator('[contenteditable="true"]')).first();
      await box.click();
      await page.keyboard.type(prompt, { delay: 15 });
      if (dry) return out({ ok: true, dry: true, projectId, prompt, settings, credits, attached, shot: await shot(page, "generate-dry") });
      await btn(page, /Iniciar geração|Start generation|Generate/i).click();
      const started = Date.now();
      let fresh = [];
      // Videos take minutes, images seconds.
      const limit = /V[íi]deo|Video/i.test(settings.type ?? "") ? 900000 : 240000;
      while (Date.now() - started < limit) {
        await page.waitForTimeout(5000);
        fresh = (await mediaSrcs(page)).filter((s) => !before.has(s));
        if (fresh.length) {
          await page.waitForTimeout(5000);
          fresh = [...new Set((await mediaSrcs(page)).filter((s) => !before.has(s)))];
          break;
        }
      }
      const shotPath = await shot(page, "generate");
      if (!fresh.length) return out({ ok: false, error: `no new media appeared within ${limit / 60000} minutes`, settings, shot: shotPath, traffic: log });
      mkdirSync(outDir, { recursive: true });
      const files = [];
      for (const [i, src] of fresh.entries()) {
        const res = await ctx.request.get(src);
        const ext = EXT[res.headers()["content-type"]?.split(";")[0]] ?? ".bin";
        const file = join(outDir, `${slug(prompt)}-${i + 1}${ext}`);
        writeFileSync(file, await res.body());
        files.push(file);
      }
      out({ ok: true, projectId, prompt, settings, credits, attached, seconds: Math.round((Date.now() - started) / 1000), files, shot: shotPath, traffic: log });
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
