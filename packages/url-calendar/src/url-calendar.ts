/**
 * URL Calendar (ICS)
 *
 * Reads public/private calendar feed URLs (webcal/https .ics) and formats
 * events for bot responses. No macOS Automation needed.
 */

export interface UrlCalendarEvent {
  uid?: string;
  summary: string;
  location?: string;
  start: Date;
  end: Date;
  allDay: boolean;
}

interface ParsedIcsEvent {
  uid?: string;
  summary: string;
  location?: string;
  dtstart?: string;
  dtend?: string;
  rrule?: string;
}

function normalizeCalendarUrl(url: string): string {
  const trimmed = url.trim();
  if (trimmed.startsWith("webcal://")) {
    return `https://${trimmed.slice("webcal://".length)}`;
  }
  return trimmed;
}

function unfoldIcsLines(raw: string): string[] {
  const normalized = raw.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const lines = normalized.split("\n");
  const out: string[] = [];
  for (const line of lines) {
    if ((line.startsWith(" ") || line.startsWith("\t")) && out.length > 0) {
      out[out.length - 1] += line.slice(1);
    } else {
      out.push(line);
    }
  }
  return out;
}

function unescapeIcsText(text: string): string {
  return text
    .replace(/\\n/gi, "\n")
    .replace(/\\,/g, ",")
    .replace(/\\;/g, ";")
    .replace(/\\\\/g, "\\");
}

function parseIcsDate(value: string): { date: Date | null; allDay: boolean } {
  const v = value.trim();

  if (/^\d{8}$/.test(v)) {
    const year = Number(v.slice(0, 4));
    const month = Number(v.slice(4, 6));
    const day = Number(v.slice(6, 8));
    return { date: new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0)), allDay: true };
  }

  if (/^\d{8}T\d{6}Z$/.test(v)) {
    const year = Number(v.slice(0, 4));
    const month = Number(v.slice(4, 6));
    const day = Number(v.slice(6, 8));
    const hour = Number(v.slice(9, 11));
    const minute = Number(v.slice(11, 13));
    const second = Number(v.slice(13, 15));
    return { date: new Date(Date.UTC(year, month - 1, day, hour, minute, second, 0)), allDay: false };
  }

  if (/^\d{8}T\d{6}$/.test(v)) {
    const year = Number(v.slice(0, 4));
    const month = Number(v.slice(4, 6));
    const day = Number(v.slice(6, 8));
    const hour = Number(v.slice(9, 11));
    const minute = Number(v.slice(11, 13));
    const second = Number(v.slice(13, 15));
    // Floating local time (no TZ suffix). Treat as local wall time.
    return { date: new Date(year, month - 1, day, hour, minute, second, 0), allDay: false };
  }

  return { date: null, allDay: false };
}

function parseIcsEvents(icsText: string): ParsedIcsEvent[] {
  const lines = unfoldIcsLines(icsText);
  const events: ParsedIcsEvent[] = [];
  let current: ParsedIcsEvent | null = null;

  for (const line of lines) {
    if (line === "BEGIN:VEVENT") {
      current = { summary: "(No title)" };
      continue;
    }

    if (line === "END:VEVENT") {
      if (current) events.push(current);
      current = null;
      continue;
    }

    if (!current) continue;

    const sep = line.indexOf(":");
    if (sep <= 0) continue;
    const rawKey = line.slice(0, sep);
    const value = line.slice(sep + 1);
    const key = rawKey.split(";")[0].toUpperCase();

    switch (key) {
      case "SUMMARY":
        current.summary = unescapeIcsText(value).trim() || "(No title)";
        break;
      case "LOCATION":
        current.location = unescapeIcsText(value).trim();
        break;
      case "DTSTART":
        current.dtstart = value.trim();
        break;
      case "DTEND":
        current.dtend = value.trim();
        break;
      case "RRULE":
        current.rrule = value.trim();
        break;
      case "UID":
        current.uid = value.trim();
        break;
      default:
        break;
    }
  }

  return events;
}

function overlaps(start: Date, end: Date, rangeStart: Date, rangeEnd: Date): boolean {
  return end >= rangeStart && start <= rangeEnd;
}

