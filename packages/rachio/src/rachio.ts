/**
 * Rachio Irrigation API
 *
 * Thin wrapper around the Rachio Public REST API.
 * Auth: Bearer token via RACHIO_API_KEY env var.
 * Rate limit: 1,700 calls/day — status queries cached 60s.
 *
 * Docs: https://rachio.readme.io/docs
 */

const BASE_URL = "https://api.rach.io/1/public";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RachioZone {
  id: string;
  name: string;
  zoneNumber: number;
  enabled: boolean;
  customNozzle?: { runtimeNoMultiplier?: number };
  runtime?: number;
}

export interface RachioDevice {
  id: string;
  name: string;
  status: string;
  zones: RachioZone[];
  latitude?: number;
  longitude?: number;
  on?: boolean;
}

export interface RachioSchedule {
  id: string;
  name: string;
  enabled: boolean;
  startTime?: number;
  frequency?: string[];
  totalDuration?: number;
  zones?: { id: string; duration: number }[];
}

export interface RachioEvent {
  id: string;
  type: string;
  eventDate: number;
  summary: string;
}

export interface RachioWebhook {
  id: string;
  url: string;
  externalId?: string;
  eventTypes: { id: string }[];
}

// ---------------------------------------------------------------------------
// Enabled check
// ---------------------------------------------------------------------------

export function isRachioEnabled(): boolean {
  return Boolean(process.env.RACHIO_API_KEY);
}

// ---------------------------------------------------------------------------
// Internal fetch helper
// ---------------------------------------------------------------------------

