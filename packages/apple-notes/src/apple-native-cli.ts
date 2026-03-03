#!/usr/bin/env bun
/**
 * Apple Native CLI — JXA-based Apple Notes operations.
 *
 * Usage:
 *   bun run src/tools/apple-native-cli.ts notes list [FOLDER] [LIMIT]
 *   bun run src/tools/apple-native-cli.ts notes read <NAME_OR_ID>
 *   bun run src/tools/apple-native-cli.ts notes search <QUERY>
 *   bun run src/tools/apple-native-cli.ts notes create <TITLE> <BODY> [FOLDER]
 *   bun run src/tools/apple-native-cli.ts notes append <NAME_OR_ID> <TEXT>
 */

import { join } from "path";
import { existsSync, readFileSync } from "fs";

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
  formatNoteList,
} from "../lib/apple-native";

const [resource, cmd, ...args] = process.argv.slice(2);

function printHelp() {
  console.log(`Apple Native CLI — JXA-based Apple Notes

Usage:
  notes list [FOLDER] [LIMIT]           List notes (default limit: 20)
  notes read <NAME_OR_ID>               Read a note's full content
  notes search <QUERY>                  Search notes by keyword
  notes create <TITLE> <BODY> [FOLDER]  Create a new note
  notes append <NAME_OR_ID> <TEXT>      Append text to an existing note

Notes:
  - macOS only (uses osascript / JXA)
  - Requires Automation permission: System Settings -> Privacy -> Automation`);
}

async function main() {
  if (!isAppleNativeEnabled()) {
    console.error("Error: Apple Native integration requires macOS.");
    process.exit(1);
  }

  if (resource !== "notes") {
    printHelp();
    return;
  }

  switch (cmd) {
    case "list": {
      const folder = args[0] && !parseInt(args[0], 10) ? args[0] : undefined;
      const limit = parseInt(folder ? args[1] : args[0], 10) || 20;
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
      if (!query) {
        console.error("Usage: notes read <NAME_OR_ID>");
        process.exit(1);
      }
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
      if (!query) {
        console.error("Usage: notes search <QUERY>");
        process.exit(1);
      }
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
      if (!title) {
        console.error("Usage: notes create <TITLE> <BODY> [FOLDER]");
        process.exit(1);
      }
      let body: string;
      let folder: string | undefined;
      if (rest.length >= 2) {
        folder = rest[rest.length - 1];
        body = rest.slice(0, -1).join(" ");
      } else {
        body = rest.join(" ");
      }
      if (!body) {
        console.error("Usage: notes create <TITLE> <BODY> [FOLDER]");
        process.exit(1);
      }
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
}

main().catch((err) => {
  console.error("Error:", err.message || err);
  process.exit(1);
});
