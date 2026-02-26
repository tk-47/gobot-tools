# Oura Ring + Health Agent Integration

> **For Claude Code:** Drop this file into your project root or paste it into a Claude Code session. Claude will walk you through each step interactively. When you're ready, say: **"Set up Oura Ring integration"**

Connect your Telegram bot to an [Oura Ring](https://ouraring.com/) and add a dedicated Health Agent to the board. Once set up, the bot can:

- Report sleep scores, readiness, activity, and stress levels from your ring
- Show detailed sleep breakdowns — stages, HRV, heart rate, breathing rate
- Include health data in daily morning briefings and smart check-ins
- Look up medications — uses, side effects, dosage, drug interactions
- Check symptoms — possible causes, when to see a doctor, home care options
- Interpret lab results — what blood work numbers mean in context
- Answer general wellness questions — nutrition, supplements, exercise, fasting

---

## How It Works

This integration has two parts: a **data layer** (Oura API client + CLI tool) and a **reasoning layer** (Health Agent on the board).

### Data Layer

The bot calls the [Oura API v2](https://cloud.ouraring.com/v2/docs) directly via HTTP using a Personal Access Token. No OAuth flow, no MCP server, no web search — just direct REST calls to your ring's cloud data.

```
Morning Briefing (scheduled, direct API)
  │
  └── getOuraSummary() — src/lib/oura.ts
        └── GET api.ouraring.com/v2/usercollection/daily_sleep
        └── GET api.ouraring.com/v2/usercollection/daily_readiness
        └── GET api.ouraring.com/v2/usercollection/daily_activity
        └── GET api.ouraring.com/v2/usercollection/daily_stress
        └── Formatted summary appears in briefing:
              "💍 HEALTH (Oura)
               Sleep: 76/100
                 ⚠ Low: deep sleep 21, efficiency 58
               Readiness: 81/100
                 Body temp: +0.2°C from baseline
               Activity: 2,579 steps | 169 active cal"

Smart Check-in (scheduled, context injection)
  │
  └── getOuraSummary() injected into Claude's decision prompt
        └── Claude factors health into tone and recommendations
        └── e.g., "You didn't sleep great — maybe take it easy today"

On-Demand Query (user asks via Telegram)
  │
  └── Orchestrator detects health topic → routes to Health Agent
        └── Health Agent calls: bun run src/tools/oura-cli.ts sleep
        └── Returns detailed report with stages, HR, HRV
        └── Formats response with status, key numbers, recommendations
```

### Reasoning Layer — The Health Agent

The Health Agent is a board member that handles three categories of questions:

| Category | How It Works | Example Questions |
|----------|-------------|-------------------|
| **Biometrics** | Pulls real data from Oura Ring via CLI | "How did I sleep?", "What's my readiness?", "Show me my sleep trend this week" |
| **Medical reference** | Uses web search for current drug/symptom info | "What are the side effects of metformin?", "Can I take ibuprofen with lisinopril?", "What does a low white blood cell count mean?" |
| **Wellness** | General health knowledge + ring context | "Should I work out today?", "Best foods for sleep?", "How does fasting affect HRV?" |

The orchestrator auto-detects health-related messages and routes them to the Health Agent. Trigger keywords include: sleep, readiness, HRV, heart rate, recovery, tired, exhausted, energy, stress, oura, medication, medicine, drug, side effects, symptoms, dosage, prescription, supplement, vitamin, lab results, blood work, pain, sick, and more.

**Important:** The Health Agent always includes a disclaimer on medical questions — it provides information, not diagnoses, and recommends talking to a doctor for anything actionable.

---

## Prerequisites

- An [Oura Ring](https://ouraring.com/) (Gen 2 or Gen 3) synced to the Oura app
- An Oura account (the one linked to your ring)
- [Bun](https://bun.sh/) runtime installed

---

## Step 1: Create a Personal Access Token

### What you need to do:

1. Go to [cloud.ouraring.com](https://cloud.ouraring.com/) and sign in with your Oura account
2. Navigate to **Personal Access Tokens** ([cloud.ouraring.com/personal-access-tokens](https://cloud.ouraring.com/personal-access-tokens))
3. Click **Create New Personal Access Token**
4. Give it a name like "Claudebot"
5. Copy the token — it's a long alphanumeric string like `ABCDEFGHIJKLMNOPQRSTUVWXYZ123456`

The token gives read access to all your ring data. No scopes to configure.

### Tell Claude Code:
"Here's my Oura access token: [TOKEN]"

---

## Step 2: Add to Environment

### What Claude Code does:
- Adds `OURA_ACCESS_TOKEN` to your `.env` file

```env
# Oura Ring
OURA_ACCESS_TOKEN=your-personal-access-token
```

### Tell Claude Code:
"Add the Oura token to .env"

---

## Step 3: Create the Oura API Client

### What Claude Code does:
- Creates `src/lib/oura.ts` — direct REST client for the Oura API v2
- Creates `src/tools/oura-cli.ts` — CLI wrapper for Claude subprocess access
- Adds `OURA_ACCESS_TOKEN` placeholder to `.env.example`

The client exports these functions:

| Function | Purpose |
|----------|---------|
| `isOuraEnabled()` | Check if Oura integration is configured |
| `getOuraSummary()` | Compact summary of sleep, readiness, activity, stress — used by morning briefing and smart check-in |
| `getDetailedSleep(date?)` | Full sleep report with stages, HR, HRV, breathing, contributors |
| `getReadinessDetail(date?)` | Readiness breakdown with all contributor scores |
| `getActivityDetail(date?)` | Activity breakdown with steps, calories, time splits |

### Tell Claude Code:
"Create the Oura API client and CLI tool"

---

## Step 4: Wire Into Morning Briefing & Smart Check-in

### What Claude Code does:
- Adds Oura summary to `src/morning-briefing.ts` — appears between weather and Orthodox calendar
- Adds Oura data to `src/smart-checkin.ts` — injected into Claude's decision context
- Adds Oura CLI instructions to `BASE_CONTEXT` in `src/agents/base.ts`

### Tell Claude Code:
"Wire Oura into the morning briefing and smart check-in"

---

## Step 5: Create the Health Agent

### What Claude Code does:
- Creates `src/agents/health.ts` — the Health Agent board member
- Registers it in `src/agents/base.ts` (aliases: `health`, `wellness`, `nurse`)
- Adds it to `src/agents/index.ts` exports and quick reference
- Adds Health to the orchestrator's classification table and specialist personas in `src/agents/general.ts`
- Adds Health to the cross-agent invocation map (General can consult Health, Health can consult Research)

The Health Agent uses **Chain of Thought (CoT) reasoning** with three response formats depending on the question type:

**For biometric reports:**
- **Status** — quick overall assessment
- **Key Numbers** — 3-5 metrics with plain-English context
- **Pattern** — trends (improving, declining, inconsistent)
- **Action Items** — 1-3 specific recommendations
- **Watch For** — what to monitor next

**For medication questions:**
- **What it is** — drug class and primary use
- **Key facts** — dosage range, mechanism, onset time
- **Side effects** — common and serious
- **Interactions** — drug/food interactions to know about
- **Source** — where the info came from

**For symptom questions:**
- **Possible causes** — most likely to less likely
- **When to see a doctor** — clear urgency guidance
- **In the meantime** — safe home care options

### Tell Claude Code:
"Create the Health Agent and add it to the board"

---

## Step 6: Verify Everything

### What Claude Code does:
- Tests the Oura CLI
- Verifies the Health Agent loads correctly
- Confirms the orchestrator routes health messages

```bash
# Test Oura CLI
bun run src/tools/oura-cli.ts summary

# Test Health Agent loads
bun --eval "
import { getAgentConfig } from './src/agents/base';
const h = getAgentConfig('health');
console.log(h?.name, '- loaded');
"
```

### How to test:
Send these messages to your bot on Telegram:
- "How did I sleep last night?" — should pull Oura data and give a detailed report
- "What's my readiness score?" — should show readiness with contributors
- "What are the side effects of ibuprofen?" — should search and summarize
- "I have a headache and stiff neck, what could it be?" — should list causes and when to seek care

### Tell Claude Code:
"Test the Oura Ring and Health Agent integration"

---

## What Data Is Available

### Daily Summary (via `oura-cli.ts summary`)

| Field | Example |
|-------|---------|
| Sleep score | 76/100 |
| Low sleep contributors | deep sleep 21, efficiency 58 |
| Readiness score | 81/100 |
| Body temperature deviation | +0.2°C from baseline |
| Low readiness contributors | sleep balance 70 |
| Activity (steps + calories) | 2,579 steps \| 169 active cal |
| Stress summary | restored, normal, or stressful |

### Detailed Sleep (via `oura-cli.ts sleep`)

| Field | Example |
|-------|---------|
| Sleep score | 76/100 |
| Bedtime | 10:41 PM → 9:27 AM |
| Total sleep | 7h 56m |
| Deep sleep | 14m |
| REM sleep | 1h 39m |
| Light sleep | 6h 4m |
| Awake time | 2h 49m |
| Efficiency | 74% |
| Sleep latency | 9m |
| Avg heart rate | 60 bpm |
| Lowest heart rate | 55 bpm |
| Avg HRV | 29 ms |
| Avg breathing rate | 16 breaths/min |
| Contributors breakdown | deep sleep 21, efficiency 58, latency 83, rem sleep 95, restfulness 60, timing 77, total sleep 96 |

### Readiness (via `oura-cli.ts readiness`)

| Field | Example |
|-------|---------|
| Readiness score | 81/100 |
| Body temp deviation | +0.19°C |
| Body temperature | 89/100 |
| HRV balance | 82/100 |
| Previous night | 75/100 |
| Recovery index | 100/100 |
| Resting heart rate | 78/100 |
| Sleep balance | 70/100 |
| Sleep regularity | 83/100 |

### Activity (via `oura-cli.ts activity`)

| Field | Example |
|-------|---------|
| Activity score | (available when day completes) |
| Steps | 2,579 |
| Active calories | 169 / 450 target |
| Total calories | 2,384 |
| Walking distance | 2.5 km |
| High activity | 0m |
| Medium activity | 7m |
| Low activity | 2h 57m |
| Sedentary time | 14h 48m |
| Distance to target | 5.3 km |

---

## Where Health Data Appears

| Context | What's Included |
|---------|----------------|
| **Morning briefing** | Sleep score, readiness score, activity summary, stress level — appears between weather and Orthodox calendar |
| **Smart check-in** | Full Oura summary injected into Claude's decision context — Claude adapts tone based on sleep quality and readiness |
| **Health Agent (on-demand)** | Detailed biometric reports, medication lookups, symptom checking, wellness guidance — triggered by health-related messages in DMs or General topic |
| **Board meetings** | Health Agent contributes a wellness perspective when the orchestrator runs a full board meeting |

---

## CLI Reference

The Claude subprocess (and you manually) can query Oura data via:

```bash
# Today's scores (sleep, readiness, activity, stress)
bun run src/tools/oura-cli.ts summary

# Detailed sleep report (most recent, or specific date)
bun run src/tools/oura-cli.ts sleep
bun run src/tools/oura-cli.ts sleep 2025-02-14

# Readiness breakdown with all contributors
bun run src/tools/oura-cli.ts readiness
bun run src/tools/oura-cli.ts readiness 2025-02-14

# Activity breakdown with steps, calories, time splits
bun run src/tools/oura-cli.ts activity
bun run src/tools/oura-cli.ts activity 2025-02-14
```

All commands use a 3-day lookback window by default, so if your ring hasn't synced today, it returns the most recent data available.

---

## Customization

### Lookback Window

By default, the bot looks back 3 days to find the most recent data (Oura data can lag if the ring hasn't synced). To change this, edit the default in `src/lib/oura.ts`:

```typescript
// In getOuraSummary():
const { start, end } = getDateRange(3);  // Change 3 to desired days
```

### Timezone

Sleep times and date calculations use `USER_TIMEZONE` from your `.env`. Make sure it's set:

```env
USER_TIMEZONE=America/Chicago
```

### Health Agent Personality

Edit the system prompt in `src/agents/health.ts` to adjust:
- **Tone**: The `personality` field controls the agent's voice (default: "caring, evidence-based, practical, encouraging")
- **Expertise areas**: Add or remove sections under `YOUR EXPERTISE`
- **Output format**: Modify the structured response templates
- **Constraints**: Adjust the medical disclaimer behavior

### Orchestrator Routing

To add or remove keywords that trigger the Health Agent, edit the classification table in `src/agents/general.ts`:

```typescript
| Health | sleep, readiness, HRV, ... your keywords here ... | Health Agent / Wellness Advisor (CoT) |
```

---

## VPS Setup

No extra setup needed — just add the same env var to your VPS `.env`:

```env
OURA_ACCESS_TOKEN=your-personal-access-token
```

The Oura API is a public REST endpoint authenticated by Bearer token. No OAuth refresh, no expiration (personal access tokens don't expire unless revoked). Works identically on local and VPS.

The Health Agent code deploys automatically with the rest of the bot — no additional VPS configuration needed.

---

## Architecture

### New Files

| File | Purpose |
|------|---------|
| `src/lib/oura.ts` | Direct REST client for Oura API v2 — `isOuraEnabled()`, `getOuraSummary()`, `getDetailedSleep()`, `getReadinessDetail()`, `getActivityDetail()` |
| `src/tools/oura-cli.ts` | CLI wrapper so the Claude subprocess can query health data on demand |
| `src/agents/health.ts` | Health Agent board member — CoT reasoning, biometric interpretation, medical reference, wellness guidance |

### Modified Files

| File | Changes |
|------|---------|
| `.env` / `.env.example` | Added `OURA_ACCESS_TOKEN` |
| `src/morning-briefing.ts` | Oura health section between weather and Orthodox calendar |
| `src/smart-checkin.ts` | Oura data injected into Claude's decision context |
| `src/agents/base.ts` | `BASE_CONTEXT` updated with Oura CLI instructions; Health Agent registered with aliases (`health`, `wellness`, `nurse`); added to cross-agent invocation map |
| `src/agents/index.ts` | Health Agent exported and added to quick reference |
| `src/agents/general.ts` | Health row in classification table; Health persona in specialist list; Health in cross-agent consultation |

---

## Troubleshooting

| Problem | Solution |
|---------|----------|
| "OURA_ACCESS_TOKEN must be set" | Check that the env var is in your `.env` file |
| "Oura API error: 401" | Token is invalid or revoked — create a new one at cloud.ouraring.com/personal-access-tokens |
| "No Oura data available — ring may not have synced yet" | Open the Oura app on your phone and let it sync. Data can lag hours behind |
| Sleep data is from 2-3 days ago | The ring needs to sync via Bluetooth to the Oura app, which then uploads to the cloud. The 3-day lookback handles this gracefully |
| Activity score shows null | Activity scores are only calculated after the day completes — check the next day |
| Stress shows null | Stress tracking requires Oura Gen 3 and may not be available on all plans |
| Wrong sleep times displayed | Check `USER_TIMEZONE` in `.env` — sleep times are converted from UTC using this |
| Bot doesn't answer "How did I sleep?" | Verify the Health Agent is registered in `src/agents/base.ts` and the classification table in `src/agents/general.ts` includes Health triggers |
| Health questions go to General instead of Health Agent | The keyword didn't match the classification table. Add your keyword to the Health row in `src/agents/general.ts` |
| Medication lookup returns no info | The Claude subprocess needs web search access. Verify Claude Code CLI is authenticated (`claude --version`) |

---

## API Reference

The bot uses the [Oura API v2](https://cloud.ouraring.com/v2/docs) with these endpoints:

```
GET https://api.ouraring.com/v2/usercollection/daily_sleep
GET https://api.ouraring.com/v2/usercollection/daily_readiness
GET https://api.ouraring.com/v2/usercollection/daily_activity
GET https://api.ouraring.com/v2/usercollection/daily_stress
GET https://api.ouraring.com/v2/usercollection/sleep

Headers:
  Authorization: Bearer YOUR_PERSONAL_ACCESS_TOKEN

Query params:
  start_date=YYYY-MM-DD
  end_date=YYYY-MM-DD
```

All endpoints return `{ data: [...], next_token: null }`. The bot fetches 3 days of data and takes the most recent entry. No documented rate limits for personal access tokens.

---

## References

- [Oura Ring](https://ouraring.com/) — The hardware
- [Oura API v2 Documentation](https://cloud.ouraring.com/v2/docs) — REST API docs
- [Oura Developer Portal](https://cloud.ouraring.com/) — Token management and app registration
- [@pinta365/oura-api](https://jsr.io/@pinta365/oura-api) — TypeScript library reference (useful for type definitions)