async function rachioFetch(
  path: string,
  options: RequestInit = {}
): Promise<any> {
  const apiKey = process.env.RACHIO_API_KEY;
  if (!apiKey) throw new Error("RACHIO_API_KEY not set");

  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      ...(options.headers as Record<string, string>),
    },
  });

  // Log rate limit headers when close to limit
  const remaining = res.headers.get("X-RateLimit-Remaining");
  if (remaining !== null && parseInt(remaining) < 100) {
    console.warn(`[Rachio] Rate limit low: ${remaining} calls remaining today`);
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Rachio API ${res.status}: ${body || res.statusText}`);
  }

  if (res.status === 204) return null;
  return res.json();
}

// ---------------------------------------------------------------------------
// Simple 60-second cache for GET requests
// ---------------------------------------------------------------------------

const cache = new Map<string, { data: any; expiresAt: number }>();

async function cachedGet(path: string): Promise<any> {
  const now = Date.now();
  const cached = cache.get(path);
  if (cached && cached.expiresAt > now) return cached.data;
  const data = await rachioFetch(path);
  cache.set(path, { data, expiresAt: now + 60_000 });
  return data;
}

// ---------------------------------------------------------------------------
// Person / Device
// ---------------------------------------------------------------------------

export async function getPersonId(): Promise<string> {
  const data = await cachedGet("/person/info");
  return data.id as string;
}

export async function getDevices(): Promise<RachioDevice[]> {
  const personId = await getPersonId();
  const data = await cachedGet(`/person/${personId}`);
  return (data.devices || []) as RachioDevice[];
}

export async function getDeviceStatus(deviceId: string): Promise<RachioDevice> {
  const data = await cachedGet(`/device/${deviceId}`);
  return data as RachioDevice;
}

// ---------------------------------------------------------------------------
// Zone Control
// ---------------------------------------------------------------------------

export async function startZone(
  zoneId: string,
  durationSeconds: number
): Promise<void> {
  await rachioFetch("/zone/start", {
    method: "PUT",
    body: JSON.stringify({ id: zoneId, duration: durationSeconds }),
  });
}

export async function startMultipleZones(
  zones: { id: string; duration: number }[]
): Promise<void> {
  await rachioFetch("/zone/startMultiple", {
    method: "PUT",
    body: JSON.stringify({ zones }),
  });
}

export async function stopAllWatering(deviceId: string): Promise<void> {
  await rachioFetch("/device/stop_water", {
    method: "PUT",
    body: JSON.stringify({ id: deviceId }),
  });
}

export async function enableZone(zoneId: string): Promise<void> {
  await rachioFetch("/zone/enable", {
    method: "PUT",
    body: JSON.stringify({ id: zoneId }),
  });
}

export async function disableZone(zoneId: string): Promise<void> {
  await rachioFetch("/zone/disable", {
    method: "PUT",
    body: JSON.stringify({ id: zoneId }),
  });
}

// ---------------------------------------------------------------------------
// Schedule Management
// ---------------------------------------------------------------------------

export async function getSchedules(deviceId: string): Promise<RachioSchedule[]> {
  const data = await cachedGet(`/schedulerule?deviceId=${deviceId}`);
  return (Array.isArray(data) ? data : []) as RachioSchedule[];
}

export async function startSchedule(scheduleId: string): Promise<void> {
  await rachioFetch("/schedulerule/start", {
    method: "PUT",
    body: JSON.stringify({ id: scheduleId }),
  });
}

export async function skipSchedule(scheduleId: string): Promise<void> {
  await rachioFetch("/schedulerule/skip", {
    method: "PUT",
    body: JSON.stringify({ id: scheduleId }),
  });
}

/** percent: -100 to +100 (negative = reduce, positive = increase) */
export async function setSeasonalAdjustment(
  scheduleId: string,
  percent: number
): Promise<void> {
  await rachioFetch("/schedulerule/seasonal_adjustment", {
    method: "PUT",
    body: JSON.stringify({ id: scheduleId, adjustment: percent }),
  });
}

// ---------------------------------------------------------------------------
// Rain Delay / Pause
// ---------------------------------------------------------------------------

export async function setRainDelay(
  deviceId: string,
  durationSeconds: number
): Promise<void> {
  await rachioFetch("/device/rain_delay", {
    method: "PUT",
    body: JSON.stringify({ id: deviceId, duration: durationSeconds }),
  });
}

export async function pauseZoneRun(
  deviceId: string,
  durationSeconds: number
): Promise<void> {
  await rachioFetch("/zone/pause_zone_run", {
    method: "PUT",
    body: JSON.stringify({ id: deviceId, duration: durationSeconds }),
  });
}

export async function resumeZoneRun(deviceId: string): Promise<void> {
  await rachioFetch("/zone/resume_zone_run", {
    method: "PUT",
    body: JSON.stringify({ id: deviceId }),
  });
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

export async function getDeviceEvents(deviceId: string): Promise<RachioEvent[]> {
  const endTime = Date.now();
  const startTime = endTime - 7 * 24 * 60 * 60 * 1000; // last 7 days
  const data = await rachioFetch(
    `/device/${deviceId}/event?startTime=${startTime}&endTime=${endTime}`
  );
  return (Array.isArray(data) ? data : []) as RachioEvent[];
}

// ---------------------------------------------------------------------------
// Webhooks
// ---------------------------------------------------------------------------

// Rachio webhook event type IDs (from GET /notification/webhook_event_type)
export const RACHIO_EVENT_TYPES = {
  DEVICE_STATUS: 5,
  ZONE_STATUS: 10,
  RAIN_DELAY: 6,
  SCHEDULE_STATUS: 9,
  RAIN_SENSOR_DETECTION: 11,
  WEATHER_INTELLIGENCE: 7,
} as const;

export async function subscribeWebhook(
  deviceId: string,
  url: string,
  eventTypeIds: number[]
): Promise<void> {
  await rachioFetch("/notification/webhook", {
    method: "POST",
    body: JSON.stringify({
      device: { id: deviceId },
      url,
      externalId: "claudebot",
      eventTypes: eventTypeIds.map((id) => ({ id })),
    }),
  });
}

export async function listWebhooks(deviceId: string): Promise<RachioWebhook[]> {
  const data = await rachioFetch(`/notification/webhook_device/${deviceId}`);
  return (Array.isArray(data) ? data : []) as RachioWebhook[];
}

export async function deleteWebhook(webhookId: string): Promise<void> {
  await rachioFetch(`/notification/webhook/${webhookId}`, {
    method: "DELETE",
  });
}

// ---------------------------------------------------------------------------
// Zone lookup helper
// ---------------------------------------------------------------------------

/**
 * Find a zone by name (fuzzy) or by "zone N" number.
 * Returns the first match across all devices.
 */
export function findZone(
  devices: RachioDevice[],
  query: string
): RachioZone | null {
  const q = query.trim().toLowerCase();

  // "zone 3" → match by number
  const numberMatch = q.match(/^zone\s+(\d+)$/);
  if (numberMatch) {
    const num = parseInt(numberMatch[1]);
    for (const device of devices) {
      const zone = device.zones.find((z) => z.zoneNumber === num);
      if (zone) return zone;
    }
    return null;
  }

  // Fuzzy name match — find zone whose name contains the query words
  const words = q.split(/\s+/).filter(Boolean);
  let bestMatch: RachioZone | null = null;
  let bestScore = 0;

  for (const device of devices) {
    for (const zone of device.zones) {
      const zoneName = zone.name.toLowerCase();
      const matchCount = words.filter((w) => zoneName.includes(w)).length;
      if (matchCount > bestScore) {
        bestScore = matchCount;
        bestMatch = zone;
      }
    }
  }

  return bestScore > 0 ? bestMatch : null;
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

/** Format a finish time relative to now */
export function formatFinishTime(durationSeconds: number): string {
  const finish = new Date(Date.now() + durationSeconds * 1000);
  return finish.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: process.env.USER_TIMEZONE || "UTC",
  });
}

/** Format device status for Telegram */
export function formatDeviceStatus(device: RachioDevice): string {
  const statusLine = `*${device.name}* — ${device.status}`;
  const activeZones = device.zones?.filter(
    (z) => z.enabled
  );
  if (!activeZones?.length) return `${statusLine}\nNo zones enabled.`;

  const zoneLines = activeZones
    .map((z) => `  • Zone ${z.zoneNumber}: ${z.name}`)
    .join("\n");
  return `${statusLine}\nZones (${activeZones.length} enabled):\n${zoneLines}`;
}
