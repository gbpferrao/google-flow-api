// Download a file (a Flow video or image URL) to any path.
// Usage: node download.mjs <url> [target]
//   target omitted         -> <project>\downloads\<name from URL>
//   target is a folder     -> <folder>\<name from URL>   (a trailing \ or / marks a folder that doesn't exist yet)
//   target is a file path  -> exactly that file
// Prints one line of JSON: {"ok":true,"path":...,"bytes":...} or {"ok":false,"error":...}.
import { createWriteStream, existsSync, mkdirSync, statSync } from "node:fs";
import { basename, dirname, extname, join, resolve } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";

const projectDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const defaultDir = join(projectDir, "downloads");

const EXT = { "video/mp4": ".mp4", "video/webm": ".webm", "image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp" };

function nameFromUrl(url, contentType) {
  let name = basename(new URL(url).pathname) || "download";
  name = decodeURIComponent(name).replace(/[<>:"/\\|?*]/g, "_");
  if (!extname(name)) name += EXT[contentType?.split(";")[0]] ?? "";
  return name;
}

function targetPath(target, url, contentType) {
  if (!target) return join(defaultDir, nameFromUrl(url, contentType));
  const full = resolve(target);
  const isDir = /[\\/]$/.test(target) || (existsSync(full) && statSync(full).isDirectory());
  return isDir ? join(full, nameFromUrl(url, contentType)) : full;
}

// Windows passes "C:\dir\" as C:\dir" (the backslash escapes the quote): read it as the folder it meant.
const [url, rawTarget] = process.argv.slice(2);
const target = rawTarget?.endsWith('"') ? `${rawTarget.slice(0, -1)}\\` : rawTarget;
try {
  if (!url) throw new Error("usage: node download.mjs <url> [target]");
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status} for ${url}`);
  // A sign-in page instead of media means the URL needs the Google session: use flow-ui.mjs fetch.
  if (/text\/html/i.test(res.headers.get("content-type") ?? ""))
    throw new Error("got a web page, not a file: this URL needs the signed-in session. Use: node scripts\\flow-ui.mjs fetch <url> [target]");
  const path = targetPath(target, url, res.headers.get("content-type"));
  mkdirSync(dirname(path), { recursive: true });
  await pipeline(Readable.fromWeb(res.body), createWriteStream(path));
  console.log(JSON.stringify({ ok: true, path, bytes: statSync(path).size }));
} catch (e) {
  console.log(JSON.stringify({ ok: false, error: e.message }));
  process.exitCode = 1;
}
