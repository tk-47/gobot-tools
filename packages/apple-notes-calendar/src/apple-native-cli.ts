#!/usr/bin/env bun
/**
 * Apple Native CLI — JXA-based Apple Notes and Calendar operations.
 *
 * Usage:
 *   bun run src/tools/apple-native-cli.ts notes list [FOLDER] [LIMIT]
 *   bun run src/tools/apple-native-cli.ts notes read <NAME_OR_ID>
 *   bun run src/tools/apple-native-cli.ts notes search <QUERY>
 *   bun run src/tools/apple-native-cli.ts notes create <TITLE> <BODY> [FOLDER]
 *   bun run src/tools/apple-native-cli.ts notes append <NAME_OR_ID> <TEXT>
 *   bun run src/tools/apple-native-cli.ts calendar events [DAYS]
 *   bun run src/tools/apple-native-cli.ts calendar search <QUERY>
 *
 * Requires macOS with Automation permission granted to Terminal.
 */

import { join } from "path";
import { existsSync, readFileSync } from "fs";

// Load .env
const PROJECT_ROOT = process.env.GO_PROJECT_ROOT || join(import.meta.dir, "../..");
const envPath = join(PROJECT_ROOT, ".env");
if (existsSync(envPath)) {
  readFileSync(envPath, "utf-8")
    .split("\n")
    .forEach((line) => {
      const [key, ...valueParts] = line.split("=");
      if (key && valueParts.length > 0 && !key.trim().startsWith("#")) {
        process.env[key.trim()] = valueParts.join("=").trim();
      }
    });
}

import {
  isAppleNativeEnabled,
  listNotes,
  readNote,
  searchNotes,
  createNote,
  appendToNote,
  getAppleCalendarEvents,
  formatAppleCalendarEvents,
  formatNoteList,
} from "../lib/apple-native";

const [resource, cmd, ...args] = process.argv.slice(2);

function printHelp() {
  console.log(`Apple Native CLI — JXA-based Apple Notes and Calendar

Usage:
  notes list [FOLDER] [LIMIT]        List notes (default limit: 20)
  notes read <NAME_OR_ID>            Read a note's full content
  notes search <QUERY>               Search notes by keyword
  notes create <TITLE> <BODY>        Create a new note
  notes create <TITLE> <BODY> <FOLDER>  Create in a specific folder
  notes append <NAME_OR_ID> <TEXT>   Append text to an existing note
  calendar events [DAYS]             List Apple Calendar events (default: 7 days)
  calendar search <QUERY>            Find events containing text (next 30 days)

Notes:
  - macOS only (uses osascript / JXA)
  - Requires Automation permission: System Settings → Privacy → Automation
  - Calendar reads from "Jordan Family" calendar by default`);
}

