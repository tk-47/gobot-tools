/**
 * Apple Health Data Client
 *
 * Receives data from Health Auto Export (iOS app) via webhook, stores
 * daily snapshots as JSON, and provides query functions for the Health Agent.
 *
 * Data flow: Apple Watch → iPhone (HealthKit) → Health Auto Export → webhook → here
 *
 * No Apple API token needed — data is pushed to us from the iPhone app.
 * Storage: ./data/apple-health.json (last 14 days of daily snapshots)
 */

import { existsSync, mkdirSync, readFileSync } from "fs";
import { readFile, writeFile } from "fs/promises";
import { join } from "path";

// ---------------------------------------------------------------------------
// Storage path
// ---------------------------------------------------------------------------

const DATA_DIR = join(process.cwd(), "data");
const DATA_FILE = join(DATA_DIR, "apple-health.json");

// ---------------------------------------------------------------------------
// Health Auto Export webhook payload types
// ---------------------------------------------------------------------------

interface HaeMetricSample {
  date: string;      // "2024-01-15 08:30:00 -0600"
  qty?: number;      // most metrics
  value?: string;    // sleep stages: "InBed" | "Asleep" | "Core" | "Deep" | "REM" | "Awake"
  Min?: number;
  Max?: number;
  Avg?: number;
  source?: string;
}

interface HaeMetric {
  name: string;      // "heart_rate", "sleep_analysis", etc.
  units: string;
  data: HaeMetricSample[];
}

export interface HaePayload {
  data: {
    metrics?: HaeMetric[];
    workouts?: unknown[];
  };
}

// ---------------------------------------------------------------------------
// Processed daily snapshot types
// ---------------------------------------------------------------------------

export interface AppleHealthSleep {
  bedtime: string | null;       // "22:30"
  wakeTime: string | null;      // "06:45"
  totalHours: number;           // total time asleep (not in bed)
  deepHours: number;
  remHours: number;
  coreHours: number;            // light sleep
  awakeHours: number;
  efficiency: number | null;    // % time asleep vs in bed
  avgHeartRate: number | null;  // HR during sleep
  avgRespiratoryRate: number | null;
}

export interface AppleHealthVitals {
  restingHR: number | null;
  avgHRV: number | null;        // SDNN in ms
  bloodOxygen: number | null;   // SpO2 %
  wristTempDelta: number | null; // deviation from personal baseline (°C)
  vo2Max: number | null;
}

export interface AppleHealthActivity {
  steps: number;
  activeCalories: number;
  exerciseMinutes: number;
  standHours: number;
}

export interface AppleHealthDay {
  date: string;             // YYYY-MM-DD
  sleep: AppleHealthSleep;
  vitals: AppleHealthVitals;
  activity: AppleHealthActivity;
  readinessScore: number | null; // computed proxy 0-100
}

