# Traffic & Weather Alerts

Automatic weather and traffic alerts for out-of-town calendar events. When your calendar has an event with a location outside your home area, the bot checks weather conditions along the entire driving route — outbound and return — and warns you about rain, storms, snow, ice, or fog before you leave. Shows up in your morning briefing or as a standalone alert for severe conditions.

Works with any calendar source your bot already uses: Outlook (ms365), Google Calendar, Apple Calendar (ICS feeds), or any combination.

---

## Requirements

- A Google Cloud account with the **Directions API** enabled (free $200/month credit)
- An [OpenWeatherMap](https://openweathermap.org) account (free tier — 1,000 calls/day)
- At least one calendar integration already configured in your bot (ms365, url-calendar, google-api, etc.)
- Events must have a **location** field set — events without locations are skipped

---

## Setup (~5 minutes)

### Step 1 — Get a Google Maps API key

1. Go to [console.cloud.google.com](https://console.cloud.google.com)
2. Create a project (or use an existing one)
3. Navigate to **APIs & Services** → **Library**
4. Search for and enable **Directions API**
5. Go to **Credentials** → **Create Credentials** → **API Key**
6. Restrict the key to **Directions API** only (recommended)

Add it to your bot's `.env`:

```
GOOGLE_MAPS_API_KEY=your_key_here
```

Google gives you $200/month in free credit — roughly 40,000 direction lookups. A daily briefing uses 1-2 calls per travel event.

### Step 2 — Get an OpenWeatherMap API key

1. Sign up at [openweathermap.org](https://openweathermap.org)
2. Go to **API Keys** tab
3. Copy the default key (or create a new one)

Add it to your bot's `.env`:

```
OPENWEATHERMAP_API_KEY=your_key_here
```

Free tier allows 1,000 calls/day. Each travel event uses roughly 3-8 calls depending on route length (one per waypoint, outbound + return).

**Note:** New OpenWeatherMap keys can take up to 2 hours to activate. The feature gracefully skips weather checks until the key is live.

### Step 3 — Configure your home location

The tool needs to know what counts as "local" so it only alerts for out-of-town events. Edit the `LOCAL_KEYWORDS` and `HOME_CITY` constants in `src/lib/travel-weather.ts`:

```typescript
const HOME_CITY = "Your City, ST";

const LOCAL_KEYWORDS = [
  "your city", "nearby suburb", "another suburb",
  "12345", "12346",  // local zip codes
];
```

Events with locations matching any keyword are considered local and skipped.

### Step 4 — Install the bot integration

Open `prompt.md` in Claude Code and say: **"Set up travel weather alerts"**

Claude Code will:
1. Add `src/lib/travel-weather.ts` to your bot
2. Wire `checkTravelWeather()` into your morning briefing
3. Connect it to whichever calendar source(s) you use
4. Add the standalone severe weather alert

---

## What It Checks

**Route analysis**
- Gets the driving route from your home to the event location via Google Directions API
- Samples weather every ~30 miles along the route
- Estimates what time you'll pass each waypoint (assumes departure 1 hour before event, 55 mph average)
- Checks the forecast at each waypoint for that specific time window

**Outbound + return**
- Checks weather for both the drive there (departing 1 hour before event) and the drive home (departing when the event ends)
- Warnings are labeled *Going* and *Return* separately

**Traffic**
- Includes real-time traffic estimates from Google Directions when `departure_time` is in the future
- Shows delay if traffic adds more than 5 minutes over the normal drive time

**Hazard detection**
- Rain, thunderstorms, snow, sleet, ice, fog — any of these trigger a warning
- Precipitation probability >= 40% triggers a warning even without a hazard keyword
- Clear routes get a confirmation so you know conditions were checked

---

## Example Output

In the morning briefing:

```
🚗 TRAVEL WEATHER
🌧 Client Meeting in Dallas at 2:00 PM (33 mi, ~37 min)
  Going →
    • 30mi mark: moderate rain, 54F, 65% precip
    • Dallas: light rain, 56F, 45% precip
  Return ←
    • Dallas: scattered clouds, 58F, 20% precip
```

When conditions are clear:

```
🚗 TRAVEL WEATHER
✅ Client Meeting in Dallas at 2:00 PM — clear both ways (33 mi, ~37 min)
```

With traffic delay:

```
✅ Client Meeting in Houston at 10:00 AM — clear both ways (264 mi, ~4 hr 15 min (+22 min traffic))
```

If any leg has severe weather, a standalone alert is sent before the full briefing:

```
⚠️ TRAVEL WEATHER ALERT

🌧 Client Meeting in Dallas at 2:00 PM (33 mi, ~37 min +8 min traffic)
  Going →
    • 30mi mark: heavy rain, 48F, 85% precip
```

---

## Calendar Compatibility

The tool normalizes events from different calendar sources into a common format. It works with any source that provides:
- An event name/summary
- A start and end time
- A location string

| Calendar Source | Bot Integration | Location Field |
|----------------|----------------|----------------|
| Microsoft Outlook | `ms365` tool | `location.displayName` |
| Apple Calendar / iCloud | `url-calendar` tool | `location` (from ICS `LOCATION` field) |
| Google Calendar | `google-api` tool | `location` (from API response) |
| Any ICS feed | `url-calendar` tool | `location` (from ICS `LOCATION` field) |

If you use multiple calendar sources, events are deduplicated by name + start time so you don't get duplicate alerts for the same event synced across calendars.

To add support for a new calendar source, write a normalizer function that maps your event objects to `{ name, location, start, end }` and pass them to `checkTravelWeather()`.

---

## How the Data Flows

```
Morning briefing runs (scheduled or manual)
    ↓
Your calendar integration(s) return today's + tomorrow's events
    ↓
travel-weather.ts filters for events with out-of-town locations
    ↓
Google Directions API — route + waypoints + traffic for each event
    ↓  (HTTPS GET, API key authenticated)
OpenWeatherMap API — forecast at each waypoint for the estimated arrival time
    ↓  (HTTPS GET, API key authenticated)
Results compiled: warnings per leg (outbound + return)
    ↓
Morning briefing includes travel weather section
    ↓  (+ standalone Telegram alert if severe)
Your Telegram chat
```

**In plain terms:** When your morning briefing runs, the bot looks at your calendar for events outside your home area. For each one, it asks Google Maps for the driving route and then checks the weather forecast at points along that route — timed to when you'd actually be driving through. The results go into your briefing. No data is stored — everything is fetched, processed, and sent in a single pass.

**What never happens:**

- Your calendar data is never sent to Google or OpenWeatherMap — only the destination address goes to Google Directions, and only lat/lng coordinates go to OpenWeatherMap
- Your API keys are never sent to Claude or Anthropic — the bot calls both APIs directly
- No location data is stored on disk — route and weather data are processed in memory and discarded after the briefing is sent
- Google and OpenWeatherMap never see each other's data — they are called independently

---

## Privacy

**No credential storage:** `GOOGLE_MAPS_API_KEY` and `OPENWEATHERMAP_API_KEY` live only in your `.env` file on your own machine. They are never logged, stored in a database, or sent to any service other than their respective APIs.

**Minimal data sent to Google:** Only the event's location string and your home city are sent to the Directions API. No event names, times, calendar details, or personal information.

**Minimal data sent to OpenWeatherMap:** Only latitude/longitude coordinates of route waypoints. No identifying information, no event details, no location names.

**No data at rest:** Route geometry, waypoint coordinates, and weather forecasts are held in memory for the duration of the briefing run and then discarded. Nothing is written to disk.

**No OAuth:** Both APIs use simple API keys — no authorization flows, no refresh tokens, no third-party accounts to link.

**API cost transparency:** Google Directions is $5 per 1,000 requests ($200/month free credit). OpenWeatherMap free tier allows 1,000 calls/day. A typical day with 1-2 travel events uses fewer than 20 API calls total.

**Google Maps Platform privacy:** [cloud.google.com/maps-platform/terms](https://cloud.google.com/maps-platform/terms)

**OpenWeatherMap privacy:** [openweathermap.org/privacy-policy](https://openweathermap.org/privacy-policy)

---

## Updating

```bash
gobot-tools update traffic-weather
```
