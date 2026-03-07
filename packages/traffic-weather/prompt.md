# Traffic & Weather Alerts

> **For Claude Code:** Drop this file into your project root or paste it into a Claude Code session. When you're ready, say: **"Set up traffic and weather alerts"**

Check weather conditions along driving routes for out-of-town calendar events. When the morning briefing runs, the bot scans your calendar for events with locations outside your home area, gets the driving route, and checks weather at points along the way — outbound and return. Severe weather triggers a standalone Telegram alert before the full briefing.

Works with any calendar source: Outlook (ms365), Google Calendar, Apple Calendar (ICS feeds), or any combination.

---

## What This Installs

| File | Purpose |
|------|---------|
| `src/lib/travel-weather.ts` | Route lookup, weather checks, hazard detection |
| `src/morning-briefing.ts` (modified) | Travel weather section + standalone severe alert |
| Your calendar lib (modified) | Raw event export for location inspection |

---

## Prerequisites

- A Google Cloud project with the **Directions API** enabled
- An [OpenWeatherMap](https://openweathermap.org) account (free tier)
- At least one calendar integration already working (ms365, url-calendar, google-api)

---

## Step 1 — Get Your Google Maps API Key

1. Go to [console.cloud.google.com](https://console.cloud.google.com)
2. Create a project or use an existing one
3. Go to **APIs & Services** → **Library** → search **Directions API** → **Enable**
4. Go to **Credentials** → **Create Credentials** → **API Key**
5. Restrict the key to **Directions API** only

**Add to your `.env`:**
```
GOOGLE_MAPS_API_KEY=your_key_here
```

---

## Step 2 — Get Your OpenWeatherMap API Key

1. Sign up at [openweathermap.org](https://openweathermap.org)
2. Go to **API Keys** tab → copy your key

**Add to your `.env`:**
```
OPENWEATHERMAP_API_KEY=your_key_here
```

New keys can take up to 2 hours to activate. The feature skips gracefully until the key is live.

---

## Step 3 — Install `src/lib/travel-weather.ts`

Copy `.gobot-tools/travel-weather/src/travel-weather.ts` to `src/lib/travel-weather.ts`.

**Configure your home location.** Edit the constants at the top of `travel-weather.ts`:

```typescript
const HOME_CITY = "Your City, ST";

const LOCAL_KEYWORDS = [
  "your city", "nearby suburb",
  "12345", "12346",  // local zip codes
];
```

Events with locations matching any keyword are considered local and skipped.

---

## Step 4 — Add a Raw Events Export to Your Calendar Integration

The travel weather module needs raw event objects (with location data) from your calendar. Your calendar integration likely returns a formatted string — you need to add a function that returns the raw objects.

### If you use Microsoft 365 (`src/lib/ms365.ts`)

Add this export after `getTodayEvents()`:

```typescript
/**
 * Fetch today's + tomorrow's raw calendar events (for travel weather, etc.).
 */
export async function getRawCalendarEvents(): Promise<CalendarEvent[]> {
  const tz = process.env.USER_TIMEZONE || "America/Chicago";
  const todayStr = new Date().toLocaleDateString("en-CA", { timeZone: tz });
  const [y, m, d] = todayStr.split("-").map(Number);
  const start = new Date(Date.UTC(y, m - 1, d));
  const end = new Date(Date.UTC(y, m - 1, d + 1, 23, 59, 59, 999));

  const startISO = start.toISOString().slice(0, 10) + "T00:00:00";
  const endISO = end.toISOString().slice(0, 10) + "T23:59:59";

  const data = await graphGet("/me/calendarView", {
    startDateTime: startISO,
    endDateTime: endISO,
    $orderby: "start/dateTime",
    $top: "50",
    $select: "id,subject,start,end,location,isAllDay,organizer",
  }, {
    Prefer: `outlook.timezone="${tz}"`,
  });

  return data?.value ?? [];
}
```

### If you use URL Calendar / ICS feeds (`src/lib/url-calendar.ts`)

Add this export before `getUrlCalendarEvents()`:

```typescript
export async function getRawUrlCalendarEvents(start: Date, end: Date): Promise<UrlCalendarEvent[]> {
  const urls = getConfiguredUrls();
  if (urls.length === 0) return [];

  const events: UrlCalendarEvent[] = [];

  for (const url of urls) {
    const ics = await fetchIcs(url);
    const parsed = parseIcsEvents(ics);
    for (const raw of parsed) {
      if (raw.rrule) {
        for (const evt of expandRecurringEvent(raw, start, end)) {
          if (evt.uid?.includes("-DUP")) continue;
          events.push(evt);
        }
      } else {
        const evt = toEvent(raw);
        if (!evt) continue;
        if (evt.uid?.includes("-DUP")) continue;
        if (!overlaps(evt.start, evt.end, start, end)) continue;
        events.push(evt);
      }
    }
  }

  events.sort((a, b) => a.start.getTime() - b.start.getTime());
  return events;
}
```

Then update `getUrlCalendarEvents()` to call it internally:

```typescript
export async function getUrlCalendarEvents(start: Date, end: Date, label = "today"): Promise<string> {
  const urls = getConfiguredUrls();
  if (urls.length === 0) return "Not configured.";

  const tz = process.env.USER_TIMEZONE || "America/Chicago";
  const events = await getRawUrlCalendarEvents(start, end);
  // ... rest of formatting stays the same
```

### If you use Google Calendar

Your Google Calendar integration needs a function that returns raw event objects with at least: `summary`, `location`, `start.dateTime`, `end.dateTime`. Adapt the pattern above for your Google API wrapper.

### Any other calendar source

`checkTravelWeather()` accepts two arrays of events. The first expects objects shaped like Outlook events (`{ subject, location: { displayName }, start: { dateTime }, end: { dateTime }, isAllDay }`). The second expects ICS-style events (`{ summary, location, start: Date, end: Date, allDay }`).

If your calendar doesn't match either shape, write a small normalizer function — see `fromOutlookEvents()` and `fromAppleEvents()` in `travel-weather.ts` for examples.

---

## Step 5 — Wire Into Morning Briefing

In `src/morning-briefing.ts`:

**Add imports:**

```typescript
import { isTravelWeatherEnabled, checkTravelWeather } from "./lib/travel-weather";
// Add raw event imports for whichever calendar(s) you use:
import { getRawCalendarEvents } from "./lib/ms365";
import { getRawUrlCalendarEvents } from "./lib/url-calendar";
```

**Add raw event fetches to the `Promise.all` block** (alongside your existing calendar data):

```typescript
getRawCalendarEvents().catch((err) => {
  console.error("Raw calendar fetch failed:", err);
  return [] as any[];
}),
getRawUrlCalendarEvents(todayStart, tomorrowEnd).catch((err) => {
  console.error("Raw URL calendar fetch failed:", err);
  return [] as any[];
}),
```

**After the `Promise.all`, run travel weather:**

```typescript
let travelWeather = null;
if (isTravelWeatherEnabled() && (rawEvents.length > 0 || rawAppleEvents.length > 0)) {
  try {
    travelWeather = await checkTravelWeather(rawEvents, rawAppleEvents);
  } catch (err) {
    console.error("Travel weather check failed:", err);
  }
}

// Standalone alert for severe weather (before the full briefing)
if (travelWeather?.hasWarning) {
  await sendTelegramMessage(BOT_TOKEN, CHAT_ID, `⚠️ *TRAVEL WEATHER ALERT*\n\n${travelWeather.details}`, {
    parseMode: "Markdown",
  });
}
```

**Add the section to the briefing** (between Calendar and Email is natural):

```typescript
if (travelWeather) {
  briefing += `🚗 **TRAVEL WEATHER**\n${travelWeather.details}\n\n`;
}
```

---

## Step 6 — Verify

1. Add a test event to your calendar: any future event today or tomorrow with a location in another city (e.g., "Test Meeting" at "Dallas, TX")
2. Run the briefing manually: `bun run briefing`
3. You should see a `🚗 TRAVEL WEATHER` section with route distance, drive time, and weather for both outbound and return

If the OpenWeatherMap key hasn't activated yet (new keys take up to 2 hours), the section won't appear. Check logs for "forecast failed" messages.

---

## Troubleshooting

**No travel weather section** — Check both API keys are set in `.env`. Run: `curl "https://maps.googleapis.com/maps/api/directions/json?origin=Your+City&destination=Test+City&key=YOUR_KEY"` and `curl "https://api.openweathermap.org/data/2.5/forecast?lat=32.78&lon=-96.80&appid=YOUR_KEY&units=imperial&cnt=1"` to verify both APIs respond.

**"Event skipped"** — The event either has no location field, or the location matches a keyword in `LOCAL_KEYWORDS`. Check event details in your calendar app.

**OWM 401 error** — New keys take up to 2 hours to activate. Wait and try again.

**Google Directions "REQUEST_DENIED"** — The Directions API is not enabled, or the API key is restricted to other APIs. Check your Google Cloud console.

**Traffic data missing** — `duration_in_traffic` requires the `departure_time` parameter to be in the future. Past events won't show traffic.
