<p align="center"><img src="assets/icon.png" alt="slack-hop icon: a ball hopping into the active workspace" width="128" height="128"></p>

# slack-hop

A CLI for reading and posting in several Slack workspaces as yourself. It is built for AI agents, such as Claude Code (including cloud sessions) or any agent that can run shell commands, where a built-in Slack connector only covers one workspace: keep your main workspace on the connector and use `slack-hop` for the rest.

Each workspace gets its own user token, stored in an environment variable. `--workspace client-b` uses `SLACK_TOKEN_CLIENT_B`.

```
slack-hop workspaces
slack-hop list-channels --workspace client-b
slack-hop read-channel general --workspace client-b --limit 50
slack-hop read-thread https://acme.slack.com/archives/C0123ABCD/p1696000000123456 --workspace client-b
slack-hop search "deploy in:#eng after:2026-09-30" --workspace client-b
slack-hop send-message @jane "Got it, thanks" --workspace client-b
slack-hop find-user jane --workspace client-b
```

Run `slack-hop --help`, or `slack-hop <command> --help`, for every option. Long messages are shortened in `read-channel`, `read-thread` and `search`; add `--full` to see them whole, or `--json` to any command for raw output.

## Setup

### 1. Create a Slack app in each workspace

1. Go to https://api.slack.com/apps → **Create New App** → **From a manifest**, and pick the workspace.
2. Paste [`slack-app-manifest.yaml`](slack-app-manifest.yaml) and create the app.
3. Open **OAuth & Permissions** → **Install to Workspace**, and approve. Some workspaces send this to an admin for approval first.
4. Copy the **User OAuth Token** (starts with `xoxp-`).

Create a separate app in each workspace rather than one app distributed to several. Slack heavily rate-limits message history for distributed apps that aren't in the Slack Marketplace; an app internal to its own workspace avoids that. The manifest also turns token rotation off, so the token doesn't expire every 12 hours.

The token can read and post anything you can, so treat it like a password: keep it in environment settings, never in a repo or chat.

### 2. Add the tokens to the environment

Name each variable `SLACK_TOKEN_<WORKSPACE>`, with the workspace name uppercased and dashes turned into underscores:

| Variable | Used with |
| --- | --- |
| `SLACK_TOKEN_CLIENT_B` | `--workspace client-b` |
| `SLACK_TOKEN_ACME` | `--workspace acme` |

In Claude Code on the web, add them in the environment's settings (environment menu in the session title bar → **Edit**). Make sure the environment's network access allows `slack.com`.

### 3. Install the CLI

Add this to the environment's setup script (or run it locally). It needs Node 22 or newer:

```sh
npm install -g --install-links github:jason-ezenwa/slack-hop
```

Keep `--install-links`: without it, npm 10 links the command to a temporary download folder that it then deletes, leaving a broken `slack-hop`. Pin a version with a tag: `github:jason-ezenwa/slack-hop#v0.1.0`.

### 4. Tell your agent about it

Installing the CLI doesn't make an agent look for it. Tell it in your prompt, or add a line like this to the `AGENTS.md` or `CLAUDE.md` of the repos you work in:

> For Slack workspaces other than the main one connected to your agent, use the `slack-hop` CLI (`slack-hop --help` for usage; `slack-hop workspaces` lists the configured workspaces).

Then check it works: `slack-hop workspaces` should show each workspace's team and your handle.

## Development

```sh
npm install
npm run check   # typecheck, test, build
```

The compiled `dist/` folder is committed, because `npm install -g github:...` installs the repo as it is without building it. Run `npm run build` and commit `dist/` with every source change; CI fails if they don't match.
