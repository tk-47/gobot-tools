# Rachio Irrigation

Control and monitor your [Rachio](https://rachio.com) smart irrigation system from Telegram. Start zones, adjust schedules, set rain delays, and get push notifications when watering finishes — all in natural language.

---

## Requirements

- A Rachio controller (any generation) connected to your WiFi and reporting to the Rachio cloud
- A Rachio account with API access enabled
- Your bot running in hybrid or VPS mode with a public HTTPS URL (for push notifications)

---

## What You Can Do

**Zone control**
- "water front yard for 15 minutes"
- "run zone 3 for 10 min"
- "stop watering"

**Schedule management**
- "watering schedule" — show next scheduled run
- "run schedule" — start your active schedule now
- "skip watering" — skip the next scheduled run
- "reduce watering 20%" — seasonal adjustment

**Rain delay**
- "rain delay 2 days" — pauses all watering, shows resume date
- "rain delay 24 hours"

**Status**
- "rachio status" — device status + enabled zones
- "is it watering?" — same

**Push notifications (via webhook)**
- Zone finished → "💧 Zone "Front Yard" finished (15 min)."
- Schedule done → "✅ Watering schedule done. Total: 43 min."
- Rain sensor on → "🌧 Rain sensor triggered — watering paused."
- Rain sensor off → "☀️ Rain sensor cleared — watering resumed."
- Device offline → "⚠️ Rachio controller offline."

**Morning briefing**
When `RACHIO_API_KEY` is set, the daily briefing includes irrigation status — next scheduled run or currently running zone.

---

## Setup

### Step 1 — Get your Rachio API key

1. Open [app.rach.io](https://app.rach.io)
2. Go to **Account** → **API Access**
3. Copy your API key (UUID format)

Add it to your bot's `.env`:

```
RACHIO_API_KEY=your_api_key_here
```

### Step 2 — Restart the bot

The keyword intercept activates as soon as `RACHIO_API_KEY` is set. No other changes needed for basic control.

### Step 3 — Set up push notifications (optional but recommended)

Push notifications are delivered via a webhook on your VPS. When a zone finishes, a schedule completes, or a rain sensor triggers, Rachio POSTs to your VPS and the bot sends you a Telegram message — even when your Mac is offline.

**Generate a webhook secret:**
```bash
openssl rand -hex 32
```

Add it to `.env` on both your Mac and VPS:
```
RACHIO_WEBHOOK_SECRET=your_secret_here
```

**Register the webhook with Rachio** (run once from your project root):
```ts
import { getDevices, subscribeWebhook, RACHIO_EVENT_TYPES } from "./src/lib/rachio";

const devices = await getDevices();
await subscribeWebhook(devices[0].id, "https://your-vps-domain/rachio-webhook", [
  RACHIO_EVENT_TYPES.DEVICE_STATUS,
  RACHIO_EVENT_TYPES.ZONE_STATUS,
  RACHIO_EVENT_TYPES.RAIN_DELAY,
  RACHIO_EVENT_TYPES.SCHEDULE_STATUS,
  RACHIO_EVENT_TYPES.RAIN_SENSOR_DETECTION,
]);
```

Or run it as a one-liner:
```bash
bun -e "
import { loadEnv } from './src/lib/env';
await loadEnv();
import { getDevices, subscribeWebhook, RACHIO_EVENT_TYPES as E } from './src/lib/rachio';
const devices = await getDevices();
await subscribeWebhook(devices[0].id, 'https://YOUR_VPS/rachio-webhook', [E.DEVICE_STATUS, E.ZONE_STATUS, E.RAIN_DELAY, E.SCHEDULE_STATUS, E.RAIN_SENSOR_DETECTION]);
console.log('Webhook registered.');
"
```

### Step 4 — Deploy to VPS

Push the changes to GitHub — your VPS will auto-deploy and pick up `RACHIO_API_KEY` and `RACHIO_WEBHOOK_SECRET` from the VPS `.env`.

---

## How It Works

Intent parsing uses simple regex — no LLM. When your message matches an irrigation keyword (`rachio`, `irrigation`, `sprinkler`, `water the`, `run zone`, `stop watering`, `rain delay`, etc.), the bot handles it directly and replies immediately, bypassing Claude entirely.

This keeps responses fast and reliable. The known issue with Claude's subprocess — where it uses WebSearch even when told not to — doesn't apply here because the message never reaches Claude.

---

## How the Data Flows

```
Your Telegram message: "water front yard for 15 min"
    ↓
bot.ts — keyword intercept detects "water ... for ... min"
    ↓
handleRachioCommand() — regex matches zone run intent
    ↓
rachio.ts — PUT https://api.rach.io/1/public/zone/start
    ↓
Rachio Cloud → your controller → valve opens
    ↓
bot replies: "💧 Zone 3 (Front Yard) running for 15 min. Estimated finish: 2:47 PM."
```

```
Rachio controller event: zone completed
    ↓
Rachio Cloud — POST https://your-vps/rachio-webhook
    ↓
vps-gateway.ts — HMAC-SHA256 signature verified
    ↓
event mapped to message: "💧 Zone "Front Yard" finished (15 min)."
    ↓
Telegram API → your chat
```

**What never happens:**

- Your Rachio credentials are never sent to Claude or Anthropic
- Zone run commands go directly to the Rachio API — Claude is not involved
- Webhook payloads are verified and discarded after notification — not stored
- The bot does not poll Rachio on a schedule (webhook-driven + 60s query cache)

---

## Privacy

**Endpoint security:** The `/rachio-webhook` endpoint verifies an HMAC-SHA256 signature on every request when `RACHIO_WEBHOOK_SECRET` is set. Requests with invalid or missing signatures are rejected with HTTP 401.

**No credential storage:** `RACHIO_API_KEY` lives only in your `.env` file on your own machines. It is never logged, stored in Convex, or sent to any service other than `api.rach.io`.

**Minimal data retention:** Webhook payloads are processed in memory and discarded after the Telegram notification is sent. No irrigation data is written to disk or stored in the database.

**Rate limit awareness:** The Rachio API allows 1,700 calls/day. Status queries are cached for 60 seconds, and webhook events eliminate the need to poll for state changes. The bot logs a warning when fewer than 100 calls remain.

**Rachio's privacy policy:** [rachio.com/privacy-policy](https://rachio.com/privacy-policy)

---

## Updating

```bash
gobot-tools update rachio
```
