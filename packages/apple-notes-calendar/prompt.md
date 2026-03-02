# Apple Notes + Calendar Setup

You are helping the user integrate Apple Notes and Apple Calendar into their Claudebot.
Everything runs locally on macOS via JXA (JavaScript for Automation / osascript).
No API keys, no cloud sync, no auth tokens required.
Follow these steps in order.

---

## Step 1 — Check existing setup

Read the current state of the project:
- Check if `src/lib/apple-native.ts` exists (already installed?)
- Check if `src/tools/apple-native-cli.ts` exists
- Check if `bot.ts` already imports from `apple-native`
- Check if the bot is running on macOS (VPS users cannot use this integration)

Tell the user what you found and what you'll be adding.

---

## Step 2 — Install the library

Copy `src/apple-native.ts` from this package into the bot's `src/lib/apple-native.ts`.

This file provides:
- `isAppleNativeEnabled()` — returns true on macOS only; gates all JXA calls
- `listNotes(folder?, limit?)` — list notes with optional folder filter
- `readNote(nameOrId)` — read a note's full content by name or id
- `searchNotes(query, limit?)` — search notes by keyword
- `createNote(title, body, folder?)` — create a new note
- `appendToNote(nameOrId, text)` — append text to an existing note
- `getAppleCalendarEvents(start, end, calendarName?)` — fetch calendar events in a date range
- `formatAppleCalendarEvents(events, label)` — human-readable event list
- `formatNoteList(notes)` — human-readable note list

---

## Step 3 — Install the CLI tool

Copy `src/apple-native-cli.ts` from this package into the bot's `src/tools/apple-native-cli.ts`.

This CLI is used by Claude (subprocess mode) to fetch data on demand. It supports:

```
bun run src/tools/apple-native-cli.ts notes list [FOLDER] [LIMIT]
bun run src/tools/apple-native-cli.ts notes read <NAME_OR_ID>
bun run src/tools/apple-native-cli.ts notes search <QUERY>
bun run src/tools/apple-native-cli.ts notes create <TITLE> <BODY> [FOLDER]
bun run src/tools/apple-native-cli.ts notes append <NAME_OR_ID> <TEXT>
bun run src/tools/apple-native-cli.ts calendar events [DAYS]
bun run src/tools/apple-native-cli.ts calendar search <QUERY>
```

---

## Step 4 — Wire imports into bot.ts

In `src/bot.ts`, add these imports near the top (alongside other lib imports):

```typescript
import {
  isAppleNativeEnabled,
  getAppleCalendarEvents,
  formatAppleCalendarEvents,
} from "./lib/apple-native";
```

If the user also wants Notes.app commands (slash commands or keyword triggers), add:

```typescript
import {
  listNotes,
  readNote,
  searchNotes,
  createNote,
  appendToNote,
  formatNoteList,
} from "./lib/apple-native";
```

---

## Step 5 — Add calendar context injection to callClaude()

Find the `callClaude()` function in `bot.ts`. Inside it, locate the block that builds `sections[]`
for the system prompt (near other context blocks like MS365, weather, health).

Add this block after the MS365 calendar block:

```typescript
// Apple Calendar context — inject personal/family calendar events (macOS only)
if (isAppleNativeEnabled()) {
  const calendarKeywords = /\b(calendar|schedule|meeting|event|appointment|busy|free|agenda)\b/i;
  if (calendarKeywords.test(userMessage)) {
    const { start, end, label } = parseDateRange(userMessage);
    await getAppleCalendarEvents(start, end).then((events) => {
      if (events.length > 0) {
        sections.push(`## APPLE CALENDAR — ${label.toUpperCase()} (personal/family — use this data)\n${formatAppleCalendarEvents(events, label)}`);
      }
    }).catch((err) => console.error("Apple Calendar fetch failed:", err));
  }
}
```

This ensures the bot automatically answers calendar questions from local data without needing an external API call.

---

## Step 6 — (Optional) Add Apple Notes slash commands

If the user wants to query Notes directly from the bot, add Grammy handlers for commands like `/notes`, `/note`, `/searchnotes`:

```typescript
bot.command("notes", async (ctx) => {
  if (!isAppleNativeEnabled()) {
    return ctx.reply("Apple Notes requires macOS.");
  }
  const query = ctx.match?.trim();
  if (query) {
    const notes = await searchNotes(query, 10);
    return ctx.reply(formatNoteList(notes) || `No notes matching "${query}".`);
  }
  const notes = await listNotes(undefined, 15);
  return ctx.reply(formatNoteList(notes) || "No notes found.");
});
```

Add this handler near the other command handlers in `bot.ts`.

---

## Step 7 — Grant macOS Automation permission

Tell the user:

> The bot uses `osascript` to communicate with Notes and Calendar. You need to grant permission once:
>
> 1. Open **System Settings → Privacy & Security → Automation**
> 2. Find the app running your bot (Terminal, iTerm2, or your launchd service)
> 3. Enable **Notes** and **Calendar** for that app
>
> macOS will also prompt you automatically on the first JXA call — just click Allow.

---

## Step 8 — Verify

Run these to confirm the integration works:

```bash
bun run src/tools/apple-native-cli.ts calendar events 7
bun run src/tools/apple-native-cli.ts notes list
```

If events and notes appear, you're done.

---

## Troubleshooting

**"Not authorized to send Apple events"**
- System Settings → Privacy & Security → Automation → enable Notes + Calendar

**Calendar name doesn't match**
- The default calendar name is "Jordan Family" — to use a different calendar,
  pass the name as the third argument: `getAppleCalendarEvents(start, end, "My Calendar")`
- Or update the default in `apple-native.ts` line 338

**Notes search is slow with large libraries**
- JXA scans every note sequentially; with 1000+ notes expect 3-5 seconds
- Filter by folder to narrow the search

**"Apple Native integration requires macOS"**
- This integration is gated on `isAppleNativeEnabled()` which returns false on Linux (VPS)
- The VPS fallback (anthropic-processor) simply won't include calendar context — no error
