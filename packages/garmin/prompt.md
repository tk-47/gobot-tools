# Garmin Connect Integration

> **For Claude Code:** Drop this file into your project root or paste it into a Claude Code session. Claude will walk you through each step interactively. When you're ready, say: **"Set up Garmin Connect integration"**

Connect your Telegram bot to [Garmin Connect](https://connect.garmin.com/) for exercise data, training insights, and running performance. Once set up, the bot can:

- Report Body Battery, steps, stress, and resting heart rate for any day
- Show recent activities — runs, rides, swims, strength sessions, and more
- Pull detailed running data — pace, distance, heart rate zones, elevation gain
- Report training status, training load, and VO2 max trends
- Include exercise data in morning briefings and smart check-ins
- Work alongside Oura Ring (sleep) and Apple Health (activity rings) — each source owns its specialty

---

## How It Works

This integration has two parts: a **data layer** (Python CLI + TypeScript wrapper) and a **reasoning layer** (Health Agent on the board).

### Data Division

| Source | Owns |
|--------|------|
| **Oura Ring** | Sleep, readiness, overnight HRV |
| **Apple Watch** | Steps, activity rings, stand hours |
| **Garmin Connect** | Workouts, training load, Body Battery, VO2 max |

### Data Layer

The bot calls Garmin Connect via a Python script that uses the community `garminconnect` library. This handles Garmin's OAuth2 SSO login and caches tokens so you only log in once.

```
Morning Briefing (scheduled, direct API)
  │
  └── getGarminSummary() — src/lib/garmin.ts
        └── python3 src/lib/garmin.py summary
              └── Garmin Connect cloud → Body Battery, steps, stress, HR
              └── Formatted summary in briefing:
                    "🏃 GARMIN
                     Body Battery: current: 72 | max: 95 | min: 41
                     Steps: 8,432 | 540 active cal
                     Resting HR: 52 bpm
                     Training readiness: 78 (GOOD)"

On-Demand Query (user asks via Telegram)
  │
  └── Orchestrator detects exercise topic → routes to Health Agent
        └── Health Agent calls: bun run src/tools/garmin-cli.ts runs 5
        └── Returns recent runs with pace, distance, HR, elevation
        └── Formats response with performance context and training guidance
```

### Reasoning Layer — The Health Agent

The existing Health Agent (set up by Oura Ring or Apple Health) automatically gains Garmin capabilities. If you're installing Garmin as your first health integration, the Health Agent is also created.

The Health Agent handles Garmin questions with a dedicated exercise thinking process:

| Question Type | How It Works |
|---------------|-------------|
| **Recent runs** | Pulls last N running activities with pace, distance, HR |
| **Training status** | Pulls training load, VO2 max, readiness score |
| **Body Battery** | Pulls today's battery curve — max, min, current |
| **Workout history** | Pulls all activity types — runs, rides, gym sessions, etc. |
| **Training guidance** | Analyzes load + readiness + Battery to recommend easy/hard |

---

## Prerequisites

- A [Garmin Connect](https://connect.garmin.com/) account linked to a Garmin device
- Python 3.8+ installed (`python3 --version`)
- [Bun](https://bun.sh/) runtime installed

---

## Step 1: Install Python Dependency

### What you need to do:

Run this in your terminal:

```bash
pip install garminconnect
```

Or with pip3:

```bash
pip3 install garminconnect
```

This installs the community `garminconnect` library (not an official Garmin SDK). It handles their OAuth2 SSO login and provides a clean Python API for your Connect data.

### Tell Claude Code:
"garminconnect is installed"

---

## Step 2: Add Credentials to Environment

### What Claude Code does:
- Adds `GARMIN_EMAIL` and `GARMIN_PASSWORD` to your `.env` file
- Adds placeholders to `.env.example`

```env
# Garmin Connect
GARMIN_EMAIL=your-garmin-email@example.com
GARMIN_PASSWORD=your-garmin-password
```

**Note:** These credentials are used only for the initial login. After that, tokens are cached at `data/garmin-tokens/` and auth is automatic. You can remove the password from `.env` after setup if you prefer.

### Tell Claude Code:
"Here are my Garmin credentials — email: [EMAIL] password: [PASSWORD]"

---

## Step 3: First-Time Login

### What Claude Code does:
- Copies `src/garmin.py` to `src/lib/garmin.py`
- Runs the interactive setup command to log in and cache tokens

```bash
python3 src/lib/garmin.py setup
```

If your Garmin account has two-factor authentication (2FA) enabled, you'll be prompted to enter the code from your authenticator app or email. After successful login, tokens are saved to `data/garmin-tokens/`.

**Important:** The `data/garmin-tokens/` directory should be in your `.gitignore` — it contains your OAuth session tokens. Claude Code will verify this.

### Tell Claude Code:
"Run the Garmin setup"

---

## Step 4: Create the TypeScript Wrapper and CLI Tool

### What Claude Code does:
- Creates `src/lib/garmin.ts` — TypeScript wrapper that calls `garmin.py` via subprocess
- Creates `src/tools/garmin-cli.ts` — CLI wrapper for Claude subprocess access
- Tests the CLI to verify everything works

The TypeScript wrapper exports these functions:

| Function | Purpose |
|----------|---------|
| `isGarminEnabled()` | Check if Garmin tokens exist |
| `getGarminSummary(date?)` | Compact summary — Body Battery, steps, stress, HR |
| `getRecentActivities(n?)` | N most recent activities of any type |
| `getRecentRuns(n?)` | N most recent running workouts |
| `getTrainingStatus()` | Training status, load, and VO2 max |

### Tell Claude Code:
"Create the Garmin TypeScript wrapper and CLI tool"

---

## Step 5: Wire Into Morning Briefing & Smart Check-in

### What Claude Code does:
- Adds Garmin summary to `src/morning-briefing.ts` — appears in the health section alongside Oura/Apple data
- Adds Garmin data to `src/smart-checkin.ts` — injected into Claude's decision context
- If Health Agent doesn't exist yet, creates `src/agents/health.ts` with Garmin support
- If Health Agent already exists (from Oura or Apple), updates it to add Garmin data access

### Tell Claude Code:
"Wire Garmin into the morning briefing, smart check-in, and Health Agent"

---

## Step 6: Verify Everything

### What Claude Code does:
- Tests the Garmin CLI with each command
- Verifies the Health Agent loads and recognizes Garmin
- Confirms the orchestrator routes exercise messages

```bash
# Test daily summary
bun run src/tools/garmin-cli.ts summary

# Test recent runs
bun run src/tools/garmin-cli.ts runs 3

# Test training status
bun run src/tools/garmin-cli.ts training
```

### How to test:
Send these messages to your bot on Telegram:
- "How was my last run?" — should pull most recent running workout
- "What's my Body Battery?" — should show today's battery curve
- "How's my training load?" — should pull training status with VO2 max
- "Show me my recent workouts" — should list last 5 activities

### Tell Claude Code:
"Test the Garmin integration"

---

## What Data Is Available

### Daily Summary (via `garmin-cli.ts summary`)

| Field | Example |
|-------|---------|
| Body Battery current | 72 |
| Body Battery max/min | max: 95, min: 41 |
| Steps | 8,432 |
| Active calories | 540 |
| Resting heart rate | 52 bpm |
| Average stress | 28 |
| Intensity minutes | 45 |
| Training readiness | 78 (GOOD) |

### Recent Activities (via `garmin-cli.ts activities [N]`)

| Field | Example |
|-------|---------|
| Activity name | Morning Run |
| Activity type | running |
| Date | 2026-02-28 |
| Distance | 8.50 km |
| Duration | 47m |
| Avg pace | 5:32 /km |
| Avg HR | 148 bpm |
| Max HR | 167 bpm |
| Calories | 524 |
| Elevation gain | 85 m |

### Running Workouts (via `garmin-cli.ts runs [N]`)

Same fields as activities, filtered to running type only. Useful when you want just running data without gym sessions or rides mixed in.

### Training Status (via `garmin-cli.ts training`)

| Field | Example |
|-------|---------|
| Training status | PRODUCTIVE |
| Training load | 312 |
| Training load feedback | OPTIMAL |
| VO2 max | 51.0 |
| Fitness age | 29 |
| Training readiness | 78 (GOOD) |

---

## Where Garmin Data Appears

| Context | What's Included |
|---------|----------------|
| **Morning briefing** | Body Battery, steps, resting HR, stress, training readiness |
| **Smart check-in** | Garmin summary injected into Claude's decision context — Claude adapts recommendations based on training load and readiness |
| **Health Agent (on-demand)** | Detailed activity reports, running analysis, training guidance, VO2 max trends |
| **Board meetings** | Health Agent contributes exercise perspective when orchestrator runs a full board meeting |

---

## CLI Reference

The Claude subprocess (and you manually) can query Garmin data via:

```bash
# Today's Body Battery, steps, stress, resting HR
bun run src/tools/garmin-cli.ts summary
bun run src/tools/garmin-cli.ts summary 2026-02-20

# N most recent activities (any type)
bun run src/tools/garmin-cli.ts activities
bun run src/tools/garmin-cli.ts activities 10

# N most recent running workouts
bun run src/tools/garmin-cli.ts runs
bun run src/tools/garmin-cli.ts runs 3

# Training status, load, VO2 max
bun run src/tools/garmin-cli.ts training
```

---

## Updating

To get the latest version of this integration:

```bash
gobot-tools update garmin
```

This re-downloads files when a newer version is available in the registry.

---

## VPS Setup

Add the same credentials to your VPS `.env`:

```env
GARMIN_EMAIL=your-garmin-email@example.com
GARMIN_PASSWORD=your-garmin-password
```

Then run setup on the VPS to cache tokens there:

```bash
python3 src/lib/garmin.py setup
```

Tokens are stored in `data/garmin-tokens/` on the VPS and auto-refresh. You only need to re-run setup if tokens expire (typically after several months of inactivity).

---

## Architecture

### New Files

| File | Purpose |
|------|---------|
| `src/lib/garmin.py` | Python CLI — calls Garmin Connect, outputs JSON. Commands: setup, summary, activities, runs, training |
| `src/lib/garmin.ts` | TypeScript wrapper — spawns `garmin.py`, formats output for Telegram. Exports `isGarminEnabled()`, `getGarminSummary()`, etc. |
| `src/tools/garmin-cli.ts` | CLI wrapper so the Claude subprocess can query exercise data on demand |

### Modified Files

| File | Changes |
|------|---------|
| `.env` / `.env.example` | Added `GARMIN_EMAIL`, `GARMIN_PASSWORD` |
| `src/morning-briefing.ts` | Garmin health section in the daily briefing |
| `src/smart-checkin.ts` | Garmin data injected into Claude's decision context |
| `src/agents/health.ts` | Garmin data access section and exercise thinking process added |

---

## Troubleshooting

| Problem | Solution |
|---------|----------|
| "No Garmin tokens found" | Run `python3 src/lib/garmin.py setup` to log in |
| "garminconnect not installed" | Run `pip install garminconnect` |
| "Login failed: 401" | Wrong email/password in `.env`, or Garmin account is locked |
| MFA prompt appears but hangs | Enter your authenticator code in the terminal, press Enter |
| "No output from garmin.py" | Check Python version (`python3 --version` — needs 3.8+) |
| Data is from yesterday | Garmin syncs via Bluetooth to the app first — open the Garmin app on your phone to force sync |
| Body Battery shows no data | Some Garmin models don't support Body Battery — check your device specs |
| Training status is empty | Training status requires at least a few weeks of activity history |
| VO2 max shows null | VO2 max needs outdoor running/cycling with GPS to calculate |
| Runs not appearing in `activities` | The activity may be too old — `activities` returns the N most recent, regardless of type |
| MFA loop / keeps asking for code | Try logging out of Garmin Connect web, log back in, then re-run setup |

---

## Security Notes

- Your email and password are stored in `.env` — keep this file out of version control (it should already be in `.gitignore`)
- After initial setup, you can optionally remove `GARMIN_PASSWORD` from `.env` — tokens auto-refresh
- The `data/garmin-tokens/` directory contains OAuth session tokens — do not share or commit these
- The `garminconnect` library communicates directly with Garmin's servers — no third-party proxies

---

## References

- [Garmin Connect](https://connect.garmin.com/) — The web interface for your data
- [garminconnect on PyPI](https://pypi.org/project/garminconnect/) — Python library documentation
- [garminconnect on GitHub](https://github.com/cyberjunky/python-garminconnect) — Source code and issue tracker
- [garth](https://github.com/matin/garth) — OAuth2 token management library (dependency)
