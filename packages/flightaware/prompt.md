# FlightAware Flight Tracking Integration

> **For Claude Code:** Drop this file into your project root or paste it into a Claude Code session. Claude will walk you through each step interactively. When you're ready, say: **"Set up FlightAware flight tracking"**

Connect your Telegram bot to [FlightAware AeroAPI](https://www.flightaware.com/aeroapi/) for real-time flight tracking. Once set up, the bot can:

- Look up any commercial flight's status, gates, terminals, delays, and aircraft info
- Track flights with hourly polling and proactive Telegram notifications when something changes
- Show tracked flight status in your daily morning briefing
- Handle natural language — "what's the status of flight AA1234?" shows confirmation buttons before calling the API
- Work on both Telegram and the web voice interface

---

## How It Works

The bot calls the [FlightAware AeroAPI v4](https://www.flightaware.com/aeroapi/portal/documentation) directly via HTTP. No MCP server, no web search — just direct REST calls to FlightAware's flight data.

There are two modes: **one-time lookup** and **active tracking**.

### One-Time Lookup

```
User: /flight AA1234
  │
  └── bot.ts detects /flight slash command
        └── getFlightStatus("AA1234") — src/lib/flightaware.ts
              └── GET aeroapi.flightaware.com/aeroapi/flights/AA1234
              └── returns formatted status:
                    "✈️ AA1234: En Route
                     Dallas (DFW) → Miami (MIA)

                     Departed: 2:15 PM
                     DFW: Terminal A, Gate A22
                     Est. arrival: 5:48 PM (12m late)
                     MIA: Terminal N, Gate D8, Baggage 5
                     Progress: 67%
                     Aircraft: B738 (N860NN)"
```

The `/flight` command bypasses Claude entirely — direct API call, instant response. Works on both the local Mac bot and VPS gateway.

### Active Tracking

```
User: /flight track AA1234
  │
  └── bot.ts adds flight to tracker — src/lib/flight-tracker.ts
        └── Initial status check: getFlightStatus("AA1234")
        └── Stores: status, gates, ETA, delay
        └── Reply: "Now tracking AA1234. You'll get updates on changes."

  setInterval (every 60 minutes):
  │
  └── pollTrackedFlights()
        └── For each tracked flight:
              └── getFlightStatus(ident)
              └── Compare status, gates, ETA, delay against stored values
              └── If anything changed → send Telegram notification:
                    "✈️ Flight Update: AA1234
                     • Status: En Route → Landed
                     • New ETA: 5:52 PM
                     [Stop tracking AA1234]"  ← inline button

  Auto-cleanup:
  └── Remove after: arrived, cancelled, or 24h past departure
```

Only the Mac bot runs the polling loop. The VPS handles `/flight` lookups directly but does not poll, preventing duplicate notifications in hybrid mode.

### Natural Language (with confirmation)

```
User: "What's the status of flight UA456?"
  │
  └── bot.ts detects flight keyword + parses "UA456"
        └── Shows inline buttons:
              [Check UA456 status] [Track UA456] [Skip]
        └── User taps "Check UA456 status"
              └── API call → formatted reply

User: "Stop tracking AA1234"
  │
  └── bot.ts detects "stop tracking" + parses "AA1234"
        └── Immediate stop — no confirmation needed
```

The confirmation buttons prevent accidental API charges from casual conversation. Stopping is always immediate.

---

## Estimated Monthly Cost

**FlightAware Personal plan:** $0/month minimum, $5/month usage credit (no out-of-pocket cost unless you exceed $5).

### Endpoint Pricing

| Endpoint | Cost per Call | Used For |
|----------|-------------|----------|
| `GET /flights/{ident}` | $0.005 | Flight status (the primary endpoint) |
| `GET /flights/{id}/position` | $0.010 | Current lat/lon/alt/speed (CLI only, in-flight) |
| `GET /flights/{id}/track` | $0.012 | Full flight track with positions (not used) |
| `GET /flights/{id}/map` | $0.030 | Map image (not used — too expensive for text bot) |
| Foresight predictive endpoints | $0.015–$0.060 | Not used — premium tier, overkill |

The bot only calls the $0.005 status endpoint during normal operation. Position ($0.010) is available via the CLI tool but not used by the tracker or automatic features.

### Use Case 1: Personal Round Trip

| Action | Calls | Cost |
|--------|-------|------|
| Check flight status before leaving | 1 | $0.005 |
| Track outbound flight (hourly × 8 hours) | 8 | $0.040 |
| Check inbound aircraft (day before) | 2 | $0.010 |
| Return flight same pattern | 11 | $0.055 |
| **Total** | **22** | **$0.11** |

### Use Case 2: Airport Pickup

| Action | Calls | Cost |
|--------|-------|------|
| Check departure status | 1 | $0.005 |
| Track arrival (hourly × 4 hours) | 4 | $0.020 |
| Final arrival check | 1 | $0.005 |
| **Total** | **6** | **$0.03** |

### Typical Month (2 trips + 2 pickups)

| Activity | Calls | Cost |
|----------|-------|------|
| 2 personal round trips | 44 | $0.22 |
| 2 airport pickups | 12 | $0.06 |
| Ad-hoc status checks (~10) | 10 | $0.05 |
| **Total** | **66** | **$0.33** |

**Well within the $5/month usage credit.** Even heavy travel months (4+ trips) would stay under $1. No out-of-pocket cost expected.

### Built-In Cost Guardrails

| Guardrail | Limit | Purpose |
|-----------|-------|---------|
| Daily call budget | 100 calls/day (~$0.50–$1.00) | Hard cap, resets at midnight |
| Per-minute rate limit | 10 requests/min | Prevents burst abuse |
| Max tracked flights | 5 simultaneous | Caps polling to 5 × 24 = 120 calls/day |
| Natural language confirmation | Inline buttons before API call | No accidental charges from chat |
| `max_pages=1` | 1 result set per lookup | Prevents multi-page pagination costs |
| Anthropic tool cost warning | "use ask_user first" in tool description | Claude confirms before calling on VPS |

**Worst-case daily spend:** 100 calls × $0.01 = $1.00/day. In practice, typical daily usage is 5–15 calls ($0.03–$0.08).

---

## Data Sent to FlightAware

| Data Sent | What They See | What They Don't See |
|-----------|--------------|---------------------|
| Flight number (e.g., AA1234) | The flight ident you're querying | Your name, location, or reason for tracking |
| API key | Your account identity | Message content, conversation history |
| Request metadata (IP, timestamp) | Standard HTTP request info | Nothing about your bot, users, or other integrations |

FlightAware returns publicly available flight data (the same info shown on flightaware.com). No personal data is sent beyond the flight number and your API key.

**Key privacy points:**
- FlightAware never sees your messages, conversation history, or any other bot data
- The API key identifies your account for billing but doesn't reveal personal information
- Position and tracking queries use FlightAware's internal flight IDs (opaque strings), not your identity
- No data from other integrations (weather, calendar, health, etc.) is shared with FlightAware

---

## Prerequisites

- A [FlightAware](https://www.flightaware.com/) account
- An [AeroAPI](https://www.flightaware.com/aeroapi/portal/) subscription (Personal plan: $0 minimum, $5/month credit)
- [Bun](https://bun.sh/) runtime installed

---

## Step 1: Get Your AeroAPI Key

### What you need to do:

1. Go to [flightaware.com/aeroapi/portal/](https://www.flightaware.com/aeroapi/portal/) and sign in
2. If you don't have an API subscription, click **Subscribe** and select the **Personal** plan ($0 minimum, $5/month usage credit)
3. Navigate to **API Keys** in the portal
4. Copy your API key — it's an alphanumeric string like `aBcDeFgHiJkLmNoPqRsTuVwXyZ123456`

### Tell Claude Code:
"Here's my FlightAware API key: [KEY]"

---

## Step 2: Add to Environment

### What Claude Code does:
- Adds `FLIGHTAWARE_API_KEY` to your `.env` file
- Adds placeholder to `.env.example`

```env
# FlightAware AeroAPI
FLIGHTAWARE_API_KEY=your-aeroapi-key
```

If running in hybrid mode, also add the key to your VPS `.env`:

```bash
ssh deploy@your-vps "echo 'FLIGHTAWARE_API_KEY=your-key' >> /path/to/go-telegram-bot/.env"
```

### Tell Claude Code:
"Add the FlightAware API key to .env"

---

## Step 3: Create the AeroAPI Client

### What Claude Code does:
- Creates `src/lib/flightaware.ts` — direct REST client for AeroAPI v4
- Creates `src/tools/flight-cli.ts` — CLI wrapper for Claude subprocess access

The client exports these functions:

| Function | Purpose |
|----------|---------|
| `isFlightTrackingEnabled()` | Check if `FLIGHTAWARE_API_KEY` is set |
| `getFlightStatus(ident, date?)` | Lookup flight, return most relevant match (today's or next upcoming) |
| `getFlightPosition(faFlightId)` | Current position for in-flight aircraft |
| `getInboundFlight(faFlightId)` | Lookup the inbound aircraft via `inbound_fa_flight_id` |
| `formatFlightStatus(flight)` | Multi-line human-readable status for Telegram/chat |
| `formatFlightBrief(flight)` | One-line summary for morning briefing |
| `formatFlightPosition(pos)` | Formatted position data (altitude, speed, heading) |
| `parseFlightIdent(text)` | Extract "AA1234" from natural text, normalize |
| `getApiUsageStats()` | Current daily call count and estimated cost |

**Flight ident parsing:** The regex `/\b([A-Z]{2,3})\s*(\d{1,4})\b/i` handles "AA1234", "AA 1234", "AAL1234". AeroAPI accepts both IATA and ICAO formats.

### Tell Claude Code:
"Create the FlightAware API client and CLI tool"

---

## Step 4: Create the Flight Tracker

### What Claude Code does:
- Creates `src/lib/flight-tracker.ts` — in-memory state + file persistence

The tracker exports:

| Function | Purpose |
|----------|---------|
| `startTracking(ident, chatId)` | Add flight to tracker (does immediate status check) |
| `stopTracking(ident, chatId)` | Remove from tracker |
| `getTrackedFlights(chatId?)` | List tracked flights |
| `formatTrackedFlights(chatId?)` | Formatted list for display |
| `initFlightTracker(notifyFn)` | Start polling interval with Telegram callback |
| `stopFlightTracker()` | Graceful shutdown |
| `loadTrackerState()` | Load from `tracked-flights.json` |

**Change detection:** The tracker only sends notifications when something meaningful changes:

| Change | Threshold |
|--------|-----------|
| Status change | Any (e.g., Scheduled → En Route → Landed) |
| Departure gate | Any change |
| Arrival gate | Any change |
| Terminal | Any change |
| Baggage claim | When assigned |
| Arrival delay | ≥15 minutes change |
| ETA | ≥10 minutes change |

### Tell Claude Code:
"Create the flight tracker with polling and notifications"

---

## Step 5: Wire Into the Bot

### What Claude Code does:
- Modifies `src/bot.ts` to add:
  - `/flight` slash command (direct API, bypasses Claude)
  - Natural language detection with inline confirmation buttons
  - Flight callback handler for button presses
  - Context injection in `callClaude()` — tracked flights appear as `## TRACKED FLIGHTS` section
  - Flight tracker initialization on startup
  - Graceful tracker shutdown
  - Startup log line: `Flights: enabled/disabled`

### Slash command reference:

| Command | Action |
|---------|--------|
| `/flight AA1234` | One-time status lookup |
| `/flight track AA1234` | Start hourly tracking with proactive updates |
| `/flight stop AA1234` | Stop tracking |
| `/flight list` | Show all tracked flights |

### Natural language triggers:

**Keywords that activate flight detection:** flight, flying, plane, departure, arrival, landing, takeoff, gate, terminal, delayed, boarding

**Stop keywords (no confirmation needed):** stop tracking, untrack, cancel tracking

### Tell Claude Code:
"Wire flight tracking into bot.ts"

---

## Step 6: Wire Into Remaining Systems

### What Claude Code does:

**`src/agents/base.ts`** — Adds flight CLI instructions to `BASE_CONTEXT` so Claude subprocess knows how to use the tool. Includes cost warning.

**`src/vps-gateway.ts`** — Adds `/flight` command handler for direct API lookups when the local Mac is offline. Does NOT run the polling loop (Mac handles that).

**`src/lib/anthropic-processor.ts`** — Adds `check_flight` tool to Anthropic tool definitions (gated by `isFlightTrackingEnabled()`). Tool description includes cost warning. Adds tracked flights context injection for flight-related messages.

**`src/voice-server.ts`** — Adds flight context injection in `callClaudeForVoice()` — tracked flights appear in context for flight-related voice queries.

**`src/morning-briefing.ts`** — If tracked flights exist, includes a flight section with current status. Only calls the API for already-tracked flights (no new lookups).

### Tell Claude Code:
"Wire flight tracking into the VPS gateway, Anthropic processor, voice server, morning briefing, and agent base context"

---

## What Data Is Available

### Flight Status (via `/flight AA1234` or `flight-cli.ts status`)

| Field | Example |
|-------|---------|
| Status | En Route, Scheduled, Landed, Cancelled, Delayed |
| Origin | Dallas (DFW) |
| Destination | Miami (MIA) |
| Departure time | Actual, estimated, or scheduled |
| Departure delay | 12m late |
| Arrival time | Actual, estimated, or scheduled |
| Arrival delay | 8m late |
| Origin gate/terminal | Terminal A, Gate A22 |
| Destination gate/terminal | Terminal N, Gate D8 |
| Baggage claim | Baggage 5 |
| Progress | 67% |
| Aircraft type | B738 |
| Registration | N860NN |

### Flight Position (via `flight-cli.ts position`, in-flight only)

| Field | Example |
|-------|---------|
| Latitude / Longitude | 32.847°, -96.852° |
| Altitude | 35,000 ft (climbing/descending/level) |
| Ground speed | 487 kts |
| Heading | 142° |
| Last updated | 2:34:15 PM |

---

## Where Flight Data Appears

| Context | What's Included |
|---------|----------------|
| **`/flight` command** | Full flight status — bot replies directly, Claude is bypassed |
| **Natural language** | Confirmation buttons shown first, then full status on tap |
| **Claude context injection** | Tracked flights listed as `## TRACKED FLIGHTS` with ident, status, and ETA |
| **Morning briefing** | One-line summary per tracked flight (ident, destination, status, ETA) |
| **Voice interface** | Tracked flights injected into context for flight-related voice queries |
| **VPS gateway** | `/flight` command handled directly — no Mac forwarding needed |
| **VPS Anthropic processor** | `check_flight` tool available for Claude to call (with cost warning) |
| **Proactive notifications** | Telegram message with changes + full status + "Stop tracking" button |

---

## CLI Reference

The Claude subprocess (and you manually) can query flight data via:

```bash
# Flight status
bun run src/tools/flight-cli.ts status AA1234

# Current position (in-flight only)
bun run src/tools/flight-cli.ts position AA1234

# Inbound aircraft info
bun run src/tools/flight-cli.ts inbound AA1234

# Start tracking (hourly polls + Telegram alerts)
bun run src/tools/flight-cli.ts track AA1234

# Stop tracking
bun run src/tools/flight-cli.ts untrack AA1234

# List tracked flights
bun run src/tools/flight-cli.ts list
```

Each `status` call costs $0.005. Each `position` call costs $0.010. The CLI loads `.env` automatically from the project root.

---

## VPS Setup

Add the API key to your VPS `.env`:

```env
FLIGHTAWARE_API_KEY=your-aeroapi-key
```

Then restart PM2:

```bash
pm2 restart go-bot
```

The VPS handles `/flight` slash commands directly — no Mac forwarding needed. The VPS does NOT run the flight tracker polling loop (the Mac handles that to avoid duplicate notifications).

---

## Architecture

### New Files

| File | Purpose |
|------|---------|
| `src/lib/flightaware.ts` | AeroAPI v4 client — rate limiter, daily budget, flight status, position, formatted output |
| `src/lib/flight-tracker.ts` | In-memory + file persistence tracker — hourly polling, change detection, proactive Telegram notifications |
| `src/tools/flight-cli.ts` | CLI wrapper — `status`, `position`, `inbound`, `track`, `untrack`, `list` |

### Modified Files

| File | Changes |
|------|---------|
| `.env` / `.env.example` | Added `FLIGHTAWARE_API_KEY` |
| `src/bot.ts` | `/flight` slash command, natural language detection with confirmation buttons, flight callback handler, context injection in `callClaude()`, tracker init/shutdown, startup log |
| `src/vps-gateway.ts` | `/flight` command handler (direct API, no Mac forwarding) |
| `src/lib/anthropic-processor.ts` | `check_flight` tool definition + executor, flight context injection |
| `src/voice-server.ts` | Flight context injection for voice queries |
| `src/morning-briefing.ts` | Tracked flights section in daily briefing |
| `src/agents/base.ts` | Flight CLI instructions in `BASE_CONTEXT` with cost warning |

### Persistence

Tracked flights are stored in `tracked-flights.json` in the project root (same pattern as `session-state.json`). The file is loaded on startup and saved after every state change.

---

## Customization

### Polling Interval

The default polling interval is 60 minutes. To change it, edit `POLL_INTERVAL_MS` in `src/lib/flight-tracker.ts`:

```typescript
const POLL_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
```

Shorter intervals increase API costs. At 30-minute polling with 5 tracked flights: 5 × 48 calls/day × $0.005 = $1.20/day.

### Daily Call Limit

The default daily budget is 100 calls. To change it, edit `DAILY_CALL_LIMIT` in `src/lib/flightaware.ts`:

```typescript
const DAILY_CALL_LIMIT = 100; // ~$0.50-$1.00/day max
```

### Max Tracked Flights

The default limit is 5 simultaneous flights. To change it, edit `MAX_TRACKED_FLIGHTS` in `src/lib/flightaware.ts`:

```typescript
const MAX_TRACKED_FLIGHTS = 5;
```

### Notification Thresholds

Change detection thresholds are in `src/lib/flight-tracker.ts`:

```typescript
const DELAY_THRESHOLD_SEC = 15 * 60; // Notify if delay changes by ≥15 minutes
```

ETA change threshold is 10 minutes (hardcoded in `detectChanges()`).

### Auto-Cleanup

Tracked flights are auto-removed after:
- Flight status becomes "arrived" or "landed"
- Flight is cancelled
- 24 hours past scheduled departure

---

## Troubleshooting

| Problem | Solution |
|---------|----------|
| "Flight tracking not configured" | `FLIGHTAWARE_API_KEY` not set in `.env`. On VPS, add it there too and restart PM2 |
| "Flight not found" | Check the flight number. AeroAPI accepts IATA (AA1234) and ICAO (AAL1234) formats |
| "FlightAware rate limit reached (10 req/min)" | Too many requests in the last minute. Wait 60 seconds |
| "FlightAware daily limit reached" | Hit the 100 calls/day budget cap. Resets at midnight. Increase `DAILY_CALL_LIMIT` if needed |
| "Already tracking 5 flights (max)" | Stop tracking one first: `/flight stop AA1234` |
| "AeroAPI error 401" | API key is invalid or expired. Check your key at flightaware.com/aeroapi/portal |
| VPS says "not configured" but local works | The VPS `.env` doesn't have the API key. SSH in and add it, then `pm2 restart go-bot` |
| No proactive notifications | The tracker only runs on the Mac bot, not VPS. Make sure your local bot is running |
| Duplicate notifications | Both Mac and VPS are running the tracker. Only the Mac should run it — check that VPS doesn't call `initFlightTracker()` |
| Bot searches the web instead of using FlightAware | The `/flight` command bypasses Claude. Natural language goes through confirmation buttons. If Claude still searches, the keyword regex didn't match — use the slash command |
| Tracked flights lost after restart | Check that `tracked-flights.json` exists in the project root and is readable |
| Morning briefing doesn't show flights | Only shows tracked flights. Track a flight with `/flight track AA1234` first |

---

## API Reference

The bot uses [FlightAware AeroAPI v4](https://www.flightaware.com/aeroapi/portal/documentation):

```
Base URL: https://aeroapi.flightaware.com/aeroapi

Headers:
  x-apikey: YOUR_API_KEY

Endpoints used:
  GET /flights/{ident}              — $0.005/result set — flight status
  GET /flights/{id}/position        — $0.010/result set — current position
  GET /flights/{id}                 — $0.005/result set — lookup by FA flight ID (inbound)

Query parameters:
  max_pages=1                       — cap to 1 result set (15 flights max)
```

Rate limit: 10 requests per minute (Personal plan). The bot enforces this client-side with a sliding window rate limiter.

---

## References

- [FlightAware](https://www.flightaware.com/) — Flight tracking platform
- [AeroAPI Portal](https://www.flightaware.com/aeroapi/portal/) — API subscription, keys, and usage dashboard
- [AeroAPI Documentation](https://www.flightaware.com/aeroapi/portal/documentation) — REST API docs
- [AeroAPI Pricing](https://www.flightaware.com/aeroapi/portal/pricing) — Per-endpoint pricing breakdown
