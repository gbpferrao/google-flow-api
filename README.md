# google-flow-api

Google Flow (flow.google.com) as a local API. It lets an AI agent manage Flow projects,
generate videos with specific settings, use reference files, and download the results.

It is built on [api-anything](https://github.com/goodnight000/api-anything), which learns the requests Flow's own web app
makes and replays them directly. A Playwright script covers what requests alone can't do, such as
file uploads.

## Status

| Part | State |
|---|---|
| Bounded api-anything home, MCP server | done |
| Login and logout scripts | done |
| Download script | done |
| Signed-in session | done |
| UI script: create project, generate with current settings, download | done (`scripts\flow-ui.mjs`) |
| UI script: choose model, resolution, aspect, count | not built yet |
| Reference uploads | not built yet |
| Fast api-anything operations (list projects found: `UpteDb`) | not learned yet |

## Requirements

- Node.js 22.13 or newer (installed: 24.20)
- api-anything installed globally, built from [its repo](https://github.com/goodnight000/api-anything) (see its INSTALL.md)
- Google Chrome
- A Google account with access to Flow

## Layout

| Path | Contents |
|---|---|
| `aa.cmd` | Runs api-anything with its home set to `.api-anything\` |
| `.api-anything\` | Learned operations, saved session, captures, and the Chrome profile |
| `scripts\login.cmd` | Opens a Chrome window to sign in by hand |
| `scripts\logout.cmd` | Clears the Flow session. `--all` deletes the whole browser profile |
| `scripts\flow-ui.mjs` | Drives Flow's web UI headless with the project profile. Logs Flow's API traffic to `.api-anything\ui-traffic\` and screenshots to `.api-anything\ui-shots\` |
| `scripts\download.cmd`, `scripts\download.mjs` | Downloads a URL to any path, `downloads\` by default |
| `references\` | Default folder for files to upload as references |
| `downloads\` | Default folder for downloaded videos |
| `google-flow-skill.md` | Instructions for the agent that uses this API |

## Boundaries

Everything this project creates stays in this folder, with two exceptions that hold no data:

- The `google-flow` MCP server entry in `~/.claude.json` (user scope), which points at `.api-anything\`.
- The api-anything command (npm global folder) and its general skill in `~/.claude/skills/api-anything\`.

The session in `.api-anything\` is a signed-in Google session. Anything that can read this folder can
act as that account. It never reads or changes your everyday Chrome profile.

## Risks

- Flow has no public API. When Google changes the web app, operations can break until they are
  learned again.
- Automated use may break Google's terms. Keep the volume to what a person would do by hand.
- Generating videos spends Flow credits.