async function main() {
  if (!isAppleNativeEnabled()) {
    console.error("Error: Apple Native integration requires macOS.");
    process.exit(1);
  }

  if (resource === "notes") {
    switch (cmd) {
      case "list": {
        const folder = args[0] && !parseInt(args[0]) ? args[0] : undefined;
        const limit = parseInt(folder ? args[1] : args[0]) || 20;
        const notes = await listNotes(folder, limit);
        if (notes.length === 0) {
          console.log(folder ? `No notes in folder "${folder}".` : "No notes found.");
        } else {
          console.log(`${notes.length} note${notes.length === 1 ? "" : "s"}${folder ? ` in "${folder}"` : ""}:\n`);
          for (const n of notes) {
            const mod = new Date(n.modifiedAt).toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
              year: "numeric",
            });
            console.log(`  ${n.name}`);
            if (n.folder) console.log(`    Folder:   ${n.folder}`);
            console.log(`    Modified: ${mod}`);
            if (n.snippet) console.log(`    Preview:  ${n.snippet}`);
            console.log();
          }
        }
        break;
      }

      case "read": {
        const query = args.join(" ");
        if (!query) { console.error("Usage: notes read <NAME_OR_ID>"); process.exit(1); }
        const note = await readNote(query);
        if (!note) {
          console.log(`Note not found: "${query}"`);
        } else {
          console.log(`=== ${note.name} ===`);
          if (note.folder) console.log(`Folder: ${note.folder}`);
          console.log(`Modified: ${new Date(note.modifiedAt).toLocaleString()}`);
          console.log();
          console.log(note.body);
        }
        break;
      }

      case "search": {
        const query = args.join(" ");
        if (!query) { console.error("Usage: notes search <QUERY>"); process.exit(1); }
        const notes = await searchNotes(query, 10);
        if (notes.length === 0) {
          console.log(`No notes matching "${query}".`);
        } else {
          console.log(`${notes.length} note${notes.length === 1 ? "" : "s"} matching "${query}":\n`);
          console.log(formatNoteList(notes));
        }
        break;
      }

      case "create": {
        const [title, ...rest] = args;
        if (!title) { console.error("Usage: notes create <TITLE> <BODY> [FOLDER]"); process.exit(1); }
        // Last arg is folder if it looks like a folder name (no spaces in folder names is convention)
        // Simple heuristic: if 3+ args, last arg is folder
        let body: string;
        let folder: string | undefined;
        if (rest.length >= 2) {
          folder = rest[rest.length - 1];
          body = rest.slice(0, -1).join(" ");
        } else {
          body = rest.join(" ");
        }
        if (!body) { console.error("Usage: notes create <TITLE> <BODY> [FOLDER]"); process.exit(1); }
        const result = await createNote(title, body, folder);
        console.log(`Note created: "${result.name}" (id: ${result.id})`);
        break;
      }

      case "append": {
        const [nameOrId, ...textParts] = args;
        if (!nameOrId || textParts.length === 0) {
          console.error("Usage: notes append <NAME_OR_ID> <TEXT>");
          process.exit(1);
        }
        const text = textParts.join(" ");
        const ok = await appendToNote(nameOrId, text);
        console.log(ok ? `Appended to note "${nameOrId}".` : `Note not found: "${nameOrId}"`);
        break;
      }

      default:
        printHelp();
    }
  } else if (resource === "calendar") {
    switch (cmd) {
      case "events": {
        const days = parseInt(args[0] || "7", 10);
        const start = new Date();
        const end = new Date(start.getTime() + days * 86_400_000);
        start.setHours(0, 0, 0, 0);
        end.setHours(23, 59, 59, 999);
        const events = await getAppleCalendarEvents(start, end);
        const label = `next ${days} day${days === 1 ? "" : "s"}`;
        if (events.length === 0) {
          console.log(`No Apple Calendar events in the ${label}.`);
        } else {
          console.log(`Apple Calendar — ${label}:\n`);
          console.log(formatAppleCalendarEvents(events, label));
        }
        break;
      }

      case "search": {
        const query = args.join(" ").toLowerCase();
        if (!query) { console.error("Usage: calendar search <QUERY>"); process.exit(1); }
        const start = new Date();
        const end = new Date(start.getTime() + 30 * 86_400_000);
        const events = await getAppleCalendarEvents(start, end);
        const matches = events.filter(
          (e) =>
            e.title.toLowerCase().includes(query) ||
            e.location.toLowerCase().includes(query) ||
            e.notes.toLowerCase().includes(query)
        );
        if (matches.length === 0) {
          console.log(`No Apple Calendar events matching "${query}" in the next 30 days.`);
        } else {
          console.log(`${matches.length} event${matches.length === 1 ? "" : "s"} matching "${query}":\n`);
          console.log(formatAppleCalendarEvents(matches, "next 30 days"));
        }
        break;
      }

      default:
        printHelp();
    }
  } else {
    printHelp();
  }
}

main().catch((err) => {
  console.error("Error:", err.message || err);
  process.exit(1);
});