export interface AppleHealthStore {
  lastUpdated: string;      // ISO timestamp
  days: AppleHealthDay[];   // newest first, max 14
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Parse "2024-01-15 08:30:00 -0600" → Date */
function parseHaeDate(dateStr: string): Date {
  return new Date(dateStr.replace(" ", "T").replace(/(\s[+-]\d{4})$/, (m) => {
    const sign = m.trim()[0];
    const hh = m.trim().slice(1, 3);
    const mm = m.trim().slice(3, 5);
    return `${sign}${hh}:${mm}`;
  }));
}

/** Extract YYYY-MM-DD from a date string in user's timezone */
function toLocalDate(dateStr: string, tz = "America/Chicago"): string {
  const d = parseHaeDate(dateStr);
  return d.toLocaleDateString("en-CA", { timeZone: tz });
}

/** Format a Date as "HH:MM" */
function toTimeString(d: Date, tz = "America/Chicago"): string {
  return d.toLocaleTimeString("en-US", { timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false });
}

/** Format decimal hours as "Xh Ym" */
function formatHours(hours: number): string {
  if (!hours) return "—";
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function avg(arr: number[]): number | null {
  if (!arr.length) return null;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function clamp(val: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, val));
}

// ---------------------------------------------------------------------------
// Load / save store
// ---------------------------------------------------------------------------

async function loadStore(): Promise<AppleHealthStore> {
  if (!existsSync(DATA_FILE)) {
    return { lastUpdated: new Date().toISOString(), days: [] };
  }
  const raw = await readFile(DATA_FILE, "utf-8");
  return JSON.parse(raw) as AppleHealthStore;
}

async function saveStore(store: AppleHealthStore): Promise<void> {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  await writeFile(DATA_FILE, JSON.stringify(store, null, 2));
}

// ---------------------------------------------------------------------------
// Readiness proxy score
// ---------------------------------------------------------------------------

function computeReadiness(day: AppleHealthDay, history: AppleHealthDay[]): number | null {
  const scores: Array<{ score: number; weight: number }> = [];

  // HRV score (weight 40%) — compare to 7-day avg
  if (day.vitals.avgHRV !== null) {
    const historicHRV = history
      .slice(0, 7)
      .map((d) => d.vitals.avgHRV)
      .filter((v): v is number => v !== null);
    if (historicHRV.length >= 2) {
      const baselineHRV = avg(historicHRV)!;
      const ratio = day.vitals.avgHRV / baselineHRV;
      let hrvScore = 50;
      if (ratio >= 1.1) hrvScore = 95;
      else if (ratio >= 0.95) hrvScore = 80;
      else if (ratio >= 0.8) hrvScore = 65;
      else if (ratio >= 0.65) hrvScore = 45;
      else hrvScore = 25;
      scores.push({ score: hrvScore, weight: 0.4 });
    } else {
      // Not enough history — use absolute HRV
      const absScore = clamp(Math.round((day.vitals.avgHRV / 60) * 100));
      scores.push({ score: absScore, weight: 0.3 });
    }
  }

  // Resting HR score (weight 25%) — lower is better, compare to baseline
  if (day.vitals.restingHR !== null) {
    const historicRHR = history
      .slice(0, 7)
      .map((d) => d.vitals.restingHR)
      .filter((v): v is number => v !== null);
    if (historicRHR.length >= 2) {
      const baselineRHR = avg(historicRHR)!;
      const ratio = day.vitals.restingHR / baselineRHR;
      let rhrScore = 50;
      if (ratio <= 0.95) rhrScore = 95;
      else if (ratio <= 1.0) rhrScore = 85;
      else if (ratio <= 1.05) rhrScore = 65;
      else if (ratio <= 1.15) rhrScore = 40;
      else rhrScore = 20;
      scores.push({ score: rhrScore, weight: 0.25 });
    } else {
      // Absolute: 50 RHR = great, 80 = poor
      const absScore = clamp(Math.round(((90 - day.vitals.restingHR) / 40) * 100));
      scores.push({ score: absScore, weight: 0.2 });
    }
  }

  // Sleep score (weight 25%)
  const sleepScore = computeSleepScore(day.sleep);
  if (sleepScore !== null) {
    scores.push({ score: sleepScore, weight: 0.25 });
  }

  // Respiratory rate score (weight 10%) — consistency
  if (day.sleep.avgRespiratoryRate !== null) {
    const historicRR = history
      .slice(0, 14)
      .map((d) => d.sleep.avgRespiratoryRate)
      .filter((v): v is number => v !== null);
    if (historicRR.length >= 3) {
      const baselineRR = avg(historicRR)!;
      const deviation = Math.abs(day.sleep.avgRespiratoryRate - baselineRR);
      let rrScore = 50;
      if (deviation < 0.5) rrScore = 95;
      else if (deviation < 1.0) rrScore = 80;
      else if (deviation < 2.0) rrScore = 60;
      else rrScore = 35;
      scores.push({ score: rrScore, weight: 0.1 });
    }
  }

  if (!scores.length) return null;

  // Normalize weights to sum to 1
  const totalWeight = scores.reduce((s, x) => s + x.weight, 0);
  const weighted = scores.reduce((s, x) => s + x.score * (x.weight / totalWeight), 0);
  return Math.round(clamp(weighted));
}

function computeSleepScore(sleep: AppleHealthSleep): number | null {
  if (!sleep.totalHours) return null;

  // Duration component (0-100)
  let durationScore: number;
  if (sleep.totalHours >= 8) durationScore = 100;
  else if (sleep.totalHours >= 7) durationScore = 85;
  else if (sleep.totalHours >= 6) durationScore = 65;
  else if (sleep.totalHours >= 5) durationScore = 40;
  else durationScore = 20;

  // Stage quality component: deep + REM should be ~40-45% of total
  const qualitySleep = sleep.deepHours + sleep.remHours;
  const qualityRatio = sleep.totalHours > 0 ? qualitySleep / sleep.totalHours : 0;
  let qualityScore: number;
  if (qualityRatio >= 0.4) qualityScore = 100;
  else if (qualityRatio >= 0.3) qualityScore = 80;
  else if (qualityRatio >= 0.2) qualityScore = 60;
  else qualityScore = 40;

  // Efficiency component
  let effScore = 75; // default if unknown
  if (sleep.efficiency !== null) {
    if (sleep.efficiency >= 90) effScore = 100;
    else if (sleep.efficiency >= 80) effScore = 80;
    else if (sleep.efficiency >= 70) effScore = 60;
    else effScore = 35;
  }

  return Math.round((durationScore * 0.5) + (qualityScore * 0.3) + (effScore * 0.2));
}

// ---------------------------------------------------------------------------
// Payload parser — Health Auto Export → AppleHealthDay
// ---------------------------------------------------------------------------

function findMetric(metrics: HaeMetric[], name: string): HaeMetric | undefined {
  return metrics.find((m) => m.name === name);
}

/** Group samples by local date, return map of date → samples */
function groupByDate(
  metric: HaeMetric | undefined,
  tz: string
): Map<string, HaeMetricSample[]> {
  const map = new Map<string, HaeMetricSample[]>();
  if (!metric) return map;
  for (const sample of metric.data) {
    const date = toLocalDate(sample.date, tz);
    if (!map.has(date)) map.set(date, []);
    map.get(date)!.push(sample);
  }
  return map;
}

export function parsePayload(payload: HaePayload, tz = "America/Chicago"): AppleHealthDay[] {
  const metrics = payload.data?.metrics ?? [];

  // --- Collect all dates present in the payload ---
  const allDates = new Set<string>();
  for (const metric of metrics) {
    for (const sample of metric.data) {
      allDates.add(toLocalDate(sample.date, tz));
    }
  }

  // --- Group each metric by date ---
  const sleepSamples = groupByDate(findMetric(metrics, "sleep_analysis"), tz);
  const hrSamples = groupByDate(findMetric(metrics, "heart_rate"), tz);
  const restingHRSamples = groupByDate(findMetric(metrics, "resting_heart_rate"), tz);
  const hrvSamples = groupByDate(findMetric(metrics, "heart_rate_variability"), tz);
  const respiratorySamples = groupByDate(findMetric(metrics, "respiratory_rate"), tz);
  const spO2Samples = groupByDate(findMetric(metrics, "blood_oxygen_saturation"), tz);
  const tempSamples = groupByDate(findMetric(metrics, "body_temperature"), tz);
  const vo2Samples = groupByDate(findMetric(metrics, "vo2_max"), tz);
  const stepSamples = groupByDate(findMetric(metrics, "step_count"), tz);
  const activeCalSamples = groupByDate(findMetric(metrics, "active_energy_burned"), tz);
  const exerciseSamples = groupByDate(findMetric(metrics, "apple_exercise_time"), tz);
  const standSamples = groupByDate(findMetric(metrics, "apple_stand_hour"), tz);

  const days: AppleHealthDay[] = [];

  for (const date of Array.from(allDates).sort().reverse()) {
    // --- Sleep ---
    const sleepRaw = sleepSamples.get(date) ?? [];
    let totalHours = 0, deepHours = 0, remHours = 0, coreHours = 0, awakeHours = 0;
    let inBedStart: Date | null = null, inBedEnd: Date | null = null;

    for (const s of sleepRaw) {
      const qty = s.qty ?? 0; // duration in hours (Health Auto Export sends hrs)
      const val = s.value?.toLowerCase() ?? "";
      if (val === "asleep" || val === "core") coreHours += qty;
      else if (val === "deep") deepHours += qty;
      else if (val === "rem") remHours += qty;
      else if (val === "awake") awakeHours += qty;
      else if (val === "inbed") {
        const start = parseHaeDate(s.date);
        if (!inBedStart || start < inBedStart) inBedStart = start;
        const end = new Date(start.getTime() + qty * 3600 * 1000);
        if (!inBedEnd || end > inBedEnd) inBedEnd = end;
      }
    }

    totalHours = coreHours + deepHours + remHours;
    const inBedHours = inBedStart && inBedEnd
      ? (inBedEnd.getTime() - inBedStart.getTime()) / 3600000
      : totalHours + awakeHours;
    const efficiency = inBedHours > 0 ? Math.round((totalHours / inBedHours) * 100) : null;

    // HR during sleep (night hours: 10pm–8am)
    const nightHR = (hrSamples.get(date) ?? [])
      .filter((s) => {
        const h = parseHaeDate(s.date).getHours();
        return h >= 22 || h < 8;
      })
      .map((s) => s.qty ?? s.Avg ?? 0)
      .filter((v) => v > 0);

    // Respiratory rate
    const rrVals = (respiratorySamples.get(date) ?? [])
      .map((s) => s.qty ?? 0)
      .filter((v) => v > 0);

    const sleep: AppleHealthSleep = {
      bedtime: inBedStart ? toTimeString(inBedStart, tz) : null,
      wakeTime: inBedEnd ? toTimeString(inBedEnd, tz) : null,
      totalHours,
      deepHours,
      remHours,
      coreHours,
      awakeHours,
      efficiency,
      avgHeartRate: avg(nightHR),
      avgRespiratoryRate: avg(rrVals),
    };

    // --- Vitals ---
    const rhrVals = (restingHRSamples.get(date) ?? [])
      .map((s) => s.qty ?? 0).filter((v) => v > 0);
    const hrvVals = (hrvSamples.get(date) ?? [])
      .map((s) => s.qty ?? 0).filter((v) => v > 0);
    const spO2Vals = (spO2Samples.get(date) ?? [])
      .map((s) => s.qty ?? 0).filter((v) => v > 0);
    const tempVals = (tempSamples.get(date) ?? [])
      .map((s) => s.qty ?? 0).filter((v) => v !== 0);
    const vo2Vals = (vo2Samples.get(date) ?? [])
      .map((s) => s.qty ?? 0).filter((v) => v > 0);

    const vitals: AppleHealthVitals = {
      restingHR: avg(rhrVals) !== null ? Math.round(avg(rhrVals)!) : null,
      avgHRV: avg(hrvVals) !== null ? Math.round(avg(hrvVals)!) : null,
      bloodOxygen: avg(spO2Vals) !== null ? Math.round(avg(spO2Vals)!) : null,
      wristTempDelta: avg(tempVals),
      vo2Max: avg(vo2Vals) !== null ? Math.round(avg(vo2Vals)! * 10) / 10 : null,
    };

    // --- Activity ---
    const steps = (stepSamples.get(date) ?? []).reduce((s, x) => s + (x.qty ?? 0), 0);
    const activeCal = (activeCalSamples.get(date) ?? []).reduce((s, x) => s + (x.qty ?? 0), 0);
    const exerciseMins = (exerciseSamples.get(date) ?? []).reduce((s, x) => s + (x.qty ?? 0), 0);
    const standHrs = (standSamples.get(date) ?? []).length; // each sample = 1 stand hour

    const activity: AppleHealthActivity = {
      steps: Math.round(steps),
      activeCalories: Math.round(activeCal),
      exerciseMinutes: Math.round(exerciseMins),
      standHours: standHrs,
    };

    days.push({
      date,
      sleep,
      vitals,
      activity,
      readinessScore: null, // computed after collecting all days
    });
  }

  return days;
}

// ---------------------------------------------------------------------------
// Store incoming webhook payload
// ---------------------------------------------------------------------------

export async function storeAppleHealthData(payload: HaePayload): Promise<void> {
  const tz = process.env.USER_TIMEZONE || "America/Chicago";
  const incoming = parsePayload(payload, tz);
  if (!incoming.length) return;

  const store = await loadStore();

  // Merge incoming days into store (upsert by date)
  for (const day of incoming) {
    const idx = store.days.findIndex((d) => d.date === day.date);
    if (idx >= 0) {
      store.days[idx] = day;
    } else {
      store.days.push(day);
    }
  }

  // Sort newest first, cap at 14 days
  store.days.sort((a, b) => b.date.localeCompare(a.date));
  store.days = store.days.slice(0, 14);

  // Compute readiness scores now that we have full history
  for (let i = 0; i < store.days.length; i++) {
    const history = store.days.slice(i + 1); // older days as baseline
    store.days[i].readinessScore = computeReadiness(store.days[i], history);
  }

  store.lastUpdated = new Date().toISOString();
  await saveStore(store);
}

// ---------------------------------------------------------------------------
// Public API — check availability
// ---------------------------------------------------------------------------

export function isAppleHealthEnabled(): boolean {
  if (!existsSync(DATA_FILE)) return false;
  // Consider stale if no update in 48 hours
  try {
    const raw = readFileSync(DATA_FILE, "utf-8");
    const store = JSON.parse(raw) as AppleHealthStore;
    const age = Date.now() - new Date(store.lastUpdated).getTime();
    return age < 48 * 60 * 60 * 1000 && store.days.length > 0;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Query functions (formatted strings for the health agent)
// ---------------------------------------------------------------------------

function scoreLabel(score: number | null): string {
  if (score === null) return "—";
  if (score >= 85) return `${score} ✦ Optimal`;
  if (score >= 70) return `${score} ✓ Good`;
  if (score >= 60) return `${score} ⚠ Fair`;
  return `${score} ✗ Needs attention`;
}

export async function getAppleHealthSummary(): Promise<string> {
  const store = await loadStore();
  if (!store.days.length) return "No Apple Health data available.";

  const days = store.days.slice(0, 3);
  const lines: string[] = [
    `📱 Apple Health — Last ${days.length} day(s)`,
    `Updated: ${new Date(store.lastUpdated).toLocaleString("en-US", { timeZone: process.env.USER_TIMEZONE || "America/Chicago" })}`,
    "",
  ];

  for (const day of days) {
    lines.push(`━━━ ${day.date} ━━━`);
    lines.push(`Readiness (proxy): ${scoreLabel(day.readinessScore)}`);

    // Sleep
    if (day.sleep.totalHours > 0) {
      const sleepScore = computeSleepScore(day.sleep);
      lines.push(`Sleep: ${formatHours(day.sleep.totalHours)} total  |  Score: ${sleepScore ?? "—"}`);
      lines.push(`  Deep: ${formatHours(day.sleep.deepHours)}  REM: ${formatHours(day.sleep.remHours)}  Core: ${formatHours(day.sleep.coreHours)}`);
      if (day.sleep.bedtime) lines.push(`  Bedtime: ${day.sleep.bedtime}  Wake: ${day.sleep.wakeTime ?? "—"}  Eff: ${day.sleep.efficiency ?? "—"}%`);
    } else {
      lines.push("Sleep: No data");
    }

    // Vitals
    const v = day.vitals;
    const vitalParts = [];
    if (v.restingHR !== null) vitalParts.push(`RHR: ${v.restingHR} bpm`);
    if (v.avgHRV !== null) vitalParts.push(`HRV: ${v.avgHRV} ms`);
    if (v.bloodOxygen !== null) vitalParts.push(`SpO₂: ${v.bloodOxygen}%`);
    if (v.wristTempDelta !== null) vitalParts.push(`Temp: ${v.wristTempDelta > 0 ? "+" : ""}${v.wristTempDelta.toFixed(2)}°C`);
    if (vitalParts.length) lines.push(`Vitals: ${vitalParts.join("  |  ")}`);

    // Activity
    const a = day.activity;
    if (a.steps > 0 || a.activeCalories > 0) {
      lines.push(`Activity: ${a.steps.toLocaleString()} steps  |  ${a.activeCalories} kcal  |  ${a.exerciseMinutes} min exercise  |  ${a.standHours}h standing`);
    }

    lines.push("");
  }

  return lines.join("\n").trimEnd();
}

export async function getDetailedSleep(date?: string): Promise<string> {
  const store = await loadStore();
  if (!store.days.length) return "No Apple Health sleep data available.";

  const day = date
    ? store.days.find((d) => d.date === date)
    : store.days[0];

  if (!day) return `No sleep data found for ${date ?? "most recent date"}.`;

  const s = day.sleep;
  const lines = [
    `😴 Sleep Detail — ${day.date}`,
    "",
    `Bedtime:   ${s.bedtime ?? "—"}`,
    `Wake time: ${s.wakeTime ?? "—"}`,
    `Efficiency: ${s.efficiency ?? "—"}%`,
    "",
    "Sleep stages:",
    `  Total asleep: ${formatHours(s.totalHours)}`,
    `  Deep:         ${formatHours(s.deepHours)}  (${s.totalHours > 0 ? Math.round((s.deepHours / s.totalHours) * 100) : "—"}%)`,
    `  REM:          ${formatHours(s.remHours)}  (${s.totalHours > 0 ? Math.round((s.remHours / s.totalHours) * 100) : "—"}%)`,
    `  Core (Light): ${formatHours(s.coreHours)}  (${s.totalHours > 0 ? Math.round((s.coreHours / s.totalHours) * 100) : "—"}%)`,
    `  Awake:        ${formatHours(s.awakeHours)}`,
    "",
    "Vitals during sleep:",
    `  Heart rate:       ${s.avgHeartRate !== null ? `${Math.round(s.avgHeartRate)} bpm` : "—"}`,
    `  Respiratory rate: ${s.avgRespiratoryRate !== null ? `${s.avgRespiratoryRate.toFixed(1)} br/min` : "—"}`,
    "",
    `Sleep score (proxy): ${computeSleepScore(s) ?? "—"}/100`,
  ];

  return lines.join("\n");
}

export async function getVitalsDetail(date?: string): Promise<string> {
  const store = await loadStore();
  if (!store.days.length) return "No Apple Health vitals data available.";

  const day = date
    ? store.days.find((d) => d.date === date)
    : store.days[0];

  if (!day) return `No vitals data found for ${date ?? "most recent date"}.`;

  const v = day.vitals;

  // HRV context from history
  const historicHRV = store.days
    .slice(1, 8)
    .map((d) => d.vitals.avgHRV)
    .filter((x): x is number => x !== null);
  const baselineHRV = avg(historicHRV);

  const lines = [
    `❤️ Vitals Detail — ${day.date}`,
    "",
    `Resting HR:       ${v.restingHR !== null ? `${v.restingHR} bpm` : "—"}`,
    `HRV (SDNN):       ${v.avgHRV !== null ? `${v.avgHRV} ms` : "—"}${baselineHRV !== null ? `  (7-day avg: ${Math.round(baselineHRV)} ms)` : ""}`,
    `Blood Oxygen:     ${v.bloodOxygen !== null ? `${v.bloodOxygen}%` : "—"}`,
    `Wrist Temp Delta: ${v.wristTempDelta !== null ? `${v.wristTempDelta > 0 ? "+" : ""}${v.wristTempDelta.toFixed(2)}°C from baseline` : "— (Series 8+ only)"}`,
    `VO₂ Max:          ${v.vo2Max !== null ? `${v.vo2Max} mL/kg/min` : "—"}`,
    "",
    `Readiness score (proxy): ${scoreLabel(day.readinessScore)}`,
  ];

  return lines.join("\n");
}

export async function getActivityDetail(date?: string): Promise<string> {
  const store = await loadStore();
  if (!store.days.length) return "No Apple Health activity data available.";

  const day = date
    ? store.days.find((d) => d.date === date)
    : store.days[0];

  if (!day) return `No activity data found for ${date ?? "most recent date"}.`;

  const a = day.activity;

  // 7-day averages
  const history = store.days.slice(1, 8);
  const avgSteps = avg(history.map((d) => d.activity.steps).filter((v) => v > 0));
  const avgCal = avg(history.map((d) => d.activity.activeCalories).filter((v) => v > 0));

  const lines = [
    `🏃 Activity Detail — ${day.date}`,
    "",
    `Steps:             ${a.steps.toLocaleString()}${avgSteps !== null ? `  (7-day avg: ${Math.round(avgSteps).toLocaleString()})` : ""}`,
    `Active calories:   ${a.activeCalories}${avgCal !== null ? `  (7-day avg: ${Math.round(avgCal)})` : ""}`,
    `Exercise minutes:  ${a.exerciseMinutes} min`,
    `Stand hours:       ${a.standHours}h`,
  ];

  return lines.join("\n");
}
