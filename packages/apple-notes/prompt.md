# Apple Notes Setup

You are helping the user add Apple Notes support to their bot.
This integration runs locally on macOS via JXA (`osascript`) and does not require API keys.
Follow these steps in order.

## 1. Inspect current project state

Check whether these files already exist:
- `src/lib/apple-native.ts`
- `src/tools/apple-native-cli.ts`
- `src/bot.ts` imports/handlers for Apple Notes

Summarize what exists and what you will add or update.

## 2. Install library files

Copy:
- `packages/apple-notes/src/apple-native.ts` -> `src/lib/apple-native.ts`
- `packages/apple-notes/src/apple-native-cli.ts` -> `src/tools/apple-native-cli.ts`

The library should provide:
- `isAppleNativeEnabled()`
- `listNotes(folder?, limit?)`
- `readNote(nameOrId)`
- `searchNotes(query, limit?)`
- `createNote(title, body, folder?)`
- `appendToNote(nameOrId, text)`
- `formatNoteList(notes)`

## 3. Wire bot handlers

In `src/bot.ts`:
- Import Apple Notes helpers from `./lib/apple-native`
- Add intercepts for natural language notes requests before generic Claude processing
- Support at minimum:
  - list notes
  - read/open note by name
  - search notes
  - create note
  - append to note

Keep behavior macOS-gated via `isAppleNativeEnabled()`.

## 4. Add (or verify) CLI usage docs

Ensure the project can run these commands:

```bash
bun run src/tools/apple-native-cli.ts notes list
bun run src/tools/apple-native-cli.ts notes read "<name>"
bun run src/tools/apple-native-cli.ts notes search "<query>"
```

## 5. Permissions reminder

Tell the user to enable Automation once:
- `System Settings -> Privacy & Security -> Automation`
- Enable **Notes** for the app running the bot process

## 6. Verify

Run a quick local smoke test with `notes list` and one read/search command.
If a test cannot run in the current environment, explain exactly why.

## Guardrails

- Do not add unrelated scheduling functionality.
- Do not add or request API keys/tokens for this tool.
- Keep all instructions generic (no personal/private identifiers).
