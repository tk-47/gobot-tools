/**
 * Apple Native — JXA wrappers for Apple Notes
 *
 * Uses osascript (JavaScript for Automation) to read/write Notes.app
 * Fully local — no API keys, no auth tokens,
 * no network calls. macOS only.
 *
 * Requires one-time Automation permission:
 *   System Settings → Privacy & Security → Automation
 *   → grant Terminal (or the launchd service) access to Notes
 */

import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface NoteItem {
  id: string;
  name: string;
  folder: string;
  modifiedAt: string; // ISO string
  snippet: string;    // first ~100 chars of plaintext
}

export interface NoteDetail extends NoteItem {
  body: string; // full plaintext content
}


// ---------------------------------------------------------------------------
// Internal: JXA runner
// ---------------------------------------------------------------------------

/**
 * Escape a user-supplied string for safe embedding inside JXA single-quoted strings.
 * Escapes backslashes, single quotes, double quotes, newlines, and tabs.
 */
export function escapeJxa(str: string): string {
  return str
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t");
}

async function runJxa(script: string): Promise<any> {
  const { stdout, stderr } = await execFileAsync(
    "osascript",
    ["-l", "JavaScript", "-e", script],
    { timeout: 15_000, maxBuffer: 10 * 1024 * 1024 }
  );

  if (stderr && stderr.trim()) {
    const errText = stderr.trim();
    // osascript sometimes writes non-fatal warnings to stderr
    if (errText.toLowerCase().includes("error")) {
      throw new Error(`JXA error: ${errText}`);
    }
  }

  const raw = stdout.trim();
  if (!raw) return null;

  // osascript returns JSON when you JSON.stringify() in JXA
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

// ---------------------------------------------------------------------------
// Availability Check
// ---------------------------------------------------------------------------

/**
 * Returns true only on macOS (darwin). All JXA calls are gated on this.
 */
export function isAppleNativeEnabled(): boolean {
  return process.platform === "darwin";
}

// ---------------------------------------------------------------------------
// Notes — Read Operations
// ---------------------------------------------------------------------------

/**
 * List notes with optional folder filter and limit.
 * Returns lightweight items (no full body) for quick display.
 */
export async function listNotes(folder?: string, limit = 20): Promise<NoteItem[]> {
  const folderFilter = folder ? `'${escapeJxa(folder)}'` : "null";
  const script = `
    const app = Application('Notes');
    app.includeStandardAdditions = true;
    const filterFolder = ${folderFilter};
    let notes = [];
    if (filterFolder) {
      const folders = app.folders.whose({ name: filterFolder });
      if (folders.length > 0) {
        notes = folders[0].notes();
      }
    } else {
      notes = app.notes();
    }
    const limit = ${limit};
    const result = [];
    for (let i = 0; i < Math.min(notes.length, limit); i++) {
      const n = notes[i];
      let snippet = '';
      let folderName = '';
      let modifiedAt = new Date(0).toISOString();
      try {
        const pt = n.plaintext();
        snippet = pt ? pt.substring(0, 100).replace(/\\n/g, ' ') : '';
      } catch(e) {}
      try { folderName = n.container && n.container.name ? (n.container.name() || '') : ''; } catch(e) {}
      try {
        const md = n.modificationDate && n.modificationDate();
        modifiedAt = md && md.toISOString ? md.toISOString() : modifiedAt;
      } catch(e) {}
      result.push({
        id: n.id(),
        name: n.name(),
        folder: folderName,
        modifiedAt: modifiedAt,
        snippet: snippet
      });
    }
    JSON.stringify(result);
  `;

  try {
    const data = await runJxa(script);
    if (!Array.isArray(data)) return [];
    return data as NoteItem[];
  } catch (err) {
    console.error("listNotes error:", err);
    throw err;
  }
}

/**
 * Read a single note's full content by name (partial match) or JXA id.
 * Returns null if not found.
 */
export async function readNote(nameOrId: string): Promise<NoteDetail | null> {
  const escaped = escapeJxa(nameOrId);
  const script = `
    const app = Application('Notes');
    app.includeStandardAdditions = true;
    let note = null;
    // Try exact name match first
    const byName = app.notes.whose({ name: '${escaped}' });
    if (byName.length > 0) {
      note = byName[0];
    } else {
      // Try case-insensitive partial name match
      const all = app.notes();
      const lower = '${escaped}'.toLowerCase();
      for (const n of all) {
        if (n.name().toLowerCase().includes(lower)) {
          note = n;
          break;
        }
      }
    }
    if (!note) {
      JSON.stringify(null);
    } else {
      let body = '';
      let snippet = '';
      let folderName = '';
      let modifiedAt = new Date(0).toISOString();
      try {
        body = note.plaintext() || '';
        snippet = body.substring(0, 100).replace(/\\n/g, ' ');
      } catch(e) {}
      try { folderName = note.container && note.container.name ? (note.container.name() || '') : ''; } catch(e) {}
      try {
        const md = note.modificationDate && note.modificationDate();
        modifiedAt = md && md.toISOString ? md.toISOString() : modifiedAt;
      } catch(e) {}
      JSON.stringify({
        id: note.id(),
        name: note.name(),
        folder: folderName,
        modifiedAt: modifiedAt,
        snippet: snippet,
        body: body
      });
    }
  `;

  try {
    const data = await runJxa(script);
    if (!data) return null;
    return data as NoteDetail;
  } catch (err) {
    console.error("readNote error:", err);
    throw err;
  }
}

/**
 * Search notes by keyword (matches name or body content).
 */
export async function searchNotes(query: string, limit = 10): Promise<NoteItem[]> {
  const escaped = escapeJxa(query);
  const script = `
    const app = Application('Notes');
    app.includeStandardAdditions = true;
    const q = '${escaped}'.toLowerCase();
    const all = app.notes();
    const result = [];
    for (const n of all) {
      if (result.length >= ${limit}) break;
      const name = n.name().toLowerCase();
      let pt = '';
      let folderName = '';
      let modifiedAt = new Date(0).toISOString();
      try { pt = n.plaintext() || ''; } catch(e) {}
      if (name.includes(q) || pt.toLowerCase().includes(q)) {
        let snippet = pt.substring(0, 100).replace(/\\n/g, ' ');
        try { folderName = n.container && n.container.name ? (n.container.name() || '') : ''; } catch(e) {}
        try {
          const md = n.modificationDate && n.modificationDate();
          modifiedAt = md && md.toISOString ? md.toISOString() : modifiedAt;
        } catch(e) {}
        result.push({
          id: n.id(),
          name: n.name(),
          folder: folderName,
          modifiedAt: modifiedAt,
          snippet: snippet
        });
      }
    }
    JSON.stringify(result);
  `;

  try {
    const data = await runJxa(script);
    if (!Array.isArray(data)) return [];
    return data as NoteItem[];
  } catch (err) {
    console.error("searchNotes error:", err);
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Notes — Write Operations
// ---------------------------------------------------------------------------

/**
 * Create a new note. Returns the new note's id and name.
 */
export async function createNote(
  title: string,
  body: string,
  folder?: string
): Promise<{ id: string; name: string }> {
  const escapedTitle = escapeJxa(title);
  const escapedBody = escapeJxa(body);

  const containerPart = folder
    ? `const folders = app.folders.whose({ name: '${escapeJxa(folder)}' });
       const container = folders.length > 0 ? folders[0] : app.defaultAccount;`
    : `const container = app.defaultAccount;`;

  const script = `
    const app = Application('Notes');
    app.includeStandardAdditions = true;
    ${containerPart}
    const note = app.Note({
      name: '${escapedTitle}',
      body: '<div><b>${escapedTitle}</b></div><div>${escapedBody}</div>'
    });
    container.notes.push(note);
    JSON.stringify({ id: note.id(), name: note.name() });
  `;

  const data = await runJxa(script);
  if (!data || !data.id) throw new Error("createNote: no id returned");
  return data as { id: string; name: string };
}

/**
 * Append text to an existing note (found by name or id).
 * Returns true on success, false if note not found.
 */
export async function appendToNote(nameOrId: string, text: string): Promise<boolean> {
  const escapedQuery = escapeJxa(nameOrId);
  const escapedText = escapeJxa(text);
  const script = `
    const app = Application('Notes');
    app.includeStandardAdditions = true;
    let note = null;
    const byName = app.notes.whose({ name: '${escapedQuery}' });
    if (byName.length > 0) {
      note = byName[0];
    } else {
      const all = app.notes();
      const lower = '${escapedQuery}'.toLowerCase();
      for (const n of all) {
        if (n.name().toLowerCase().includes(lower)) {
          note = n;
          break;
        }
      }
    }
    if (!note) {
      JSON.stringify(false);
    } else {
      const existing = note.body() || '';
      note.body = existing + '<div>${escapedText}</div>';
      JSON.stringify(true);
    }
  `;

  try {
    const result = await runJxa(script);
    return result === true;
  } catch (err) {
    console.error("appendToNote error:", err);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Formatting Helpers for Bot Replies
// ---------------------------------------------------------------------------

export function formatNoteList(notes: NoteItem[]): string {
  if (notes.length === 0) return "No notes found.";
  return notes
    .map((n) => {
      const folder = n.folder ? ` [${n.folder}]` : "";
      const snippet = n.snippet ? ` — ${n.snippet}` : "";
      return `• **${n.name}**${folder}${snippet}`;
    })
    .join("\n");
}
