# Apple Notes + Calendar

Connect your bot to **Apple Notes.app** and **Apple Calendar.app** — fully local, no API keys, no cloud sync, no auth tokens. Your bot can read and search your notes, create new notes, append to existing ones, and pull calendar events — all directly from your Mac.

Uses macOS Automation (JavaScript for Automation / JXA) via `osascript`. No third-party services involved.

---

## Requirements

- macOS (any recent version — tested on Sonoma/Sequoia)
- Notes.app and Calendar.app (built into macOS)
- One-time Automation permission (granted in System Settings — see Setup)
- Claudebot running locally on your Mac (not the VPS — JXA requires the local Mac)

---

## Setup (2 minutes)

### Step 1 — Grant Automation permission

The bot uses `osascript` to talk to Notes and Calendar. You must grant permission once:

1. Open **System Settings → Privacy & Security → Automation**
2. Find the app running your bot (Terminal, iTerm2, or the launchd service user)
3. Enable **Notes** and **Calendar** for that app

If you skip this step, `osascript` will throw a permission error on the first JXA call and macOS will prompt you — just click Allow.

### Step 2 — Install the integration

Copy `src/apple-native.ts` to your bot's `src/lib/apple-native.ts`.
Copy `src/apple-native-cli.ts` to your bot's `src/tools/apple-native-cli.ts`.

Or run (from your bot directory):

```bash
gobot-tools install apple-notes-calendar
```

Open `prompt.md` in Claude Code and say: **"Set up Apple Notes and Calendar integration"**

Claude Code will handle the imports and bot.ts wiring automatically.

### Step 3 — Verify

```bash
bun run src/tools/apple-native-cli.ts calendar events 7
bun run src/tools/apple-native-cli.ts notes list
```

If events and notes appear, the integration is working.

---

## What Your Bot Can Do

### Apple Notes

| Command | What it does |
|---------|-------------|
| `notes list [FOLDER] [LIMIT]` | List notes (optionally filter by folder) |
| `notes read <NAME>` | Read a note's full content (partial name match) |
| `notes search <QUERY>` | Search notes by keyword in title or body |
| `notes create <TITLE> <BODY> [FOLDER]` | Create a new note |
| `notes append <NAME> <TEXT>` | Append text to an existing note |

### Apple Calendar

| Command | What it does |
|---------|-------------|
| `calendar events [DAYS]` | Fetch events for the next N days (default: 7) |
| `calendar search <QUERY>` | Find events containing a keyword (next 30 days) |

Calendar defaults to the **"Jordan Family"** calendar but falls back to all calendars if not found. You can customize the calendar name in `apple-native.ts`.

---

## Calendar Context Injection

When this integration is active, `callClaude()` in `bot.ts` automatically injects your upcoming Apple Calendar events whenever you ask about your schedule, meetings, or plans. No explicit command needed — just ask "What's on my calendar this week?" and your bot will answer from local data without hitting any external API.

---

## How the Data Flows

```
Notes.app / Calendar.app  (on your Mac)
    ↓  (osascript / JXA — local IPC only)
apple-native.ts  (library in your bot)
    ↓  (called by bot.ts or apple-native-cli.ts)
Claude (subprocess or API)
    ↓
Your Telegram / Teams chat
```

**What this means in practice:**

- JXA communicates with Notes and Calendar over macOS's local inter-process communication layer — no network requests, no file reads, no external APIs
- Notes and Calendar data never leave your Mac unless you explicitly send it to your chat (which is end-to-end encrypted in Telegram)
- The bot does not cache or store notes or calendar events locally — it fetches fresh on each query
- Claude processes the data transiently during inference and does not store it beyond Anthropic's standard retention policy

**What never happens:**

- Notes and Calendar data do not go to Apple's servers via this integration (JXA reads from the local app, not iCloud)
- No data is written to any file or database by this library
- No third-party service (Google, Microsoft, etc.) is involved at any step
- The VPS does not have access to this integration — it runs on your local Mac only

---

## Privacy

**No credentials:** This integration requires zero API keys, tokens, or passwords. The only prerequisite is a macOS permission toggle.

**No network:** `osascript` communicates with Notes.app and Calendar.app over local IPC. No bytes leave your machine as part of the integration itself.

**No persistent storage:** Notes and calendar data is never written to disk by this library. Every read is live from the source app.

**No OAuth:** Unlike most calendar integrations, there is no authorization flow, no access token rotation, and no third-party account. The macOS Automation permission is granted once in System Settings and remembered by the OS.

**VPS is excluded:** This integration runs only when your bot is processing locally on your Mac. When the VPS handles a message (Mac offline), Apple Notes/Calendar context is simply omitted — no errors, no stale data.

**Automation scope is minimal:** Granting Automation access to Notes and Calendar does not allow the app to read your Keychain, access other apps, or perform any action beyond what Notes/Calendar's JXA API exposes.

---

## Troubleshooting

**"Not authorized to send Apple events"**
- Go to System Settings → Privacy & Security → Automation
- Enable Notes and/or Calendar for your terminal app or launchd service

**Calendar shows no events**
- Verify the calendar name in `getAppleCalendarEvents()` matches your actual calendar name
- By default it uses "Jordan Family" — change to match your calendar

**Notes search is slow**
- JXA scans all notes one-by-one; with thousands of notes this can take a few seconds
- Consider narrowing the search with a folder filter

**Events show wrong timezone**
- Set `USER_TIMEZONE` in your `.env` (e.g. `America/Chicago`)
- The formatter uses this env var; defaults to Chicago if not set

---

## Updating

```bash
gobot-tools update apple-notes-calendar
```
