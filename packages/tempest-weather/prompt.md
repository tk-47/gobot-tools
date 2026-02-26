# Tempest Weather Station Integration

> **For Claude Code:** Drop this file into your project root or paste it into a Claude Code session. Claude will walk you through each step interactively. When you're ready, say: **"Set up Tempest weather integration"**

Connect your Telegram bot to a [WeatherFlow Tempest](https://weatherflow.com/tempest-weather-system/) personal weather station. Once set up, the bot can:

- Report live conditions from your station (temperature, wind, humidity, pressure, rain, UV, lightning)
- Show a 5-day forecast
- Include weather in daily morning briefings
- Respond to natural language — "Is it cold outside?", "Will it rain tomorrow?", "What's the forecast?"

---

## How It Works

The bot calls the [WeatherFlow Better Forecast API](https://weatherflow.github.io/Tempest/) directly via HTTP. No MCP server, no Claude subprocess, no web search — just a direct API call to your personal weather station.

When you ask about weather, the bot:
1. Detects weather keywords in your message (weather, temperature, rain, forecast, etc.)
2. Fetches live data from your Tempest station
3. Replies directly — **bypasses Claude entirely** for speed and accuracy

This bypass is intentional. Claude's subprocess has web search and will ignore "don't search the web" instructions, returning generic forecasts instead of your station's actual data. By intercepting weather queries before they reach Claude, the bot always returns your real, local readings.

```
User: "What's the weather like?"
  │
  ├── bot.ts detects "weather" keyword
  │     └── getCurrentWeather() — src/lib/weather.ts
  │           └── GET swd.weatherflow.com/swd/rest/better_forecast
  │           └── returns formatted station data
  │
  └── bot replies directly (Claude never sees the message):
        "Trinity Heights Weather Station
         Currently: Partly Cloudy
         Temp: 72°F (feels like 74°F)
         Humidity: 61%
         Wind: SSE 8 mph (gusts 12 mph)
         Rain today: 0.00 in
         UV Index: 4

         Today: Mostly Sunny
         High: 78°F  Low: 55°F
         Precip: 10%"
```

---

## Prerequisites

- A [WeatherFlow Tempest](https://weatherflow.com/tempest-weather-system/) weather station (installed and reporting data)
- A WeatherFlow account with API access
- [Bun](https://bun.sh/) runtime installed

---

## Step 1: Get Your Tempest API Token

### What you need to do:

1. Go to [tempestwx.com](https://tempestwx.com/) and log in with your WeatherFlow account
2. Navigate to **Settings** > **Data Authorizations** (or go directly to [tempestwx.com/settings/tokens](https://tempestwx.com/settings/tokens))
3. Click **Create Token**
4. Name it something like "Telegram Bot" and create it
5. Copy the token — it looks like a UUID: `a1b2c3d4-e5f6-7890-abcd-ef1234567890`

### Tell Claude Code:
"Here's my Tempest API token: [TOKEN]"

---

## Step 2: Get Your Station ID

### What you need to do:

1. On [tempestwx.com](https://tempestwx.com/), go to your station's page
2. The station ID is in the URL: `tempestwx.com/station/XXXXX` — the number is your station ID
3. Alternatively, check the **Settings** page for your station — the ID is listed there

### Tell Claude Code:
"My station ID is [ID]"

---

## Step 3: Add to Environment

### What Claude Code does:
- Adds `TEMPEST_TOKEN` and `TEMPEST_STATION_ID` to your `.env` file

```env
# Weather (WeatherFlow Tempest)
TEMPEST_TOKEN=your-api-token-here
TEMPEST_STATION_ID=your-station-id
```

### Tell Claude Code:
"Add the Tempest credentials to .env"

---

## Step 4: Verify the Connection

### What Claude Code does:
- Restarts the bot
- Confirms `isWeatherEnabled()` returns true

### How to test:
Send these messages to your bot on Telegram:
- `/weather` — current conditions
- `/forecast` — current conditions + 5-day forecast
- "What's the temperature?" — natural language works too
- "Will it rain tomorrow?" — triggers forecast mode

### Tell Claude Code:
"Restart the bot and test the weather integration"

---

## What Data Is Available

### Current Conditions
| Field | Example |
|-------|---------|
| Conditions | Partly Cloudy |
| Temperature | 72°F (feels like 74°F) |
| Humidity | 61% |
| Wind | SSE 8 mph (gusts 12 mph) |
| Barometric Pressure | 30.1 inHg (falling) |
| Rain today | 0.15 in |
| UV Index | 4 |
| Lightning | 3 strikes (last 2.4 mi away) |

### 5-Day Forecast
| Field | Example |
|-------|---------|
| Day | Fri 2/14 |
| Conditions | Mostly Sunny |
| High / Low | 78°F / 55°F |
| Precipitation chance | 10% |

---

## Keyword Triggers

The bot intercepts these keywords **before they reach Claude**, responding directly with station data:

**Current weather:** weather, temperature, temp, rain, storm, wind, humid, outside, cold, hot, warm, cool, heat, freeze, freezing, snow, lightning, uv, pressure

**Forecast mode** (adds 5-day outlook): forecast, week, upcoming, next few days, tomorrow, 5-day, five-day, later this week

Slash commands also work: `/weather`, `/forecast`

---

## Where Weather Data Appears

| Context | What's Included |
|---------|----------------|
| **Direct messages** | Bot intercepts weather keywords and replies instantly — Claude is bypassed |
| **Claude context injection** | If a weather message also needs Claude processing, station data is injected as `## LIVE WEATHER` with instructions to use only this data |
| **Morning briefing** | Current conditions included automatically in daily summary |
| **VPS fallback** | Anthropic API processor also has weather context injection for when the local machine is offline |

---

## Customization

### Station Name

Edit the `STATION_NAME` constant in `src/lib/weather.ts`:

```typescript
const STATION_NAME = "Your Station Name Here";
```

### Units

The API request in `src/lib/weather.ts` uses US customary units by default. Change the `units_*` parameters to switch:

```typescript
const params = new URLSearchParams({
  station_id: stationId,
  token,
  units_temp: "f",      // "f" or "c"
  units_wind: "mph",    // "mph", "kph", "kts", "mps"
  units_pressure: "inhg", // "inhg", "mb", "hpa"
  units_precip: "in",   // "in", "mm"
  units_distance: "mi", // "mi", "km"
});
```

---

## VPS Setup

No extra setup needed — just add the same two env vars to your VPS `.env`:

```env
TEMPEST_TOKEN=your-api-token
TEMPEST_STATION_ID=your-station-id
```

The WeatherFlow API is a public REST endpoint. No OAuth, no token refresh, no expiration. Works identically on local and VPS.

---

## Troubleshooting

| Problem | Solution |
|---------|----------|
| "TEMPEST_TOKEN and TEMPEST_STATION_ID must be set" | Check that both env vars are in your `.env` file |
| "Tempest API error: 401" | Token is invalid — regenerate at tempestwx.com/settings/tokens |
| "Tempest API error: 404" | Station ID is wrong — verify at tempestwx.com |
| Bot searches the web instead of using station data | The keyword regex didn't match. Check the trigger words above. Slash commands `/weather` and `/forecast` always work |
| Data seems stale | Your Tempest hub may be offline — check the WeatherFlow app |
| Wrong timezone on forecasts | Set `USER_TIMEZONE` in `.env` (e.g., `America/New_York`) |

---

## API Reference

The bot uses the [Better Forecast API](https://weatherflow.github.io/Tempest/):

```
GET https://swd.weatherflow.com/swd/rest/better_forecast
  ?station_id=XXXXX
  &token=YOUR_TOKEN
  &units_temp=f
  &units_wind=mph
  &units_pressure=inhg
  &units_precip=in
  &units_distance=mi
```

This single endpoint returns both current conditions and a 10-day forecast. No rate limits are documented for personal use. The bot makes one call per weather query (or two in parallel for forecast mode: current + daily).

---

## References

- [WeatherFlow Tempest](https://weatherflow.com/tempest-weather-system/) — The hardware
- [Tempest API Documentation](https://weatherflow.github.io/Tempest/) — REST API docs
- [tempestwx.com](https://tempestwx.com/) — Web dashboard and token management
