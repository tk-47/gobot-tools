import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { getConfigDir } from "./config.js";

const REGISTRY_URL =
  "https://raw.githubusercontent.com/tk-47/gobot-tools/main/registry.json";
const CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes

export interface ToolManifest {
  name: string;
  displayName: string;
  description: string;
  version: string;
  author: string;
  category: string;
  tags: string[];
  dependencies: string[];
  files: string[];
  envVars: string[];
  postInstall: string;
}

function getCachePath(): string {
  return join(getConfigDir(), "registry-cache.json");
}

interface CachedRegistry {
  fetchedAt: number;
  tools: ToolManifest[];
}

async function fetchRemoteRegistry(): Promise<ToolManifest[]> {
  const res = await fetch(REGISTRY_URL);
  if (!res.ok) throw new Error(`Failed to fetch registry: ${res.status}`);
  const data = (await res.json()) as { tools: ToolManifest[] };
  return data.tools;
}

function readCache(): CachedRegistry | null {
  const path = getCachePath();
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return null;
  }
}

function writeCache(tools: ToolManifest[]): void {
  const { mkdirSync, writeFileSync } = require("fs");
  const dir = getConfigDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const cached: CachedRegistry = { fetchedAt: Date.now(), tools };
  writeFileSync(getCachePath(), JSON.stringify(cached, null, 2));
}

export async function getRegistry(): Promise<ToolManifest[]> {
  // Try cache first
  const cached = readCache();
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.tools;
  }

  // Try remote
  try {
    const tools = await fetchRemoteRegistry();
    writeCache(tools);
    return tools;
  } catch {
    // Fall back to stale cache
    if (cached) return cached.tools;

    // Fall back to local registry.json (for development)
    const localPath = join(__dirname, "../../../registry.json");
    if (existsSync(localPath)) {
      const data = JSON.parse(readFileSync(localPath, "utf-8"));
      return data.tools;
    }

    throw new Error(
      "Could not load tool registry. Check your internet connection."
    );
  }
}

export function searchTools(
  tools: ToolManifest[],
  query: string
): ToolManifest[] {
  const q = query.toLowerCase();
  return tools.filter(
    (t) =>
      t.name.includes(q) ||
      t.displayName.toLowerCase().includes(q) ||
      t.description.toLowerCase().includes(q) ||
      t.category.includes(q) ||
      t.tags.some((tag) => tag.includes(q))
  );
}
