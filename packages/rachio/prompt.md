# Rachio Irrigation Integration

> **For Claude Code:** Drop this file into your project root or paste it into a Claude Code session. When you're ready, say: **"Set up Rachio irrigation integration"**

Connect your Claudebot to your [Rachio](https://rachio.com) smart irrigation controller. Once set up, you can control watering, manage schedules, and get push notifications via Telegram — all in natural language.

---

## What This Installs

| File | Purpose |
|------|---------|
| `src/lib/rachio.ts` | Rachio REST API wrapper with caching and zone lookup |
| `src/bot.ts` (modified) | Keyword intercept — handles irrigation commands before Claude |
| `src/vps-gateway.ts` (modified) | `POST /rachio-webhook` endpoint for push notifications |
| `src/morning-briefing.ts` (modified) | Irrigation status section in daily briefing |

---

## Prerequisites

- A Rachio controller (any generation) connected and online
- A Rachio account — API access available to all users
- Bot running in hybrid or VPS mode for push notifications (local-only works for commands)

---

## Step 1 — Get Your Rachio API Key

1. Open [app.rach.io](https://app.rach.io) → **Account** (top right) → **API Access**
2. Copy your API key (looks like: `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`)

**Add to your `.env`:**
```
RACHIO_API_KEY=your_api_key_here
```

Once this is set, restart the bot — basic zone control and status queries work immediately.

---

## Step 2 — Install `src/lib/rachio.ts`

Copy `.gobot-tools/rachio/src/rachio.ts` to `src/lib/rachio.ts`.

---

## Step 3 — Add Keyword Intercept to `src/bot.ts`

Add the Rachio import near the other lib imports:

```ts
import {
  isRachioEnabled,
  getDevices,
  getDeviceStatus,
  startZone,
  stopAllWatering,
  setRainDelay,
  startSchedule,
  skipSchedule,
  getSchedules,
  setSeasonalAdjustment,
  findZone,
  formatFinishTime,
  formatDeviceStatus,
} from "./lib/rachio";
```

Add the `handleRachioCommand` function before `handleTextMessage`:

```ts
async function handleRachioCommand(text: string, lowerText: string): Promise<string> {
  const devices = await getDevices();
  if (!devices.length) return "⚠️ No Rachio devices found.";
  const device = devices[0];

  // stop watering
  if (/\b(stop|off|cancel)\b.*\b(water|watering|zone|all)\b|\bstop all\b/i.test(text)) {
    await stopAllWatering(device.id);
    return "✅ All watering stopped.";
  }

  // rain delay: "rain delay 2 days" / "rain delay 24 hours"
  const rainDelayMatch = text.match(/rain delay\s+(\d+)\s*(day|hour|hr)s?/i);
  if (rainDelayMatch) {
    const amount = parseInt(rainDelayMatch[1]);
    const unit = rainDelayMatch[2].toLowerCase();
    const seconds = unit.startsWith("h") ? amount * 3600 : amount * 86400;
    await setRainDelay(device.id, seconds);
    const resumeDate = new Date(Date.now() + seconds * 1000);
    const resumeStr = resumeDate.toLocaleDateString("en-US", {
      weekday: "long",
      timeZone: process.env.USER_TIMEZONE || "UTC",
    });
    return `🌧 Rain delay set: ${amount} ${unit}(s) (resumes ${resumeStr}).`;
  }

  // skip watering
  if (/\bskip\b.*\b(water|schedule|watering)\b/i.test(text)) {
    const schedules = await getSchedules(device.id);
    const active = schedules.find((s) => s.enabled);
    if (!active) return "No active schedules to skip.";
    await skipSchedule(active.id);
    return `⏭ Skipped: "${active.name}".`;
  }

  // run schedule / run all zones
  if (/\b(run|start)\b.*\b(all zones|schedule|all)\b/i.test(text)) {
    const schedules = await getSchedules(device.id);
    const active = schedules.find((s) => s.enabled);
    if (!active) return "No enabled schedule found.";
    await startSchedule(active.id);
    return `💧 Schedule "${active.name}" started.`;
  }

  // water/run zone: "water front yard for 15 min" / "run zone 3 10 minutes"
  const zoneRunMatch = text.match(
    /(?:water|run|start)\s+(.+?)\s+(?:for\s+)?(\d+)\s*(min(?:ute)?s?|hour?s?)/i
  );
  if (zoneRunMatch) {
    const zoneQuery = zoneRunMatch[1].trim();
    const amount = parseInt(zoneRunMatch[2]);
    const unit = zoneRunMatch[3].toLowerCase();
    const seconds = unit.startsWith("h") ? amount * 3600 : amount * 60;
    const zone = findZone(devices, zoneQuery);
    if (!zone) return `⚠️ Couldn't find zone matching "${zoneQuery}". Try "zone 1", "front yard", etc.`;
    await startZone(zone.id, seconds);
    const finish = formatFinishTime(seconds);
    return `💧 Zone ${zone.zoneNumber} (${zone.name}) running for ${amount} ${unit.startsWith("h") ? "hour(s)" : "min"}.\nEstimated finish: ${finish}.`;
  }

  // reduce/adjust watering: "reduce watering 20%"
  const adjustMatch = text.match(/(?:reduce|increase|adjust)\s+watering\s+(\d+)%/i);
  if (adjustMatch) {
    const pct = parseInt(adjustMatch[1]);
    const isReduce = /reduce/i.test(text);
    const schedules = await getSchedules(device.id);
    const active = schedules.find((s) => s.enabled);
    if (!active) return "No enabled schedule to adjust.";
    await setSeasonalAdjustment(active.id, isReduce ? -pct : pct);
    return `✅ Seasonal adjustment set to ${isReduce ? "-" : "+"}${pct}% for "${active.name}".`;
  }

  // watering schedule / next watering
  if (/\b(schedule|next water|when.*water)\b/i.test(text)) {
    const schedules = await getSchedules(device.id);
    if (!schedules.length) return "No schedules found.";
    const lines = schedules
      .filter((s) => s.enabled)
      .slice(0, 3)
      .map((s) => {
        const startHour = s.startTime
          ? new Date(s.startTime).toLocaleTimeString("en-US", {
              hour: "numeric",
              minute: "2-digit",
              hour12: true,
              timeZone: process.env.USER_TIMEZONE || "UTC",
            })
          : "scheduled";
        const totalMin = s.totalDuration ? Math.round(s.totalDuration / 60) : "?";
        return `• *${s.name}* — ${startHour} (~${totalMin} min)`;
      });
    if (!lines.length) return "No enabled schedules.";
    return `📅 *Watering Schedules*\n${lines.join("\n")}`;
  }

  // default: device status
  const status = await getDeviceStatus(device.id);
  return formatDeviceStatus(status);
}
```

Add the intercept block inside `handleTextMessage`, after the weather intercept and before calendar:

```ts
// ----- Rachio Irrigation -----
if (isRachioEnabled()) {
  const rachioKeywords =
    /\b(rachio|irrigation|sprinkler|water the|run zone|stop watering|rain delay|skip watering|watering schedule|zone status|is it watering)\b/i;

  if (rachioKeywords.test(text) || lowerText === "/rachio") {
    const typing = createTypingIndicator(ctx);
    typing.start();
    try {
      const reply = await handleRachioCommand(text, lowerText);
      await ctx.reply(reply, { parse_mode: "Markdown" }).catch(() => ctx.reply(reply));
    } catch (err: any) {
      console.error("Rachio error:", err);
      await ctx.reply(`⚠️ Rachio error: ${err.message}`);
    } finally {
      typing.stop();
    }
    return;
  }
}
```

---

## Step 4 — Add Webhook Handler to `src/vps-gateway.ts`

Add this block before the Telegram webhook handler (`if (url.pathname === "/telegram")`):

```ts
// Rachio irrigation webhook
if (url.pathname === "/rachio-webhook" && req.method === "POST") {
  const webhookSecret = process.env.RACHIO_WEBHOOK_SECRET;
  const body = await req.text();

  if (webhookSecret) {
    const signature = req.headers.get("X-Rachio-Hmac-SHA256") || "";
    const { createHmac, timingSafeEqual } = await import("crypto");
    const expected = createHmac("sha256", webhookSecret).update(body).digest("hex");
    const sigBuf = Buffer.from(signature);
    const expBuf = Buffer.from(expected);
    if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) {
      return new Response("Unauthorized", { status: 401 });
    }
  }

  try {
    const payload = JSON.parse(body) as {
      type?: string; subType?: string; deviceId?: string;
      summary?: string; duration?: number; zoneName?: string;
      scheduleName?: string; delay?: number;
    };
    const eventType = payload.type || "";
    const subType = payload.subType || "";
    let message: string | null = null;

    if (eventType === "ZONE_STATUS_EVENT" && (subType === "ZONE_COMPLETED" || subType === "ZONE_STOPPED")) {
      const mins = payload.duration ? Math.round(payload.duration / 60) : "?";
      message = `💧 Zone "${payload.zoneName || "zone"}" finished (${mins} min).`;
    } else if (eventType === "SCHEDULE_STATUS_EVENT" && subType === "SCHEDULE_COMPLETED") {
      const mins = payload.duration ? Math.round(payload.duration / 60) : "?";
      message = `✅ Watering schedule "${payload.scheduleName || "schedule"}" done. Total: ${mins} min.`;
    } else if (eventType === "DEVICE_STATUS_EVENT" && payload.summary?.toLowerCase().includes("offline")) {
      message = "⚠️ Rachio controller offline.";
    } else if (eventType === "RAIN_DELAY_EVENT") {
      const days = payload.delay ? Math.round(payload.delay / 86400) : "?";
      message = `🌧 Rain delay activated: ${days} day(s).`;
    } else if (eventType === "RAIN_SENSOR_DETECTION_EVENT") {
      message = subType === "RAIN_SENSOR_DETECTION_ON"
        ? "🌧 Rain sensor triggered — watering paused."
        : "☀️ Rain sensor cleared — watering resumed.";
    }

    if (message && BOT_TOKEN && ALLOWED_USER_ID) {
      await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: ALLOWED_USER_ID, text: message }),
      });
    }
  } catch (err) {
    console.error("Rachio webhook parse error:", err);
  }
  return new Response("OK", { status: 200 });
}
```

---

## Step 5 — Add Irrigation to Morning Briefing (optional)

In `src/morning-briefing.ts`, add the import:

```ts
import { isRachioEnabled, getDevices, getDeviceStatus, getSchedules } from "./lib/rachio";
```

Add to the `Promise.all` data fetch array:

```ts
isRachioEnabled()
  ? (async () => {
      const devices = await getDevices();
      if (!devices.length) return "";
      const device = devices[0];
      const [status, schedules] = await Promise.all([
        getDeviceStatus(device.id).catch(() => null),
        getSchedules(device.id).catch(() => []),
      ]);
      if (status?.status === "WATERING") return `Running now — ${device.name}`;
      const next = schedules.find((s) => s.enabled);
      if (!next) return "";
      const startTime = next.startTime
        ? new Date(next.startTime).toLocaleTimeString("en-US", {
            hour: "numeric", minute: "2-digit", hour12: true,
            timeZone: process.env.USER_TIMEZONE || "UTC",
          })
        : "scheduled";
      const totalMin = next.totalDuration ? Math.round(next.totalDuration / 60) : "?";
      return `Next run: ${startTime} (~${totalMin} min) — ${next.name}`;
    })().catch(() => "")
  : Promise.resolve(""),
