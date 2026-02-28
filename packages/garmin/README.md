# Garmin Connect + Health Agent

Connect your Garmin device to Claudebot for workout data, training insights, sleep tracking, and daily health metrics.

No Garmin developer registration required — authentication uses the community `garminconnect` library with OAuth2 token caching.

Works standalone or alongside the Oura Ring and Apple Watch integrations.

---

## Requirements

- A Garmin device that syncs to Garmin Connect (any Forerunner, vívoactive, Fenix, Instinct, etc.)
- Python 3.8+
- Your Garmin Connect account credentials

---

## Setup (10 minutes)

### Step 1 — Install the Python library

```bash
pip install garminconnect
```

### Step 2 — Add your credentials to `.env`

These are used only for the initial login — after that, OAuth2 tokens are cached locally.

```
GARMIN_EMAIL=your-garmin-email@example.com
GARMIN_PASSWORD=your-garmin-password
```

### Step 3 — Authenticate

Run this **once in a real terminal** (not a script) — Garmin requires interactive input for MFA if enabled:

```bash
python3 src/lib/garmin.py setup
```

Tokens are saved to `data/garmin-tokens/`. All future calls auto-refresh without reading your password.

### Step 4 — Install the bot integration

Claude Code will guide you through:
1. Adding `src/lib/garmin.ts` and `src/lib/garmin.py` to your bot
2. Adding `src/tools/garmin-cli.ts` for command-line access
3. Updating `src/agents/health.ts` to include Garmin alongside other health sources

Open `prompt.md` in Claude Code and say: **"Set up Garmin Connect integration"**

---

## Updating

```bash
gobot-tools update garmin
```

---

## Data Available

Garmin captures a wide range of health metrics depending on your device model and Garmin Connect plan.

### Sleep

- Bedtime and wake time
- Sleep stages (Light, Deep, REM, Awake) — recent devices
- SpO₂ during sleep — supported devices
- Overnight average heart rate

### Daily Health

- Body Battery — energy reserve on a 0–100 scale, updated continuously throughout the day
- Steps and active calories
- Resting heart rate
- Average and peak stress level
- Intensity minutes

### Exercise & Workouts

- All activity types: running, cycling, swimming, strength, hiking, and more
- Duration, distance, pace (running), speed
- Average and max heart rate per session
- Elevation gain
- Calories burned

### Training & Fitness

- Training readiness — daily score combining HRV status, sleep quality, recovery time, and stress
- Training status — Productive, Maintaining, Overreaching, Detraining, etc.
- Weekly training load with feedback
- VO₂ max — aerobic fitness estimate based on your workouts

---

## Using Garmin with Oura and Apple Watch

All three wearables can capture overlapping metrics — sleep, steps, heart rate, VO₂ max, and more. There is no required division of labor. You might use Garmin for sleep and workouts, Apple Watch for daily steps, and Oura for HRV. Or you might track everything on Garmin alone.

The Health Agent handles any combination:

- **Sleep**: Garmin tracks sleep when worn overnight. If Oura or Apple Watch are also active, the agent pulls from all sources with data and compares them. No single device is assumed to be authoritative.
- **Steps**: Garmin records steps during activities and throughout the day. Apple Watch (if connected) records continuously. The agent reports from whichever source has more complete data, or both.
- **Heart rate & HRV**: Available from all three. HRV algorithms differ — Oura uses RMSSD; Apple Watch uses SDNN. The agent notes this if you compare the two.
- **VO₂ max**: Available from both Garmin and Apple Watch. Garmin's estimate is based on running and cycling data; Apple Watch uses a broader activity model. Both are reported when available.
- **Readiness scores**: Each source has its own score — Oura's readiness, Garmin's training readiness, and a computed proxy for Apple-only users. All available scores are reported. Each measures something slightly different and all are useful.

The agent pulls from every configured source for any health question, prioritizes whichever has more complete data for that specific metric, and explains differences when sources diverge.

---

## How the Data Flows

Understanding exactly where your health data goes is important. Here's the full picture:

```
Garmin Device (watch/GPS)
    ↓  (Bluetooth)
Garmin Connect app
    ↓  (Garmin's cloud sync)
Garmin Connect servers
    ↓  (OAuth2 — garminconnect Python library)
garmin.py  (on your machine or VPS)
    ↓  (JSON piped to stdout, on demand)
garmin.ts → Health Agent (Claude)  →  your Telegram chat
```

**What this means in practice:**

- Your Garmin device syncs to the Garmin Connect app and Garmin's servers as normal — nothing changes there
- When you ask a health question, `garmin.ts` spawns `garmin.py` as a subprocess
- `garmin.py` authenticates with Garmin Connect via cached OAuth2 tokens and fetches only what's needed for that query
- The JSON response is piped to stdout and parsed by `garmin.ts` — no health data is written to disk on your machine
- The Health Agent reads the formatted result and incorporates it into its response

**What never happens:**

- Your health data is not cached or stored locally beyond the current request
- Your Garmin password is never read after the initial `setup` command — only OAuth tokens are used
- No service outside `connect.garmin.com` receives your data through this integration
- Claude processes your data transiently during inference — it is not stored by Anthropic beyond their standard retention policy

---

## Privacy

**Credential handling:** Your `GARMIN_EMAIL` and `GARMIN_PASSWORD` are only read during the initial `setup` command. After that, `garth` manages OAuth2 tokens stored at `data/garmin-tokens/`. Your password is never sent or read again for normal operation.

**Local token storage:** OAuth tokens are stored in `data/garmin-tokens/` on your machine or VPS. They function like a session cookie — they expire and auto-refresh. Delete the directory at any time to force a fresh login.

**On-demand fetching:** `garmin.py` fetches data only when a health question is asked. No background process runs; no data is cached between queries.

**Garmin's servers:** Your workout and health data lives on Garmin's infrastructure per their [privacy policy](https://www.garmin.com/en-US/privacy/global-privacy-statement/). This integration reads data Garmin has already collected — it does not create a new data pipeline or modify how your device syncs.

**No third-party analytics:** The `garminconnect` library communicates only with `connect.garmin.com`. No telemetry, usage data, or health metrics are sent to any other service.
