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

### [Travel Weather Alerts](packages/travel-weather) — `gobot-tools install travel-weather`

Automatic weather and traffic alerts for out-of-town calendar events. When your calendar has an event with a location outside your home area, the bot checks weather along the driving route — outbound and return — and includes warnings in the morning briefing. Severe weather triggers a standalone Telegram alert.

- Route weather: samples conditions every ~30 miles along the driving route
- Both legs: outbound (depart 1 hour before event) and return (depart when event ends)
- Traffic estimates from Google Directions — shows delay if >5 min over normal
- Hazard detection: rain, storms, snow, ice, fog, or ≥40% precipitation
- Standalone Telegram alert before briefing for severe conditions
- Works with any calendar source: Outlook, Google, Apple, or ICS feeds
- **Setup time:** ~5 minutes
- **Requires:** `GOOGLE_MAPS_API_KEY`, `OPENWEATHERMAP_API_KEY`

### [Apple Notes (Local macOS)](packages/apple-notes) — `gobot-tools install apple-notes`

Connect your bot to Apple Notes.app using local macOS Automation (JXA). Read/search/create/append notes directly on your Mac with no API keys, OAuth flow, or cloud API setup.

- Notes list/read/search/create/append
- Natural-language Notes intent interception in bot handlers
- Local-only integration (no external network dependency)
- **Setup time:** ~5 minutes
- **Requires:** macOS + Automation permission for Notes

### [URL Calendar (ICS Feed)](packages/url-calendar) — `gobot-tools install url-calendar`

Read events from any calendar — Apple, Google, Outlook, or any CalDAV source — by pointing the bot at a public or private ICS feed URL. **Read-only** — ICS is a one-way pull protocol; creating or editing events requires the ms365 or google-api tools.

- Works with any ICS/webcal feed: Apple Calendar, Google Calendar, Outlook, and more
- Multiple feed support — merge and sort events from several calendars at once
- Full recurrence rule support (DAILY, WEEKLY with BYDAY, INTERVAL, COUNT, UNTIL)
- Timezone-aware formatting, all-day event detection
- No API keys, no OAuth, no macOS Automation — works on Mac and VPS
- **Setup time:** ~2 minutes
- **Requires:** `APPLE_CALENDAR_URL` (any ICS feed URL)

### [Fireflies.ai Meeting Transcripts](packages/fireflies) — `gobot-tools install fireflies`

Connect your bot to Fireflies.ai so meeting transcripts are automatically stored in memory. Summaries become searchable facts, action items become trackable goals, and you get a Telegram notification when it's done.

- Automatic meeting summary storage
- Action items saved as trackable goals
- Webhook-based — no polling, no manual steps
- Searchable via semantic memory — "What did we discuss in the Q1 meeting?"
- **Setup time:** ~10 minutes
- **Requires:** `FIREFLIES_API_KEY`, `FIREFLIES_WEBHOOK_SECRET`

### [Rachio Irrigation](packages/rachio) — `gobot-tools install rachio`

Control and monitor your Rachio smart irrigation system via Telegram. Start zones, set rain delays, check schedules, and receive push notifications when watering starts or finishes — all in natural language.

- Zone control — "water front yard for 15 min", "run zone 3 for 10 minutes"
- Schedule management — start, skip, or seasonally adjust schedules
- Rain delay — "rain delay 2 days" activates with resume date in the reply
- Status queries — "rachio status", "is it watering?", "watering schedule"
- Push notifications — Telegram alert when zone completes, schedule finishes, rain sensor triggers, or device goes offline (via VPS webhook)
- Morning briefing — next scheduled run appended to daily briefing automatically
- **No LLM parsing** — regex intent matching keeps it fast and offline-safe
- **Setup time:** ~5 minutes
- **Requires:** `RACHIO_API_KEY`, `RACHIO_WEBHOOK_SECRET` (for push notifications)

### [FlightAware Flight Tracking](packages/flightaware) — `gobot-tools install flightaware`

Real-time flight tracking via FlightAware AeroAPI. Look up any flight, set up active tracking with proactive Telegram notifications for gate changes, delays, and arrivals, and pull travel data into morning briefings.

- One-time flight lookups by flight number
- Active tracking with push notifications for status changes
- Morning briefing integration for upcoming travel
- Cost guardrails to stay within API limits
- **Setup time:** ~10 minutes
- **Requires:** `FLIGHTAWARE_API_KEY`

### [E2B Code Sandbox](packages/e2b-sandbox) — `gobot-tools install e2b-sandbox`

