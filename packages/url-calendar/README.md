# URL Calendar (ICS Feed)

Read any calendar — Apple, Google, Outlook, or any CalDAV source — by pointing the bot at a public or private ICS feed URL.

No API keys. No OAuth. No macOS Automation. Works on Mac, VPS, or any Linux host.

---

## What It Does

- Fetches events from one or more ICS/webcal feed URLs
- Full RFC 5545 parsing with DAILY and WEEKLY recurrence rule support (BYDAY, INTERVAL, COUNT, UNTIL)
- Merges and deduplicates events from multiple feeds, sorted by start time
- Formats output with times in your local timezone, including event locations
- Handles all-day events, floating local times, and UTC timestamps

---

## Requirements

- A public or private ICS feed URL from your calendar app
- Your bot's `.env` file with `APPLE_CALENDAR_URL` set

No accounts, no app installs, no permissions grants.

---

## Setup (2 minutes)

### Step 1 — Get your calendar feed URL

**Apple Calendar**
Right-click a calendar → Share → Copy Link. This gives a `webcal://` URL — both `webcal://` and `https://` work.

**Google Calendar**
Settings → select your calendar → scroll to "Secret address in iCal format" → copy the link.

**Outlook / Microsoft 365**
Calendar settings → "Publish calendar" → copy the ICS link.

**Any other CalDAV calendar**
Check your calendar app's sharing or export settings for an ICS/webcal link.

### Step 2 — Add to your `.env`

```
# Single feed
APPLE_CALENDAR_URL=https://example.com/path/to/calendar.ics

# Multiple feeds (comma-separated — all merged and sorted)
# APPLE_CALENDAR_URLS=https://example.com/personal.ics,https://example.com/work.ics

# Your timezone for event time formatting
USER_TIMEZONE=America/Chicago
```

### Step 3 — Install the bot integration

Open `prompt.md` in Claude Code and say: **"Set up URL calendar integration"**

Claude Code will copy the source files and wire the bot handlers for you.

---

## CLI Usage

Test outside the bot:

```bash
bun run src/tools/url-calendar-cli.ts today
bun run src/tools/url-calendar-cli.ts tomorrow
bun run src/tools/url-calendar-cli.ts this week
bun run src/tools/url-calendar-cli.ts next week
```

Example output:

```
Apple Calendar URL — today
- [All Day]: Independence Day
- 9:00 AM-10:00 AM: Team standup (Zoom)
- 2:00 PM-3:00 PM: 1:1 with Alex (Conference Room B)
```

---

## Supported Recurrence Rules

The parser handles a subset of RFC 5545 RRULE sufficient for most real-world calendars:

| Frequency | BYDAY | INTERVAL | COUNT | UNTIL |
|-----------|-------|----------|-------|-------|
| DAILY | — | ✓ | ✓ | ✓ |
| WEEKLY | ✓ | ✓ | ✓ | ✓ |

Monthly and yearly recurrence is not expanded (single-occurrence only). A 5,000-event guard prevents runaway loops on malformed rules.

---

## How the Data Flows

```
Apple Calendar / Google Calendar / Outlook
    ↓  (calendar app generates ICS feed)
ICS Feed URL  (https:// or webcal://)
    ↓  (HTTPS GET, 8-second timeout, no credentials stored)
url-calendar.ts  fetchIcs()
    ↓  (RFC 5545 parsing, RRULE expansion, deduplication)
getUrlCalendarEvents()  →  formatted text
    ↓
Bot reply  →  your Telegram chat
```

**What this means in practice:**

- The bot makes a direct HTTPS GET request to the feed URL you provide — no intermediary, no proxy
- The ICS response is parsed in memory and discarded after formatting — nothing is written to disk
- Events are formatted and sent to your Telegram chat; they are not stored anywhere
- The feed URL itself is stored only in your `.env` file on your own machine

**What never happens:**

- Event data is never written to a database or file
- Your calendar credentials (Apple ID, Google account, etc.) are never touched — only the public/private feed URL is used
- Event data does not go to Anthropic's servers at rest — only transiently during inference if you ask Claude a follow-up question
- No third-party service receives your calendar data; the fetch goes directly from your bot to the calendar provider's ICS endpoint

---

## Privacy

**No credentials stored:** The only thing this tool needs is a feed URL — a plain string in your `.env`. No OAuth tokens, no API keys, no refresh tokens. If you revoke the calendar share in your calendar app, the URL stops working immediately.

**Ephemeral data:** Events are fetched, parsed, formatted, and discarded in a single request cycle. Nothing is persisted to disk or a database.

**Direct connection:** The HTTPS request goes from your bot (Mac or VPS) directly to the calendar provider's servers. There is no relay, no intermediary service, and no data at rest with any third party.

**Minimal exposure:** The feed URL is a private link — it does not expose your calendar app login credentials. You can regenerate or revoke it at any time from your calendar settings.

**Third-party policies:** Events fetched from Apple, Google, or Microsoft calendar feeds are governed by those providers' own privacy policies for their ICS endpoint infrastructure. The bot does not interact with any other part of those platforms.

---

## Updating

```
gobot-tools update url-calendar
```
