/**
 * Apple Native — JXA wrappers for Apple Notes and Apple Calendar
 *
 * Uses osascript (JavaScript for Automation) to read/write Notes.app
 * and read Calendar.app events. Fully local — no API keys, no auth tokens,
 * no network calls. macOS only.
 *
 * Requires one-time Automation permission:
 *   System Settings → Privacy & Security → Automation
 *   → grant Terminal (or the launchd service) access to Notes and Calendar
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

export interface CalEvent {
  title: string;
  start: string;     // ISO string
  end: string;       // ISO string
  calendar: string;  // calendar name
  location: string;
  notes: string;
  isAllDay: boolean;
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
      try {
        const pt = n.plaintext();
        snippet = pt ? pt.substring(0, 100).replace(/\\n/g, ' ') : '';
      } catch(e) {}
      result.push({
        id: n.id(),
        name: n.name(),
        folder: n.container ? n.container.name() : '',
        modifiedAt: n.modificationDate().toISOString(),
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
    return [];
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
      try {
        body = note.plaintext() || '';
        snippet = body.substring(0, 100).replace(/\\n/g, ' ');
      } catch(e) {}
      JSON.stringify({
        id: note.id(),
        name: note.name(),
        folder: note.container ? note.container.name() : '',
        modifiedAt: note.modificationDate().toISOString(),
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
    return null;
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
      try { pt = n.plaintext() || ''; } catch(e) {}
      if (name.includes(q) || pt.toLowerCase().includes(q)) {
        let snippet = pt.substring(0, 100).replace(/\\n/g, ' ');
        result.push({
          id: n.id(),
          name: n.name(),
          folder: n.container ? n.container.name() : '',
          modifiedAt: n.modificationDate().toISOString(),
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
    return [];
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
// Calendar — Read Operations
// ---------------------------------------------------------------------------

/**
 * Fetch events from Apple Calendar in a date range.
 * Filters to the "Jordan Family" calendar by default.
 * Returns empty array on VPS / non-macOS.
 */
export async function getAppleCalendarEvents(
  start: Date,
  end: Date,
  calendarName = "Jordan Family"
): Promise<CalEvent[]> {
  if (!isAppleNativeEnabled()) return [];

  const escapedCal = escapeJxa(calendarName);
  const startISO = start.toISOString();
  const endISO = end.toISOString();

  const script = `
    const app = Application('Calendar');
    app.includeStandardAdditions = true;
    const calName = '${escapedCal}';
    const startDate = new Date('${startISO}');
    const endDate = new Date('${endISO}');

    // Find the target calendar(s) — support multiple matching names
    const allCals = app.calendars();
    const targetCals = allCals.filter(c => {
      try { return c.name() === calName; } catch(e) { return false; }
    });

    // If named calendar not found, use all calendars
    const cals = targetCals.length > 0 ? targetCals : allCals;

    const result = [];
    for (const cal of cals) {
      const calTitle = (function() { try { return cal.name(); } catch(e) { return ''; } })();
      let events = [];
      try { events = cal.events(); } catch(e) { continue; }
      for (const evt of events) {
        try {
          const evtStart = evt.startDate();
          const evtEnd = evt.endDate();
          if (!evtStart || !evtEnd) continue;
          if (evtEnd < startDate || evtStart > endDate) continue;
          let loc = '';
          let notes = '';
          let allDay = false;
          try { loc = evt.location() || ''; } catch(e) {}
          try { notes = evt.description() || ''; } catch(e) {}
          try { allDay = evt.alldayEvent(); } catch(e) {}
          result.push({
            title: evt.summary(),
            start: evtStart.toISOString(),
            end: evtEnd.toISOString(),
            calendar: calTitle,
            location: loc,
            notes: notes.substring(0, 200),
            isAllDay: allDay
          });
        } catch(e) {}
      }
    }
    // Sort by start
    result.sort((a, b) => new Date(a.start) - new Date(b.start));
    JSON.stringify(result);
  `;

  try {
    const data = await runJxa(script);
    if (!Array.isArray(data)) return [];
    return data as CalEvent[];
  } catch (err) {
    console.error("getAppleCalendarEvents error:", err);
    return [];
  }
}

/**
 * Format Apple Calendar events into a human-readable string.
 * Returns empty string if no events.
 */
export function formatAppleCalendarEvents(events: CalEvent[], label: string): string {
  if (events.length === 0) return `No Apple Calendar events ${label}.`;

  const tz = process.env.USER_TIMEZONE || "America/Chicago";
  const isMultiDay = events.some((e) => {
    const d = new Date(e.start).toDateString();
    return d !== new Date(events[0].start).toDateString();
  });

  let currentDate = "";
  const lines: string[] = [];

  for (const evt of events) {
    const evtDate = new Date(evt.start).toLocaleDateString("en-US", {
      timeZone: tz,
      weekday: "short",
      month: "short",
      day: "numeric",
    });

    if (isMultiDay && evtDate !== currentDate) {
      currentDate = evtDate;
      lines.push(`\n${evtDate}:`);
    }

    const calTag = evt.calendar ? ` [${evt.calendar}]` : "";
    if (evt.isAllDay) {
      lines.push(`- [All Day] ${evt.title}${calTag}`);
    } else {
      const startTime = new Date(evt.start).toLocaleTimeString("en-US", {
        timeZone: tz,
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
      });
      const endTime = new Date(evt.end).toLocaleTimeString("en-US", {
        timeZone: tz,
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
      });
      let line = `- ${startTime}-${endTime}: ${evt.title}`;
      if (evt.location) line += ` (${evt.location})`;
      line += calTag;
      lines.push(line);
    }
  }

  return lines.join("\n").trim();
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
