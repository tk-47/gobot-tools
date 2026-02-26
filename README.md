# gobot-tools

CLI marketplace for the **Autonomee** community. Browse, install, and configure integrations for your AI Telegram bot — all from the command line.

Each tool is an interactive setup guide designed for [Claude Code](https://claude.ai/claude-code). Install a tool, open its prompt, and Claude walks you through the rest.

## Quick Start

```bash
# Install globally
bun add -g gobot-tools

# Or run without installing
npx gobot-tools list
```

### First-Time Setup

```bash
# Point gobot-tools at your bot project
gobot-tools init

# Browse available tools
gobot-tools list

# Get details on a specific tool
gobot-tools info oura-ring

# Install a tool into your project
gobot-tools install oura-ring
```

After installing, open the tool's `prompt.md` in Claude Code and follow the guided setup.

## Available Tools

### Integrations

| Tool | Description |
|------|-------------|
| **ms365** | Outlook Calendar, Email, and To Do via Microsoft Graph API |
| **google-api** | Google Calendar and Sheets via Python CLI + TypeScript client |
| **tempest-weather** | WeatherFlow Tempest personal weather station — live data + forecasts |
| **fireflies** | Fireflies.ai meeting transcripts — auto-stores summaries and action items |
| **flightaware** | FlightAware AeroAPI — flight tracking with proactive Telegram notifications |

### Health

| Tool | Description |
|------|-------------|
| **oura-ring** | Oura Ring biometrics + Health Agent for sleep, readiness, medications, symptoms |

### Messaging

| Tool | Description |
|------|-------------|
| **teams** | Microsoft Teams as a second messaging platform with cross-platform sync |
| **voice-interface** | Telegram voice notes + web push-to-talk with per-agent voice mapping |

### Security

| Tool | Description |
|------|-------------|
| **security-audit** | 5-phase application security audit prompt — works on any codebase |
| **vps-hardening** | 9-phase VPS hardening prompt — SSH, Fail2Ban, UFW, Cloudflare, auto-updates |

### Infrastructure

| Tool | Description |
|------|-------------|
| **supabase-to-convex** | Zero-downtime database migration with instant rollback at every phase |

## Commands

```
gobot-tools init                Set your bot project directory
gobot-tools list                Browse all available tools
gobot-tools search <query>      Search by name, category, or keyword
gobot-tools info <tool>         Show details, env vars, dependencies
gobot-tools install <tool>      Download tool into your project
gobot-tools uninstall <tool>    Remove an installed tool
```

## How It Works

1. **`gobot-tools init`** — tell the CLI where your bot project lives
2. **`gobot-tools install <tool>`** — downloads the setup guide and any scripts into `<project>/.gobot-tools/<tool>/`
3. **Open `prompt.md` in Claude Code** — Claude walks you through API keys, code changes, testing, and deployment

Tools are standalone — install only what you need. Some tools list dependencies (e.g., `teams` depends on `ms365`), and the CLI will tell you if you need to install something first.

## Using Without the CLI

Every tool's `prompt.md` works on its own. If you don't want to use the CLI:

1. Browse the [`packages/`](packages/) directory
2. Open any `prompt.md` file
3. Copy it into a Claude Code session
4. Follow the instructions

## About

Built by [tk-47](https://github.com/tk-47) for the Autonomee community. These tools power [Claudebot](https://github.com/tk-47/go-telegram-bot) — an always-on AI Telegram agent with persistent memory, proactive check-ins, morning briefings, and a board of specialist agents.