Execute Python code in isolated cloud sandboxes via [E2B](https://e2b.dev). Adds a `/run` command for direct execution and a Claude-initiated confirmation flow — Claude can write code, propose running it, and report real results back to chat. Each execution runs in a fresh Firecracker microVM that is destroyed the moment it finishes. No local Docker required.

- `/run <code>` — execute Python directly from Telegram, get stdout/stderr back instantly
- Claude-proposed execution — Claude generates `[ACTION:run_code]` tags; you confirm with a button tap
- Useful for: calculations, data processing, text manipulation, quick scripts, algorithmic problems
- Ephemeral VMs — no filesystem state between runs, no outbound network access from code
- Daily limit on Claude-initiated runs (default 20/day, configurable)
- **New accounts receive $100 in free credits** — typical personal use lasts months before any charges
- **Setup time:** ~5 minutes
- **Requires:** `E2B_API_KEY`, `SANDBOX_ENABLED=true`

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

### [Apple Watch + Health Agent](packages/apple-health) — `gobot-tools install apple-health`

Connect your iPhone and Apple Watch to your bot using the free Health Auto Export app. No Apple API token required — data is pushed directly from your phone. Works standalone or alongside Oura Ring.

- Sleep stages (Deep, REM, Core), efficiency, bedtime/wake time
- HRV, resting heart rate, SpO₂, wrist temperature, VO₂ Max
- Steps, active calories, exercise minutes, stand hours
- Computed readiness score (proxy for Oura's readiness, no subscription needed)
- If you don't wear your watch to bed, the Health Agent automatically uses Oura (or any other source) for sleep data
- **Setup time:** ~5 minutes
- **Requires:** `APPLE_HEALTH_WEBHOOK_SECRET`

### [Garmin Connect + Health Agent](packages/garmin) — `gobot-tools install garmin`

Connect your Garmin device to your bot for workout data, training insights, sleep tracking, and daily health metrics. Uses the community `garminconnect` library — no developer registration required.

- Body Battery, training readiness, VO₂ max, and training status
- All activity types: running, cycling, swimming, strength, hiking, and more
- Sleep stages, steps, resting heart rate, and stress data
- Works alongside Oura and Apple Watch — all three sources complement each other; the Health Agent pulls from whichever has data for any given metric
- **Setup time:** ~10 minutes
- **Requires:** `GARMIN_EMAIL`, `GARMIN_PASSWORD` (for initial setup only — tokens cached after first login)

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

## Family

### [Homework Helper](packages/homework-helper) — `gobot-tools install homework-helper`

A standalone web app that turns your existing API keys into a grades 5–8 homework helper. Your child opens it on any device — iPad, tablet, laptop, phone — on the same WiFi as the computer running the server. No public URL needed.

The design priority is correctness for math: Claude writes Python code, E2B runs it in an isolated cloud VM, and the verified output becomes the answer. Claude only explains how to get there — it never states or guesses the number itself. Science and history use a single vision call that can read photos of worksheets or textbook pages.

- Math: Claude generates Python → E2B executes → verified answer → step-by-step explanation
- Science/History: Vision call reads question and optional reference image, explains at grade level
- Camera input on mobile — snap a photo of the worksheet directly from the browser
- KaTeX math rendering for clean fraction and equation display
- Mobile-first UI with 44px+ touch targets and dark mode
- Completely standalone — shares only your API keys, no bot stack required
- **Setup time:** ~5 minutes
- **Requires:** `ANTHROPIC_API_KEY`, `E2B_API_KEY`

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
gobot-tools update [tool]       Update a tool, or all installed tools
```

## How It Works

1. **`gobot-tools init`** — tell the CLI where your bot project lives
2. **`gobot-tools install <tool>`** — downloads the setup guide and any scripts into `<project>/.gobot-tools/<tool>/`
3. **Open `prompt.md` in Claude Code** — Claude walks you through API keys, code changes, testing, and deployment

Tools are standalone — install only what you need. Some tools list dependencies (e.g., `teams` depends on `ms365`), and the CLI will tell you if you need to install something first.

When a tool receives a bug fix or new feature, update it with:

```bash
gobot-tools update security-sentinel   # update one tool
gobot-tools update                     # update all installed tools
```

## Using Without the CLI

Every tool's `prompt.md` works on its own. If you don't want to use the CLI:

1. Browse the [`packages/`](packages/) directory
2. Open any tool's `prompt.md` file
3. Copy it into a Claude Code session
4. Follow the interactive setup

## About

Built by [tk-47](https://github.com/tk-47) for the Autonomee community. These tools power [Claudebot](https://github.com/tk-47/go-telegram-bot) — an always-on AI Telegram agent originally built by GodaGo with persistent memory, proactive check-ins, morning briefings, and a board of specialist agents.
