---
name: google-flow
description: Manage Google Flow projects, generate videos with a chosen model, resolution and references, and download the results. Use when the user asks to do anything in Google Flow.
---

# Google Flow

The project lives in `C:\dev\_tools\google-flow-api`. Every path below is relative to it. Run all
api-anything commands through `aa.cmd`, never as plain `api-anything`. `aa.cmd` keeps the session,
operations and browser profile inside the project. The MCP server `google-flow` uses the same home.

## Session

- **Check first.** Before the first Flow call in a conversation, run `aa.cmd ops flow.google.com`. If
  a call later returns `class: "auth"`, the session expired.
- **Log in when the user asks, or after `auth`.** Ask before opening the window. Then run
  `scripts\login.cmd` with `run_in_background`, from Bash as
  `cmd.exe //c 'C:\dev\_tools\google-flow-api\scripts\login.cmd' < <(sleep 3600)`. The login also
  ends when Enter is pressed, and an empty stdin counts as Enter, so stdin must stay open. A
  "waiting for interactive input" notice is expected: leave it running. Tell the user a Chrome window is open, and wait for
  the exit notification. The user signs in, opens Flow once and closes the window. Never ask for a
  password, and never try to complete the sign-in yourself.
- **Log out only when asked.** `scripts\logout.cmd` signs out of Flow. `scripts\logout.cmd --all`
  deletes the whole browser profile.

## Operations

Read the current list with `aa.cmd ops flow.google.com`. It shows each operation's params and notes,
and those are the source of truth. Planned operations:

| Operation | Returns | Kind |
|---|---|---|
| `listProjects()` | projectId, name, updated | read |
| `createProject(name)` | projectId | write |
| `listClips(projectId)` | clipId, prompt, model, resolution, status, videoUrl | read |
| `getClip(clipId)` | status, videoUrl | read |
| `generateVideo(projectId, prompt, model, resolution, aspect, referenceIds)` | jobId | write, spends credits |
| `uploadReference(projectId, file)` | referenceId | write, via Playwright script (not built yet) |

Call a read with `aa.cmd call flow.google.com <op> name=value ...`. Check `ok` before using `data`.

## UI script (works now)

Until the fast operations are learned, use `scripts\flow-ui.mjs`. Run it with
`"C:\Program Files\nodejs\node.exe" scripts\flow-ui.mjs <command>`. It prints one line of JSON.

| Command | Does |
|---|---|
| `look [url]` | Screenshot a page and list its controls. Use it to find selectors |
| `new-project` | Creates a project and prints `projectId` |
| `generate <projectId> "<prompt>" [outDir]` | Generates with the project's current settings, waits, and downloads every new result to `outDir` (default `downloads\`) |

`generate` reports `settings` (for example "Nano Banana 2.1 16:9 x2"). Model, aspect and count
can't be chosen yet, so tell the user which settings were used. Only one command can run at a
time, because they share the browser profile.

## Generating a video

1. Resolve names to ids. The user names a project, so find its `projectId` with `listProjects`.
2. Collect the settings: prompt, model, resolution, aspect ratio and references. Fill gaps with the
   project's last used settings, and say which ones you assumed.
3. **Confirm with the user.** Show the exact prompt and every setting, and say that it spends
   credits. Send nothing until the user says yes. One approval covers one generation, not a batch.
4. Run `aa.cmd call flow.google.com generateVideo ... --dry` first. It prints the exact request. Check
   the ids and the prompt in it.
5. Send it with `--allow-writes`.
6. Poll `getClip` until the status is done, at most once every 10 seconds. If it fails or takes
   more than 10 minutes, report the status and stop.

## References

Files to upload default to `references\`, but any path works. Upload each file once and reuse its
`referenceId` in later generations in the same project.

## Downloading

`scripts\download.cmd <url> [target]` saves a file and prints `{"ok":true,"path":...}`.

- No target: saves to `downloads\` under the name from the URL.
- A folder (ends in `\`, or already exists): saves into it under the name from the URL.
- A file path: saves exactly there.

Get the URL from `getClip` or `listClips`. When the user says where to save, pass that path. When
they don't, use the default. Name the file after the clip's prompt when the URL's name is
meaningless, for example `downloads\red-car-sunset.mp4`. Report the final path.

## Failures

Follow the api-anything failure loop. Follow `next` once if you can do it yourself. If the call
fails again, or `next` needs the user, stop and report `class` and `reason`.

| class | Action |
|---|---|
| `auth` | Ask whether to open the login window |
| `rate` | Stop. Tell the user Flow is throttling |
| `drift` | Run `aa.cmd heal flow.google.com <op>` once, then stop |
| `input` | Fix the args per `aa.cmd ops flow.google.com` |

If a generation reports that "the write may have gone through", never retry it. Check
`listClips` instead, because a retry spends credits twice.

## Limits

- Keep traffic light. Don't loop over many projects or clips without asking.
- Only use the signed-in account for what the user asked.
