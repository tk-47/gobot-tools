# Garmin Connect Integration for Claudebot

Connect your Telegram bot to [Garmin Connect](https://connect.garmin.com/) for exercise data, training insights, and running performance.

## What It Does

- **Body Battery** — daily energy reserve tracking (max, min, current)
- **Running workouts** — pace, distance, heart rate, elevation
- **All activities** — runs, rides, swims, gym sessions, and more
- **Training load** — weekly load with productive/maintaining/overreaching status
- **VO2 max** — aerobic fitness tracking over time
- **Training readiness** — daily score for when to push hard vs. recover
- **Morning briefing** — Garmin summary alongside weather and calendar
- **Smart check-in** — Claude adapts recommendations based on training load and Battery

## Data Division

| Source | Specialty |
|--------|-----------|
| Oura Ring | Sleep, overnight HRV, readiness |
| Apple Health | Steps, activity rings, stand hours |
| **Garmin Connect** | **Workouts, training load, Body Battery, VO2 max** |

Works standalone or alongside Oura and Apple Health. Each source owns its specialty — no double-counting.

## Installation

```bash
gobot-tools install garmin
```

Then open `prompt.md` in Claude Code and say: **"Set up Garmin Connect integration"**

## Updating

```bash
gobot-tools update garmin
```

## Requirements

- A Garmin device (any model that syncs to Garmin Connect)
- Python 3.8+: `pip install garminconnect`
- Garmin Connect account credentials

## CLI Reference

```bash
# Daily overview
bun run src/tools/garmin-cli.ts summary [DATE]

# Recent activities (any type)
bun run src/tools/garmin-cli.ts activities [N]

# Running workouts only
bun run src/tools/garmin-cli.ts runs [N]

# Training status + VO2 max
bun run src/tools/garmin-cli.ts training
```

## How Auth Works

Uses the community `garminconnect` Python library with garth OAuth2 token caching. Run `python3 src/lib/garmin.py setup` once to log in interactively. Tokens are cached at `data/garmin-tokens/` and auto-refresh on each request.
