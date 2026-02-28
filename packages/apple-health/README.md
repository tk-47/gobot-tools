# Apple Watch + Health Agent

Connect your iPhone and Apple Watch to your Claudebot for real-time health data: sleep stages, HRV, resting heart rate, SpO₂, activity rings, and a computed readiness score.

No Apple API — data is pushed directly from your phone using the free **Health Auto Export** app.

Works standalone or alongside the Oura Ring integration.

---

## Requirements

- iPhone with Apple Watch (Series 4+ recommended; Series 8+ for wrist temperature)
- watchOS 9+ for sleep stage tracking (Deep, REM, Core)
- [Health Auto Export](https://apps.apple.com/us/app/health-auto-export-json-csv/id1115567069) app (free tier works)
- Your bot running with a public HTTPS URL (Cloudflare tunnel, VPS, etc.)

---

## Setup (5 minutes)

### Step 1 — Install Health Auto Export

Download from the App Store: **Health Auto Export - JSON+CSV**

### Step 2 — Generate a webhook secret

The endpoint requires a secret token on every request — it will reject anything without it.

```bash
openssl rand -hex 32
```

Add the result to your bot's `.env`:

```
APPLE_HEALTH_WEBHOOK_SECRET=your_generated_secret_here
```

### Step 3 — Configure the webhook

In Health Auto Export:
1. Tap **Automations** → **Add Automation** → **REST API**
2. Set the URL to: `https://your-bot-domain/webhook/apple-health`
3. Set method to **POST**
4. Set interval to **Hourly** (or shorter if you prefer)
5. Tap **Headers** → **Add Header**:
   - Name: `x-webhook-secret`
   - Value: your secret from Step 2
6. Select the metrics you want to share (recommended list below)

### Step 3 — Select metrics

Enable these in Health Auto Export for the best experience:

| Metric | Why |
|--------|-----|
| Heart Rate | Sleep HR, daytime trends |
| Resting Heart Rate | Recovery baseline |
| Heart Rate Variability (SDNN) | Recovery indicator |
| Sleep Analysis | Stages: Deep, REM, Core, Awake |
| Respiratory Rate | Sleep quality indicator |
| Blood Oxygen Saturation | SpO₂ during sleep |
| Step Count | Daily activity |
| Active Energy Burned | Calorie tracking |
| Exercise Time | Workout minutes |
| Stand Hour | Apple ring data |
| Body Temperature (Wrist) | Series 8+ illness/cycle tracking |
| VO2 Max | Fitness level |

### Step 4 — Install the bot integration

Claude Code will guide you through:
1. Adding `src/lib/apple-health.ts` to your bot
2. Adding the `/webhook/apple-health` endpoint to `bot.ts`
3. Updating `src/agents/health.ts` to use both Oura and/or Apple Health

Open `prompt.md` in Claude Code and say: **"Set up Apple Watch health integration"**

---

## Data Available

### Sleep
- Bedtime and wake time
- Total sleep, Deep, REM, Core (light) duration
- Sleep efficiency (% time actually asleep vs in bed)
- Average heart rate during sleep
- Average respiratory rate during sleep

### Vitals (daily)
- Resting heart rate
- HRV — SDNN (ms) with 7-day baseline comparison
- Blood oxygen (SpO₂)
- Wrist temperature deviation from baseline (Series 8+)
- VO₂ Max

### Activity
- Steps (with 7-day average)
- Active calories (with 7-day average)
- Exercise minutes
- Stand hours

### Readiness Score (computed proxy)
A 0–100 score computed from HRV, resting HR, sleep quality, and respiratory rate — similar methodology to Oura's readiness score.

---

## Using Both Oura + Apple Watch

If you have both, the Health Agent uses both sources simultaneously:
- **Sleep fallback**: Many users don't wear their Apple Watch to bed — if Apple Health has no sleep data, the agent automatically uses Oura (or any other sleep tracker) as the primary sleep source
- Compares sleep stages across both devices when both have data
- Notes that Oura uses RMSSD for HRV while Apple Watch uses SDNN (different algorithms)
- Uses the native Oura readiness score when available; falls back to the computed proxy for Apple-only users
- Prefers Apple Watch for activity data (steps, exercise, stand hours); prefers Oura for sleep and recovery
- Pulls from whichever source has more complete data for any given metric

---

## Privacy

- Health Auto Export sends data directly from your phone to your bot's webhook
- Data is stored locally in `./data/apple-health.json` — on your machine or VPS, not any third-party server
- No Apple ID, iCloud credentials, or OAuth flow required
- Health Auto Export's privacy policy: they do not transmit your health data to their servers
