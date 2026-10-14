---
name: google-flow
description: Manage Google Flow projects, generate images and videos with a chosen type, model, aspect ratio, count and references, and download the results. Use when the user asks to do anything in Google Flow.
---

# Google Flow

The project lives in `C:\dev\_tools\google-flow-api`. Every path below is relative to it. Run all
api-anything commands through `aa.cmd`, never as plain `api-anything`. `aa.cmd` keeps the session,
operations and browser profile inside the project. The MCP server `google-flow` uses the same home.
In Git Bash, set `MSYS_NO_PATHCONV=1` before calling `aa.cmd`, or Bash rewrites `/_/...` paths.

## How the work is split

Flow attaches a fresh reCAPTCHA token to every generation and every upload. Only a real page can
make one, so those run in the browser script. Everything without a token is a fast api-anything
operation (plain HTTP, no browser).

| Task | Tool | Time |
|---|---|---|
| List projects | `aa.cmd call flow.google.com listProjects` | ~3 s |
| List a project's media | `aa.cmd call flow.google.com listMedia projectId=<id>` | ~3 s |
| Create a project | `flow-ui.mjs new-project` | ~12 s |
| Upload files | `flow-ui.mjs upload` | ~15 s |
| Generate (with settings and references) | `flow-ui.mjs generate` | ~45 s for images, minutes for video |
| Download existing media | `flow-ui.mjs fetch` | ~3 s |

Run the browser script as `"C:\Program Files\nodejs\node.exe" scripts\flow-ui.mjs <command>`. It
prints one line of JSON. Only one browser command can run at a time, because they share the profile.

## Session

- **Check first.** Before the first Flow call in a conversation, run `listProjects`. If it returns
  `class: "auth"`, the session expired.
- **Log in when the user asks, or after `auth`.** Ask before opening the window. Then run
  `scripts\login.cmd` with `run_in_background`, from Bash as
  `cmd.exe //c 'C:\dev\_tools\google-flow-api\scripts\login.cmd' < <(sleep 3600)`. The login also
  ends when Enter is pressed, and an empty stdin counts as Enter, so stdin must stay open. A
  "waiting for interactive input" notice is expected: leave it running. Tell the user a Chrome
  window is open, and wait for the exit notification. The user signs in in plain Chrome (Google
  refuses sign-in in an automated browser), opens Flow once and closes the window. The script then
  saves the session on its own. Never ask for a password.
- **Log out only when asked.** `scripts\logout.cmd` signs out of Flow. `scripts\logout.cmd --all`
  deletes the whole browser profile.

## Fast operations

`aa.cmd ops flow.google.com` lists them with their params. Check `ok` before using `data`. A list of
two or more records may come back as `{columns, rows}`.

| Operation | Returns |
|---|---|
| `listProjects()` | projectId, name, updatedUnix, thumbnail |
| `listMedia(projectId)` | mediaId, batchId, createdUnix, prompt (none for uploads), width, height, url |

## Browser commands

| Command | Does |
|---|---|
| `new-project` | Creates a project and prints `projectId`. Flow names it after the date |
| `upload <projectId> <file> [file...]` | Uploads files into the project's media |
| `generate <projectId> "<prompt>" [outDir] [options]` | Applies settings, attaches references, generates, waits, downloads every result to `outDir` (default `downloads\`) |
| `fetch <url> [url...] [target]` | Downloads with the signed-in session. `target` is a file (one URL) or a folder (default `downloads\`) |
| `look [url]` | Screenshots a page and lists its controls |
| `probe <projectId> "<button> >> <button>"` | Clicks buttons in order and lists controls and file pickers. Use it to explore new UI |

### generate options

| Option | Values |
|---|---|
| `--type` | `image` or `video` |
| `--mode` | `frames` or `elements` (video only) |
| `--aspect` | image: `16:9`, `4:3`, `1:1`, `3:4`, `9:16`. video: `16:9`, `9:16` |
| `--model` | image: Nano Banana Pro, Nano Banana 2 Lite, Nano Banana 2.1. video: Omni 1.1 Flash, Veo 3.1 - Lite, Veo 3.1 - Fast, Veo 3.1 - Quality. A unique part of the name works, such as `pro` or `fast` |
| `--count` | `1` to `4` |
| `--max-credits N` | Stops before generating if the panel's cost is over N |
| `--ref <file or name>` | Repeatable. A local file is uploaded and attached. Any other value attaches existing project media whose visible name contains it |
| `--dry` | Applies everything and types the prompt, then stops. No credits are spent. A local `--ref` file is still uploaded |

Options you leave out keep the project's current values. Flow remembers settings per project, so a
setting from one call carries into the next. The output reports what the panel actually had
selected (`settings`) and the cost in credits (`credits`).

Resolution and length can't be chosen. Each model has a fixed output, for example Veo 3.1 Lite
makes 720p, 8 s clips, and images at 16:9 are 1376x768. The menus list models for the account at
the time: an unknown `--model` fails with the current list.

## Generating

1. Find the project. When the user names one, match it in `listProjects`. When they want a new one,
   run `new-project`.
2. Collect the prompt, settings and references. Say which settings you assumed.
3. Run `generate ... --dry` with the same options. It reports the cost.
4. **If the cost is above 0, confirm with the user.** Show the prompt, the settings and the credit
   cost, and send nothing until the user says yes. One approval covers one generation. Images on
   the Nano Banana models cost 0 credits at the time of writing, so they don't need confirmation
   when the user already asked for them.
5. Run the real `generate` with `--max-credits` set to the cost you confirmed.
6. Report the files and the settings used.

If `generate` fails after starting, never retry it right away. Run `listMedia` first, because the
generation may have gone through, and a retry spends credits twice.

## Downloading

- `generate` saves the original files Flow returns (full quality). Prefer it.
- For existing media, take `url` from `listMedia` and run `fetch "<url>=s0" <target>`. `=s0` asks for
  full resolution. Without it the URL gives a 512 px preview. These copies are recompressed.
- `scripts\download.cmd <url> [target]` downloads public URLs without a browser. It refuses URLs that
  need the session and points to `fetch`.

When the user says where to save, pass that path. Otherwise use `downloads\`. Report the final path.

## Failures

Follow the api-anything failure loop for the fast operations. Follow `next` once if you can do it
yourself. If the call fails again, or `next` needs the user, stop and report `class` and `reason`.

| class | Action |
|---|---|
| `auth` | Ask whether to open the login window |
| `rate` | Stop. Tell the user Flow is throttling |
| `drift` | Run `aa.cmd heal flow.google.com <op>` once, then stop |
| `input` | Fix the args per `aa.cmd ops flow.google.com` |

For a browser command that fails on a missing button, Flow's UI changed. Run `probe` to see the
current controls, then report what changed instead of guessing new selectors.

## Limits

- Keep traffic light. Don't loop over many projects or media without asking.
- Only use the signed-in account for what the user asked.
