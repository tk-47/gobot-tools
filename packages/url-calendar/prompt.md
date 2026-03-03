# URL Calendar Setup

You are helping the user add ICS/webcal calendar feed support to their bot.
This integration fetches events from any public or private calendar URL — no API keys, no macOS Automation, no OAuth. Works on Mac, VPS, or any Linux host.

Follow these steps in order.

## 1. Inspect current project state

Check whether these files already exist:
- `src/lib/url-calendar.ts`
- `src/tools/url-calendar-cli.ts`
- Any existing calendar handling in `src/bot.ts`

Summarize what exists and what you will add or update.

## 2. Install library files

Copy:
- `packages/url-calendar/src/url-calendar.ts` → `src/lib/url-calendar.ts`
- `packages/url-calendar/src/url-calendar-cli.ts` → `src/tools/url-calendar-cli.ts`

The CLI imports `parseDateRange` from `../lib/ms365` — this is a core bot file and will already be present. No additional dependencies are required.

The library exports:
- `isUrlCalendarEnabled()` — returns true if any calendar URL is configured
- `getUrlCalendarEvents(start, end, label?)` — fetches, parses, and formats events for a date range

## 3. Configure environment variables

Add to `.env`:
```
# Single feed
APPLE_CALENDAR_URL=https://example.com/path/to/calendar.ics

# Multiple feeds (comma-separated, all merged and sorted)
# APPLE_CALENDAR_URLS=https://example.com/one.ics,https://example.com/two.ics

USER_TIMEZONE=America/Chicago
```

How to get your feed URL:
- **Apple Calendar**: right-click a calendar → Share → Copy Link (shows a webcal:// URL — both webcal:// and https:// work)
- **Google Calendar**: Settings → select calendar → "Secret address in iCal format"
- **Outlook/Microsoft 365**: Calendar settings → "Publish calendar" → ICS link

## 4. Wire bot handlers

In `src/bot.ts`, import the library and add a calendar keyword intercept before Claude processing:

```ts
import { isUrlCalendarEnabled, getUrlCalendarEvents } from "./lib/url-calendar";
import { parseDateRange } from "./lib/ms365";
```

Add a handler that intercepts calendar queries and replies directly (before the message reaches Claude):

```ts
const calendarKeywords = /\b(calendar|schedule|what(?:'s| is) (?:on|happening)|my (?:day|week|agenda)|events? (?:today|tomorrow|this week|next week))\b/i;

if (isUrlCalendarEnabled() && calendarKeywords.test(text)) {
  const { start, end, label } = parseDateRange(text);
  const events = await getUrlCalendarEvents(start, end, label);
  await ctx.reply(`Calendar — ${label}:\n\n${events}`);
  return;
}
```

**Important**: Place this intercept BEFORE the generic Claude subprocess call. If you inject calendar data into the Claude prompt instead, Claude may still use WebSearch and hallucinate events.

## 5. Wire morning briefing (optional)

If the project has `src/morning-briefing.ts`, add calendar data to the briefing:

```ts
import { isUrlCalendarEnabled, getUrlCalendarEvents } from "./lib/url-calendar";

if (isUrlCalendarEnabled()) {
  const { start, end, label } = parseDateRange("today");
  const events = await getUrlCalendarEvents(start, end, label);
  sections.push(`Calendar — ${label}\n${events}`);
}
```

## 6. Verify

Test the CLI directly:
```bash
bun run src/tools/url-calendar-cli.ts today
bun run src/tools/url-calendar-cli.ts tomorrow
bun run src/tools/url-calendar-cli.ts this week
```

If the feed URL is correct, you should see a formatted list of events. If you see "Not configured", check that `APPLE_CALENDAR_URL` is set in `.env`.

## Guardrails

- Do not modify the ICS parsing logic unless there is a confirmed bug.
- Do not add caching unless the user explicitly requests it.
- Do not add API keys or OAuth — the design is intentionally credential-free.
- Keep all instructions generic (no personal/private identifiers).
