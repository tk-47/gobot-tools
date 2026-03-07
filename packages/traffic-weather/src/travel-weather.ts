/**
 * Travel Weather Alerts
 *
 * Checks weather along driving routes for out-of-town calendar events.
 * Uses Google Maps Directions API for route waypoints + traffic estimates,
 * and OpenWeatherMap for weather at each waypoint.
 *
 * Supports both Outlook (CalendarEvent) and Apple Calendar (UrlCalendarEvent) events.
 * Checks both outbound and return trips.
 */

const GOOGLE_MAPS_KEY = process.env.GOOGLE_MAPS_API_KEY;
const OWM_KEY = process.env.OPENWEATHERMAP_API_KEY;
const HOME_CITY = "Fort Worth, TX";

const LOCAL_KEYWORDS = [
  "fort worth", "westover hills", "benbrook", "river oaks",
  "76132", "76109", "76107", "76110", "76116", "76133",
];

export interface TravelWeatherResult {
  hasWarning: boolean;
  summary: string;
  details: string;
}

interface Waypoint {
  label: string;
  lat: number;
  lng: number;
  distanceMiles: number;
}

interface RouteInfo {
  waypoints: Waypoint[];
  totalMiles: number;
  durationMins: number;
  trafficMins: number | null;
}

// Unified event shape for both Outlook and Apple Calendar
interface TravelEvent {
  name: string;
  location: string;
  start: Date;
  end: Date;
}

export function isTravelWeatherEnabled(): boolean {
  return !!(GOOGLE_MAPS_KEY && OWM_KEY);
}

function isOutOfTown(location: string): boolean {
  const lower = location.toLowerCase();
  return !LOCAL_KEYWORDS.some((k) => lower.includes(k));
}

async function getRouteInfo(destination: string, departureTime?: Date): Promise<RouteInfo | null> {
  const url = new URL("https://maps.googleapis.com/maps/api/directions/json");
  url.searchParams.set("origin", HOME_CITY);
  url.searchParams.set("destination", destination);
  url.searchParams.set("key", GOOGLE_MAPS_KEY!);
  if (departureTime && departureTime.getTime() > Date.now()) {
    url.searchParams.set("departure_time", String(Math.floor(departureTime.getTime() / 1000)));
  }

  const res = await fetch(url.toString());
  const data: any = await res.json();

  if (data.status !== "OK" || !data.routes?.[0]) return null;

  const leg = data.routes[0].legs[0];
  const steps = leg.steps;
  const waypoints: Waypoint[] = [];
  let accumulated = 0;
  let lastAdded = 0;

  waypoints.push({
    label: HOME_CITY,
    lat: leg.start_location.lat,
    lng: leg.start_location.lng,
    distanceMiles: 0,
  });

  for (const step of steps) {
    accumulated += step.distance.value / 1609.34;
    if (accumulated - lastAdded >= 30) {
      waypoints.push({
        label: `${Math.round(accumulated)}mi mark`,
        lat: step.end_location.lat,
        lng: step.end_location.lng,
        distanceMiles: accumulated,
      });
      lastAdded = accumulated;
    }
  }

  waypoints.push({
    label: destination.split(",")[0],
    lat: leg.end_location.lat,
    lng: leg.end_location.lng,
    distanceMiles: accumulated,
  });

  const durationMins = Math.round(leg.duration.value / 60);
  const trafficMins = leg.duration_in_traffic
    ? Math.round(leg.duration_in_traffic.value / 60)
    : null;

  return { waypoints, totalMiles: accumulated, durationMins, trafficMins };
}

async function getWeatherAt(lat: number, lng: number, travelHour: Date): Promise<any> {
  const url = `https://api.openweathermap.org/data/2.5/forecast?lat=${lat}&lon=${lng}&appid=${OWM_KEY}&units=imperial`;
  const res = await fetch(url);
  const data: any = await res.json();
  if (!data.list?.length) return null;

  const target = travelHour.getTime() / 1000;
  return data.list.reduce((closest: any, entry: any) =>
    Math.abs(entry.dt - target) < Math.abs((closest?.dt ?? Infinity) - target) ? entry : closest,
    null,
  );
}

function checkWaypointWeather(weather: any): { isHazardous: boolean; desc: string; pop: number; temp: number } {
  const desc = weather.weather?.[0]?.description ?? "";
  const pop = Math.round((weather.pop ?? 0) * 100);
  const temp = Math.round(weather.main?.temp ?? 0);
  const isHazardous = pop >= 40 || /rain|storm|snow|sleet|ice|fog|thunder/i.test(desc);
  return { isHazardous, desc, pop, temp };
}

