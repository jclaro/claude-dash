# claude-dash

A read-only local dashboard for your [Claude Code](https://code.claude.com) configuration. Open it in any project and see, in one place, all your skills, commands, agents, plans, CLAUDE.md files, rules, output styles, hooks, MCP servers and settings, for both your global (`~/.claude`) and project (`.claude/`) scopes.

> **Unofficial.** Not affiliated with or endorsed by Anthropic. "Claude" and "Claude Code" are trademarks of Anthropic.

<!-- Add a screenshot: docs/screenshot.png -->

## Features

- **Everything in one view:** skills, commands, agents, workflows, plans, CLAUDE.md / AGENTS.md, rules, output styles, hooks, MCP servers and settings.
- **Scope labels:** each item is tagged `global`, `project` or `local` (project-only MCP servers), with filters.
- **Search** across names, descriptions and content (press `/`).
- **Detail panel** with frontmatter and rendered Markdown.
- **Always current:** data reloads every time you return to the browser tab.
- **Works in any project:** run it from the project folder.

## Safety

- **Read-only.** It never writes, edits or deletes anything. Only `GET` requests are accepted.
- **Local only.** The server listens on `127.0.0.1`, so it is not reachable from your network.
- **Secrets are masked.** Values under `env`, `headers`, and keys that look like tokens, passwords or credentials are shown as `••••••`.
- From `~/.claude.json` it reads **only** the `mcpServers` entries, never your login or account data.

## Requirements

- [Node.js](https://nodejs.org) 18 or newer. No `npm install` needed: it is a single file with no dependencies.
- A browser. Markdown rendering and fonts load from public CDNs; offline, content is shown as plain text.

## Install

### macOS and Linux

```bash
mkdir -p ~/bin
curl -fsSL https://raw.githubusercontent.com/jclaro/claude-dash/main/claude-dash.mjs -o ~/bin/claude-dash.mjs
```

Then add an alias to your shell config. macOS uses zsh by default; most Linux distributions use bash.

```bash
# zsh (macOS default)
echo 'alias claude-dash="node ~/bin/claude-dash.mjs"' >> ~/.zshrc && source ~/.zshrc

# bash (most Linux distributions)
echo 'alias claude-dash="node ~/bin/claude-dash.mjs"' >> ~/.bashrc && source ~/.bashrc
```

### Windows (PowerShell)

```powershell
New-Item -ItemType Directory -Force "$HOME\bin" | Out-Null
Invoke-WebRequest https://raw.githubusercontent.com/jclaro/claude-dash/main/claude-dash.mjs -OutFile "$HOME\bin\claude-dash.mjs"

if (!(Test-Path $PROFILE)) { New-Item -ItemType File -Force $PROFILE | Out-Null }
Add-Content $PROFILE 'function claude-dash { node "$HOME\bin\claude-dash.mjs" @args }'
. $PROFILE
```

If PowerShell refuses to load your profile, allow local scripts once with:

```powershell
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
```

### Updating

Run the same download command again (`curl` on macOS/Linux, `Invoke-WebRequest` on Windows). This overwrites `~/bin/claude-dash.mjs` with the latest version from `main`.

Check which version you have with `claude-dash --version` (also shown next to the title in the sidebar).

## Usage

```bash
cd path/to/your/project
claude-dash
```

Your browser opens at `http://localhost:4777`. If that port is busy, the next free one is used.

| Option | What it does |
| --- | --- |
| `claude-dash ~/other/project` | Show a different project without changing folder |
| `--port 5000` | Use a specific port |
| `--no-open` | Do not open the browser automatically |
| `--version` | Print the version and exit |

Stop it with `Ctrl+C`.

## What it reads

| Item | Global | Project |
| --- | --- | --- |
| Skills | `~/.claude/skills/*/SKILL.md` | `.claude/skills/*/SKILL.md` |
| Commands | `~/.claude/commands/**/*.md` | `.claude/commands/**/*.md` |
| Agents | `~/.claude/agents/**/*.md` | `.claude/agents/**/*.md` |
| Workflows | `~/.claude/workflows/*.js` | `.claude/workflows/*.js` |
| Rules | `~/.claude/rules/**/*.md` | `.claude/rules/**/*.md` |
| Output styles | `~/.claude/output-styles/*.md` | `.claude/output-styles/*.md` |
| Instructions | `~/.claude/CLAUDE.md` | `CLAUDE.md`, `.claude/CLAUDE.md`, `CLAUDE.local.md`, `AGENTS.md` |
| Settings and hooks | `~/.claude/settings.json` | `.claude/settings.json`, `.claude/settings.local.json` |
| MCP servers | `~/.claude.json` (`mcpServers`) | `.mcp.json`, and project entries in `~/.claude.json` |
| Plans | `~/.claude/plans/` | the folder set in `plansDirectory`, if any |

If `CLAUDE_CONFIG_DIR` is set, it is used instead of `~/.claude`.

Plugins are not included. Only your own configuration is shown.

**Note on plans:** Claude Code deletes files in `~/.claude/plans/` after `cleanupPeriodDays` (30 days by default). To keep your plans, set `plansDirectory` in your settings to a folder of your own.

## License

[MIT](LICENSE) © 2026 João Claro