function formatTime(dt: Date, tz: string): string {
  return dt.toLocaleTimeString("en-US", {
    timeZone: tz,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

function toEvent(raw: ParsedIcsEvent): UrlCalendarEvent | null {
  if (!raw.dtstart) return null;

  const startParsed = parseIcsDate(raw.dtstart);
  if (!startParsed.date) return null;

  const endParsed = raw.dtend ? parseIcsDate(raw.dtend) : { date: null, allDay: startParsed.allDay };

  let end = endParsed.date;
  if (!end) {
    if (startParsed.allDay) {
      end = new Date(startParsed.date.getTime() + 24 * 60 * 60 * 1000);
    } else {
      end = new Date(startParsed.date.getTime() + 60 * 60 * 1000);
    }
  }

  return {
    uid: raw.uid,
    summary: raw.summary || "(No title)",
    location: raw.location,
    start: startParsed.date,
    end,
    allDay: startParsed.allDay,
  };
}

function parseRRule(rrule: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of rrule.split(";")) {
    const [k, v] = part.split("=");
    if (!k || !v) continue;
    out[k.toUpperCase()] = v;
  }
  return out;
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

function startOfWeekSunday(d: Date): Date {
  const x = new Date(d.getTime());
  const dow = x.getDay();
  x.setHours(0, 0, 0, 0);
  return addDays(x, -dow);
}

function expandRecurringEvent(
  raw: ParsedIcsEvent,
  rangeStart: Date,
  rangeEnd: Date,
): UrlCalendarEvent[] {
  const base = toEvent(raw);
  if (!base || !raw.rrule) return [];

  const r = parseRRule(raw.rrule);
  const freq = (r.FREQ || "").toUpperCase();
  const interval = Number(r.INTERVAL || "1") || 1;
  const countLimit = r.COUNT ? Number(r.COUNT) : undefined;
  const until = r.UNTIL ? parseIcsDate(r.UNTIL).date : null;
  const durationMs = base.end.getTime() - base.start.getTime();

  const out: UrlCalendarEvent[] = [];
  let emitted = 0;

  const pushOccurrence = (start: Date) => {
    const end = new Date(start.getTime() + durationMs);
    if (until && start > until) return false;
    if (countLimit && emitted >= countLimit) return false;
    emitted++;
    if (overlaps(start, end, rangeStart, rangeEnd)) {
      out.push({
        uid: base.uid,
        summary: base.summary,
        location: base.location,
        start,
        end,
        allDay: base.allDay,
      });
    }
    return true;
  };

  if (freq === "DAILY") {
    let cur = new Date(base.start.getTime());
    while (cur <= rangeEnd) {
      if (!pushOccurrence(cur)) break;
      cur = addDays(cur, interval);
      if (countLimit && emitted >= countLimit) break;
      if (until && cur > until) break;
      // Guard against runaway loops on malformed rules.
      if (emitted > 5000) break;
    }
    return out;
  }

  if (freq === "WEEKLY") {
    const byday = (r.BYDAY || "")
      .split(",")
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean);
    const dowMap: Record<string, number> = {
      SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6,
    };
    const targetDows = byday.length > 0
      ? byday.map((d) => dowMap[d]).filter((n) => Number.isInteger(n))
      : [base.start.getDay()];

    let weekStart = startOfWeekSunday(base.start);
    const timeOfDayMs =
      (((base.start.getHours() * 60 + base.start.getMinutes()) * 60 + base.start.getSeconds()) * 1000) +
      base.start.getMilliseconds();

    while (weekStart <= rangeEnd) {
      for (const dow of targetDows) {
        const day = addDays(weekStart, dow);
        const start = new Date(day.getTime() + timeOfDayMs);
        if (start < base.start) continue;
        if (!pushOccurrence(start)) return out;
      }
      weekStart = addDays(weekStart, 7 * interval);
      if (countLimit && emitted >= countLimit) break;
      if (until && weekStart > addDays(until, 7)) break;
      if (emitted > 5000) break;
    }
  }

  return out;
}

async function fetchIcs(url: string): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8_000);

  try {
    const res = await fetch(normalizeCalendarUrl(url), {
      method: "GET",
      signal: controller.signal,
      headers: {
        Accept: "text/calendar,text/plain,*/*",
        "User-Agent": "go-telegram-bot/2.0 (calendar-url)",
      },
    });

    if (!res.ok) {
      throw new Error(`Calendar URL fetch failed (${res.status})`);
    }

    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

export function isUrlCalendarEnabled(): boolean {
  return !!(process.env.APPLE_CALENDAR_URL || process.env.APPLE_CALENDAR_URLS || process.env.CALENDAR_URL);
}

function getConfiguredUrls(): string[] {
  const combined = [
    process.env.APPLE_CALENDAR_URL || "",
    process.env.CALENDAR_URL || "",
    process.env.APPLE_CALENDAR_URLS || "",
  ]
    .filter(Boolean)
    .join(",");

  return [...new Set(combined.split(",").map((s) => s.trim()).filter(Boolean))];
}

export async function getUrlCalendarEvents(start: Date, end: Date, label = "today"): Promise<string> {
  const urls = getConfiguredUrls();
  if (urls.length === 0) return "Not configured.";

  const tz = process.env.USER_TIMEZONE || "America/Chicago";
  const events: UrlCalendarEvent[] = [];

  for (const url of urls) {
    const ics = await fetchIcs(url);
    const parsed = parseIcsEvents(ics);
    for (const raw of parsed) {
      if (raw.rrule) {
        for (const evt of expandRecurringEvent(raw, start, end)) {
          if (evt.uid?.includes("-DUP")) continue;
          events.push(evt);
        }
      } else {
        const evt = toEvent(raw);
        if (!evt) continue;
        if (evt.uid?.includes("-DUP")) continue;
        if (!overlaps(evt.start, evt.end, start, end)) continue;
        events.push(evt);
      }
    }
  }

  events.sort((a, b) => a.start.getTime() - b.start.getTime());

  if (events.length === 0) return `No events scheduled ${label}.`;

  const lines = events.map((evt) => {
    const time = evt.allDay ? "[All Day]" : `${formatTime(evt.start, tz)}-${formatTime(evt.end, tz)}`;
    let line = `- ${time}: ${evt.summary}`;
    if (evt.location) {
      const loc = evt.location.replace(/\s+/g, " ").trim();
      if (loc) line += ` (${loc})`;
    }
    return line;
  });

  return lines.join("\n");
}