```

Then add the section to the briefing string (before Goals):

```ts
if (irrigation) {
  briefing += `💧 **IRRIGATION**\n${irrigation}\n\n`;
}
```

---

## Step 6 — Register the Webhook with Rachio (for push notifications)

Run this once from your project root after setting `RACHIO_API_KEY`:

```bash
bun -e "
import './src/lib/env';
const { loadEnv } = await import('./src/lib/env');
await loadEnv();
const { getDevices, subscribeWebhook, RACHIO_EVENT_TYPES: E } = await import('./src/lib/rachio');
const devices = await getDevices();
const device = devices[0];
console.log('Device:', device.name, device.id);
await subscribeWebhook(device.id, 'https://YOUR_VPS_DOMAIN/rachio-webhook', [
  E.DEVICE_STATUS, E.ZONE_STATUS, E.RAIN_DELAY, E.SCHEDULE_STATUS, E.RAIN_SENSOR_DETECTION
]);
console.log('Webhook registered.');
"
```

Replace `YOUR_VPS_DOMAIN` with your Cloudflare tunnel domain (e.g. `vps.claudebot.uk`).

---

## Step 7 — Verify

Restart the bot, then test:

1. **Basic control:** "rachio status" → should return your device name and zones
2. **Zone run:** "water [your zone name] for 5 minutes" → zone should start
3. **Stop:** "stop watering" → all zones stop
4. **Push notification:** Let a zone finish naturally, or start a short run — you should receive a Telegram message when it completes

---

## Troubleshooting

**"No Rachio devices found"** — Check `RACHIO_API_KEY` is set and correct. Test: `curl -H "Authorization: Bearer YOUR_KEY" https://api.rach.io/1/public/person/info`

**Zone not found** — Use the zone's exact name or "zone N" format. Say "rachio status" to see your zone names and numbers.

**No push notifications** — Verify `RACHIO_WEBHOOK_SECRET` matches on both Mac and VPS. Check VPS logs: `pm2 logs claudebot`. Confirm webhook is registered by checking [app.rach.io](https://app.rach.io) → Account → Webhooks.

**Rate limit** — The API allows 1,700 calls/day. If you hit it, the bot logs a warning. Status queries are cached 60s — avoid polling manually.
