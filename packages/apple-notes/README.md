# Apple Notes (Local macOS)

Connect your bot to **Apple Notes.app** with a fully local integration. Your bot can list, read, search, create, and append notes directly on your Mac.

Uses macOS Automation (JavaScript for Automation / JXA) via `osascript`.
No API keys, OAuth flow, or cloud API setup required.

---

## Requirements

- macOS (recent version)
- Notes.app (built into macOS)
- One-time Automation permission in System Settings
- Bot processing on your local Mac (not VPS-only)

---

## Setup

1. Grant Automation permission:
- Open `System Settings -> Privacy & Security -> Automation`
- Find the app running your bot (Terminal/iTerm2/launchd service)
- Enable **Notes**

2. Install tool files:
- `src/apple-native.ts` -> your bot `src/lib/apple-native.ts`
- `src/apple-native-cli.ts` -> your bot `src/tools/apple-native-cli.ts`

Or from your bot repo:

```bash
gobot-tools install apple-notes
```

3. Open `prompt.md` and tell Claude Code:

`Set up Apple Notes integration`

---

## CLI Commands

```bash
bun run src/tools/apple-native-cli.ts notes list [FOLDER] [LIMIT]
bun run src/tools/apple-native-cli.ts notes read <NAME_OR_ID>
bun run src/tools/apple-native-cli.ts notes search <QUERY>
bun run src/tools/apple-native-cli.ts notes create <TITLE> <BODY> [FOLDER]
bun run src/tools/apple-native-cli.ts notes append <NAME_OR_ID> <TEXT>
```

---

## Privacy

- No API keys, tokens, or passwords
- No external network calls in this integration
- Data is read directly from local Notes.app at runtime
- No persistent storage written by this library

---

## Update

```bash
gobot-tools update apple-notes
```
