# Apple Watch + Health Agent Setup

You are helping the user integrate Apple Watch health data into their Claudebot.
Data flows from the iPhone via the Health Auto Export app to a webhook on the bot.
Follow these steps in order.

---

## Step 1 — Check existing setup

Read the current state of the project:
- Check if `src/lib/oura.ts` exists (user may already have Oura integration)
- Check if `src/lib/apple-health.ts` exists (already installed?)
- Check if the bot has a public HTTPS URL configured (ask the user if not obvious)

Tell the user what you found and what you'll be adding.

---

## Step 2 — Install the library

Copy `src/apple-health.ts` from this package into the bot's `src/lib/apple-health.ts`.

This file handles:
- Receiving and parsing Health Auto Export webhook payloads
- Aggregating raw HealthKit samples into clean daily snapshots
- Computing a readiness proxy score (HRV + resting HR + sleep + respiratory rate)
- Storing up to 14 days of data in `./data/apple-health.json`
- Query functions for the health agent CLI

---

## Step 3 — Add the webhook endpoint to bot.ts

In `src/bot.ts`, add the import at the top (near other lib imports):

```typescript
import { storeAppleHealthData, type HaePayload } from "./lib/apple-health";
```

Then add this endpoint inside the `handleHttpRequest` function,
alongside the existing webhook handlers (Fireflies, etc.):

```typescript
// Apple Health webhook (Health Auto Export iOS app → pushes HealthKit data)
if (url.pathname === "/webhook/apple-health" && req.method === "POST") {
  try {
    const payload = (await req.json()) as HaePayload;
    await storeAppleHealthData(payload);
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("[apple-health] Webhook error:", err.message);
    return new Response(JSON.stringify({ ok: false, error: err.message }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }
}
```

---

## Step 4 — Add the CLI tool

Copy this file to `src/tools/apple-health-cli.ts`:

```typescript
#!/usr/bin/env bun
/**
 * Apple Health CLI — Health data from iPhone + Apple Watch via Health Auto Export.
 *
 * Usage:
 *   bun run src/tools/apple-health-cli.ts summary
 *   bun run src/tools/apple-health-cli.ts sleep [DATE]
 *   bun run src/tools/apple-health-cli.ts vitals [DATE]
 *   bun run src/tools/apple-health-cli.ts activity [DATE]
 */

import { join } from "path";
import { existsSync, readFileSync } from "fs";

const PROJECT_ROOT = process.env.GO_PROJECT_ROOT || join(import.meta.dir, "../..");
const envPath = join(PROJECT_ROOT, ".env");
if (existsSync(envPath)) {
  readFileSync(envPath, "utf-8")
    .split("\n")
    .forEach((line) => {
      const [key, ...valueParts] = line.split("=");
      if (key && valueParts.length > 0 && !key.trim().startsWith("#")) {
        process.env[key.trim()] = valueParts.join("=").trim();
      }
    });
}

import {
  getAppleHealthSummary,
  getDetailedSleep,
  getVitalsDetail,
  getActivityDetail,
  isAppleHealthEnabled,
} from "../lib/apple-health";

const [command, ...args] = process.argv.slice(2);

if (!isAppleHealthEnabled() && command !== "help" && command !== undefined) {
  console.error(
    "Apple Health data not available.\n" +
    "Set up Health Auto Export on your iPhone to push data to /webhook/apple-health."
  );
  process.exit(1);
}

try {
  switch (command) {
    case "summary":   console.log(await getAppleHealthSummary()); break;
    case "sleep":     console.log(await getDetailedSleep(args[0])); break;
    case "vitals":    console.log(await getVitalsDetail(args[0])); break;
    case "activity":  console.log(await getActivityDetail(args[0])); break;
    default: console.log(`Apple Health CLI\n\nCommands:\n  summary   vitals [DATE]   sleep [DATE]   activity [DATE]`);
  }
} catch (err: any) {
  console.error(`Error: ${err.message}`);
  process.exit(1);
}
```

---

## Step 5 — Update the Health Agent

Update `src/agents/health.ts` to support both Oura and Apple Watch.

The updated agent should:
1. Import `isOuraEnabled` from `../lib/oura` and `isAppleHealthEnabled` from `../lib/apple-health`
2. Dynamically build the DATA ACCESS section based on which sources are active
3. If only Oura: list Oura CLI commands
4. If only Apple Watch: list apple-health CLI commands
5. If both: list both, and instruct Claude to pull from both and compare

The SCORE INTERPRETATION section should note that Apple Watch readiness is a computed proxy
(HRV + resting HR + sleep + respiratory rate) using the same 0-100 scale as Oura.

---

## Step 6 — Verify the webhook

After restarting the bot, tell the user to open Health Auto Export on their iPhone and tap
**Export Now** / **Send** to trigger an immediate push. Then run:

```bash
bun run src/tools/apple-health-cli.ts summary
```

If data appears, the integration is working.

---

## Step 7 — Add to .env (required)

Add the webhook secret to `.env`. The endpoint is disabled without it — any request
missing the correct header is rejected with 401.

Generate a secret if the user hasn't already:
```bash
openssl rand -hex 32
```

Add to `.env`:
```
APPLE_HEALTH_WEBHOOK_SECRET=their_generated_secret_here
```

Tell the user to add a matching header in Health Auto Export:
- Automation → their webhook → Headers → `x-webhook-secret: <same secret>`

Also add timezone if not already set:
```
USER_TIMEZONE=America/Chicago
```

---

## Troubleshooting

**"No Apple Health data available"**
- Confirm Health Auto Export has fired at least once (check the app's history/log)
- Verify the webhook URL is correct and reachable from the phone
- Check bot logs for `[apple-health]` entries

**Sleep data missing**
- Apple Watch must be worn to bed and charging only after sleep ends
- Sleep tracking must be enabled in iPhone Health app → Sleep
- watchOS 9+ required for stage tracking (Deep/REM/Core)

**HRV data sparse or missing**
- Apple Watch records HRV during sleep and in the morning
- Enable Background App Refresh for Health Auto Export
- HRV may take a few weeks to establish a baseline

**Wrist temperature always shows "—"**
- Temperature delta requires Apple Watch Series 8 or Ultra
- Must be worn consistently (including overnight) for at least 5 nights to establish baseline
