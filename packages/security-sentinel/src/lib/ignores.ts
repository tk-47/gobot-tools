/**
 * Ignore Rules — suppress known-acceptable check failures from reports.
 *
 * Rules are stored in PROJECT_ROOT/ignores.json.
 * Expired rules (expires < now) are auto-removed on load.
 * Use the CLI to manage rules:
 *   bun run src/index.ts ignore <id> [--reason "..."] [--expires YYYY-MM-DD]
 *   bun run src/index.ts unignore <id>
 *   bun run src/index.ts ignores
 */

import { readFile, writeFile } from "fs/promises";
import { join } from "path";

const PROJECT_ROOT = process.env.GO_PROJECT_ROOT || process.cwd();
const IGNORES_FILE = join(PROJECT_ROOT, "ignores.json");

export interface IgnoreRule {
  id: string;
  reason: string;
  expires: string | null;   // ISO string or null for permanent
  addedAt: string;          // ISO string
}

// ============================================================
// FILE I/O
// ============================================================

async function readRawIgnores(): Promise<IgnoreRule[]> {
  try {
    const content = await readFile(IGNORES_FILE, "utf-8");
    const parsed = JSON.parse(content);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function saveIgnores(rules: IgnoreRule[]): Promise<void> {
  await writeFile(IGNORES_FILE, JSON.stringify(rules, null, 2) + "\n");
}

// ============================================================
// CORE API
// ============================================================

/**
 * Load active ignore rules from ignores.json.
 * Expired rules are removed from the file automatically.
 * Returns only non-expired rules.
 */
export async function loadIgnores(): Promise<IgnoreRule[]> {
  const all = await readRawIgnores();
  const now = new Date();

  const active = all.filter(
    (r) => r.expires === null || new Date(r.expires) > now
  );

  // Save back if any expired rules were removed
  if (active.length < all.length) {
    await saveIgnores(active);
  }

  return active;
}

/**
 * Returns true if the given check ID has an active ignore rule.
 */
export function isIgnored(id: string, rules: IgnoreRule[]): boolean {
  const now = new Date();
  return rules.some(
    (r) =>
      r.id === id &&
      (r.expires === null || new Date(r.expires) > now)
  );
}

/**
 * Add or update an ignore rule for a check ID.
 * If a rule for that ID already exists, it is updated in place.
 */
export async function addIgnore(
  id: string,
  reason: string,
  expires?: string | null
): Promise<IgnoreRule> {
  const all = await readRawIgnores();
  const existing = all.findIndex((r) => r.id === id);

  const rule: IgnoreRule = {
    id,
    reason,
    expires: expires ?? null,
    addedAt: new Date().toISOString(),
  };

  if (existing >= 0) {
    all[existing] = rule;
  } else {
    all.push(rule);
  }

  await saveIgnores(all);
  return rule;
}

/**
 * Remove an ignore rule by check ID.
 * Returns true if a rule was found and removed, false if not found.
 */
export async function removeIgnore(id: string): Promise<boolean> {
  const all = await readRawIgnores();
  const filtered = all.filter((r) => r.id !== id);
  if (filtered.length === all.length) return false;
  await saveIgnores(filtered);
  return true;
}

/**
 * List all ignore rules categorized by status.
 * Does NOT auto-remove expired rules (use loadIgnores for that).
 */
export async function listIgnores(): Promise<{
  active: IgnoreRule[];
  expired: IgnoreRule[];
}> {
  const all = await readRawIgnores();
  const now = new Date();

  const active: IgnoreRule[] = [];
  const expired: IgnoreRule[] = [];

  for (const r of all) {
    if (r.expires !== null && new Date(r.expires) <= now) {
      expired.push(r);
    } else {
      active.push(r);
    }
  }

  return { active, expired };
}

// ============================================================
// FORMATTING HELPERS
// ============================================================

/** Format expiry for display: "permanent" or "expires: MMM D, YYYY" */
export function formatExpiry(expires: string | null): string {
  if (expires === null) return "permanent";
  return `expires: ${new Date(expires).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  })}`;
}