async function checkLegWeather(
  waypoints: Waypoint[],
  departureTime: Date,
): Promise<{ warnings: string[]; hasWarning: boolean }> {
  const warnings: string[] = [];
  let hasWarning = false;

  for (const wp of waypoints) {
    const minsFromDeparture = (wp.distanceMiles / 55) * 60;
    const timeAtWp = new Date(departureTime.getTime() + minsFromDeparture * 60 * 1000);

    try {
      const weather = await getWeatherAt(wp.lat, wp.lng, timeAtWp);
      if (!weather) continue;

      const result = checkWaypointWeather(weather);
      if (result.isHazardous) {
        hasWarning = true;
        warnings.push(`${wp.label}: ${result.desc}, ${result.temp}F, ${result.pop}% precip`);
      }
    } catch (err) {
      console.error(`Travel weather: forecast failed at ${wp.label}:`, err);
    }
  }

  return { warnings, hasWarning };
}

// Normalize Outlook events into TravelEvent
function fromOutlookEvents(events: any[]): TravelEvent[] {
  return events
    .filter((e) => !e.isAllDay && e.location?.displayName && isOutOfTown(e.location.displayName))
    .map((e) => ({
      name: e.subject ?? "Event",
      location: e.location.displayName,
      start: new Date(e.start.dateTime),
      end: new Date(e.end.dateTime),
    }));
}

// Normalize Apple Calendar (UrlCalendarEvent) into TravelEvent
function fromAppleEvents(events: any[]): TravelEvent[] {
  return events
    .filter((e: any) => !e.allDay && e.location && isOutOfTown(e.location))
    .map((e: any) => ({
      name: e.summary ?? "Event",
      location: e.location,
      start: e.start instanceof Date ? e.start : new Date(e.start),
      end: e.end instanceof Date ? e.end : new Date(e.end),
    }));
}

export async function checkTravelWeather(
  outlookEvents: any[],
  appleEvents?: any[],
): Promise<TravelWeatherResult | null> {
  if (!GOOGLE_MAPS_KEY || !OWM_KEY) return null;

  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(23, 59, 59, 999);

  // Merge both calendar sources
  const allTravel = [
    ...fromOutlookEvents(outlookEvents),
    ...(appleEvents ? fromAppleEvents(appleEvents) : []),
  ].filter((e) => e.start <= tomorrow);

  // Deduplicate by name+start time (same event in both calendars)
  const seen = new Set<string>();
  const travelEvents = allTravel.filter((e) => {
    const key = `${e.name.toLowerCase()}|${e.start.getTime()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  if (!travelEvents.length) return null;

  const results: string[] = [];
  let hasWarning = false;

  for (const event of travelEvents) {
    const destination = event.location;
    const departureTime = new Date(event.start.getTime() - 60 * 60 * 1000);

    let route: RouteInfo | null;
    try {
      route = await getRouteInfo(destination, departureTime);
    } catch (err) {
      console.error(`Travel weather: route lookup failed for "${destination}":`, err);
      continue;
    }
    if (!route) continue;

    const dest = destination.split(",")[0];
    const timeStr = event.start.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      timeZone: "America/Chicago",
    });

    // Traffic info
    let trafficNote = `${Math.round(route.totalMiles)} mi, ~${route.durationMins} min`;
    if (route.trafficMins && route.trafficMins > route.durationMins + 5) {
      const delay = route.trafficMins - route.durationMins;
      trafficNote += ` (+${delay} min traffic)`;
    }

    // === Outbound leg ===
    const outbound = await checkLegWeather(route.waypoints, departureTime);
    if (outbound.hasWarning) hasWarning = true;

    // === Return leg (reverse waypoints, depart when event ends) ===
    const returnDeparture = event.end;
    const returnWaypoints = [...route.waypoints].reverse().map((wp, i, arr) => ({
      ...wp,
      distanceMiles: i === 0 ? 0 : route!.totalMiles - wp.distanceMiles,
      label: i === 0 ? dest : i === arr.length - 1 ? HOME_CITY : wp.label,
    }));
    const returnLeg = await checkLegWeather(returnWaypoints, returnDeparture);
    if (returnLeg.hasWarning) hasWarning = true;

    // Build output
    const lines: string[] = [];
    if (outbound.warnings.length) {
      lines.push(`  *Going* →\n${outbound.warnings.map((w) => `    • ${w}`).join("\n")}`);
    }
    if (returnLeg.warnings.length) {
      lines.push(`  *Return* ←\n${returnLeg.warnings.map((w) => `    • ${w}`).join("\n")}`);
    }

    if (lines.length) {
      results.push(`🌧 *${event.name}* in ${dest} at ${timeStr} (${trafficNote})\n${lines.join("\n")}`);
    } else {
      results.push(`✅ *${event.name}* in ${dest} at ${timeStr} — clear both ways (${trafficNote})`);
    }
  }

  if (!results.length) return null;

  return {
    hasWarning,
    summary: hasWarning
      ? "⚠️ Weather alert for today's travel — see details below"
      : "🚗 Travel today — conditions look clear",
    details: results.join("\n\n"),
  };
}
