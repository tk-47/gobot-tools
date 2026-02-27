# gobot-tools

CLI marketplace for the **Autonomee** community. Browse, install, and configure integrations for your AI Telegram bot — all from the command line.

Each tool is an interactive setup guide designed for [Claude Code](https://claude.ai/claude-code). Install a tool, open its prompt, and Claude walks you through the rest — API keys, code changes, testing, and deployment.

## Quick Start

```bash
# Install globally
bun add -g gobot-tools

# Or run without installing
npx gobot-tools list
```

```bash
gobot-tools init              # Point at your bot project
gobot-tools list              # Browse all tools
gobot-tools info oura-ring    # Details before you install
gobot-tools install oura-ring # Download the setup guide
```

After installing, open the tool's `prompt.md` in Claude Code and follow the guided setup.

---

## Integrations

### [Microsoft 365](packages/ms365) — `gobot-tools install ms365`

Connect your bot to Outlook Calendar, Email, and Microsoft To Do via the Microsoft Graph API. Ask your bot "What's on my schedule today?" or "Do I have any unread emails?" and get real answers from your actual account.

- Calendar reads/writes with natural language dates
- Unread email summaries
- Microsoft To Do task management
- Auto-inclusion in daily morning briefings
- **Setup time:** ~10 minutes
- **Requires:** `MS365_CLIENT_ID`, `MS365_TENANT_ID`, `MS365_REFRESH_TOKEN`

### [Google Calendar & Sheets](packages/google-api) — `gobot-tools install google-api`

Connect your bot to Google Calendar and Google Sheets using lightweight Python CLI scripts and a TypeScript client. Bypasses flaky MCP servers with direct API calls that actually work.

- Calendar: list, create, delete, search events
- Sheets: read, write, append, create spreadsheets
- Drive: search spreadsheets by name
- Shared OAuth credentials — one auth flow covers everything
- **Setup time:** ~15 minutes
- **Requires:** `GOOGLE_SHEETS_CLIENT_ID`, `GOOGLE_SHEETS_CLIENT_SECRET`, `GOOGLE_SHEETS_REFRESH_TOKEN`

### [Tempest Weather Station](packages/tempest-weather) — `gobot-tools install tempest-weather`

Connect your bot to a WeatherFlow Tempest personal weather station. Get live conditions from your own backyard instead of generic internet forecasts. Uses direct API calls to bypass Claude's web search for speed and accuracy.

- Live conditions: temperature, humidity, wind, pressure, rain, UV, lightning
- 5-day forecast
- Natural language triggers — "Is it cold outside?", "What's the weather?"
- Intentional Claude bypass for accurate local readings
- **Setup time:** ~5 minutes
- **Requires:** `TEMPEST_TOKEN`, `TEMPEST_STATION_ID`

### [Fireflies.ai Meeting Transcripts](packages/fireflies) — `gobot-tools install fireflies`

Connect your bot to Fireflies.ai so meeting transcripts are automatically stored in memory. Summaries become searchable facts, action items become trackable goals, and you get a Telegram notification when it's done.

- Automatic meeting summary storage
- Action items saved as trackable goals
- Webhook-based — no polling, no manual steps
- Searchable via semantic memory — "What did we discuss in the Q1 meeting?"
- **Setup time:** ~10 minutes
- **Requires:** `FIREFLIES_API_KEY`, `FIREFLIES_WEBHOOK_SECRET`

### [FlightAware Flight Tracking](packages/flightaware) — `gobot-tools install flightaware`

Real-time flight tracking via FlightAware AeroAPI. Look up any flight, set up active tracking with proactive Telegram notifications for gate changes, delays, and arrivals, and pull travel data into morning briefings.

- One-time flight lookups by flight number
- Active tracking with push notifications for status changes
- Morning briefing integration for upcoming travel
- Cost guardrails to stay within API limits
- **Setup time:** ~10 minutes
- **Requires:** `FLIGHTAWARE_API_KEY`

---

## Health

### [Oura Ring + Health Agent](packages/oura-ring) — `gobot-tools install oura-ring`

Connect your bot to an Oura Ring and add a Health Agent to the board. Biometric data flows into morning briefings and smart check-ins, and a dedicated wellness advisor handles everything from sleep analysis to medication lookups.

- Sleep, readiness, activity, and stress scores in briefings
- Health Agent on the board — biometrics, medication info, symptom lookup
- Health-aware smart check-ins — tone adapts to how you slept
- Drug interactions, side effects, lab results interpretation
- **Setup time:** ~5 minutes
- **Requires:** `OURA_ACCESS_TOKEN`

---

## Messaging

### [Microsoft Teams](packages/teams) — `gobot-tools install teams`

Add Teams as a second messaging platform with synchronized conversations. Messages from Telegram and Teams share the same history — Claude sees full context regardless of where you sent from.

- Synchronized cross-platform conversations
- Human-in-the-loop via Adaptive Cards
- Same hybrid routing (VPS + local Mac)
- No botbuilder SDK — direct Bot Framework REST API
- **Setup time:** ~30 minutes
- **Requires:** `TEAMS_APP_ID`, `TEAMS_APP_PASSWORD`, `TEAMS_ALLOWED_USER_ID`, `TEAMS_TENANT_ID`
- **Depends on:** `ms365`

### [Voice Interface — Telegram + Web](packages/voice-interface) — `gobot-tools install voice-interface`

Add two voice interfaces: Telegram voice notes (send a voice message, get a voice reply) and a web-based push-to-talk interface with distinct voices for each board agent.

- Telegram: Gemini transcription → Anthropic processing → Speaktor TTS
- Web: Browser STT (free, on-device) → Claude Code CLI → OpenAI TTS (per-agent voice)
- 8 distinct agent voices with personality instructions
- Estimated cost: ~$3/month (Telegram) or ~$0.05/month (web only)
- **Setup time:** ~15 minutes
- **Requires:** `GEMINI_API_KEY`, `SPEAKTOR_API_KEY`, `OPENAI_API_KEY`, `VOICE_WEB_TOKEN`

---

## Security

### [Security Sentinel](packages/security-sentinel) — `gobot-tools install security-sentinel`

Autonomous security scanning agent for your VPS and web infrastructure. Runs 80+ checks across authentication, TLS, headers, VPS hardening, API credentials, and dependencies. Generates compliance reports for SOC2, HIPAA, and PCI-DSS with optional AI-powered analysis via Ollama or Claude API.

- 4 scan modes: quick, standard, deep, compliance-only
- Scheduled scans with Telegram notifications
- AI analysis with local Ollama models or Claude API
- Full source code included — customize checks for your stack
- **Setup time:** ~20 minutes
- **Requires:** `VPS_URL`, `VPS_SSH_HOST`, `DOMAIN`, `TELEGRAM_BOT_TOKEN`, and more (see `gobot-tools info security-sentinel`)

### [Application Security Audit](packages/security-audit) — `gobot-tools install security-audit`

A 5-phase audit prompt that reviews your application code for vulnerabilities. Paste it into Claude Code from your project root — it maps your attack surface, identifies issues ranked by severity, and helps you fix them one commit at a time.

- Injection: command injection, prompt injection, path traversal, SSRF
- Auth gaps: unauthenticated endpoints, missing webhook verification
- Secret leaks: API keys in URLs/logs, hardcoded credentials, secrets in git history
- Config: permissive CORS, missing rate limiting, verbose error messages
- **Setup time:** ~5 minutes (audit itself takes longer depending on codebase size)
- **Works on any codebase** — no env vars required

### [VPS Hardening](packages/vps-hardening) — `gobot-tools install vps-hardening`

A 9-phase hardening prompt for your Linux VPS. Paste it into Claude Code while SSH'd into your server — it audits your current state, locks down SSH, sets up firewall rules, and verifies nothing broke.

- SSH hardening: disable root, key-only auth, AllowUsers, idle timeout
- Fail2Ban with 24-hour progressive bans for repeat offenders
- UFW firewall with Docker-aware iptables rules
- Cloudflare origin protection — locks ports 80/443 to Cloudflare IP ranges
- Automatic security updates
- **Setup time:** ~30 minutes
- **Works on any Linux VPS** — no env vars required

---

## Infrastructure

### [Supabase to Convex Migration](packages/supabase-to-convex) — `gobot-tools install supabase-to-convex`

Migrate your bot's database from Supabase to Convex with zero downtime. Uses a backend adapter pattern so you can run both databases in parallel and roll back instantly at every phase.

- Schema translation: SQL → TypeScript, pgvector → Convex vector search
- Drop-in client adapter with identical function signatures
- Data migration script that preserves existing embeddings
- Dual-write verification phase before cutover
- **Setup time:** ~1 day active work + 2 days monitoring
- **Requires:** `CONVEX_URL`, `DB_BACKEND`

---

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
2. Open any tool's `prompt.md` file
3. Copy it into a Claude Code session
4. Follow the interactive setup

## About

Built by [tk-47](https://github.com/tk-47) for the Autonomee community. These tools power [Claudebot](https://github.com/tk-47/go-telegram-bot) — an always-on AI Telegram agent originally built by GodaGo with persistent memory, proactive check-ins, morning briefings, and a board of specialist agents.
