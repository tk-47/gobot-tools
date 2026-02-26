#!/usr/bin/env bun
// Scans all packages and generates registry.json at the repo root.
// Run: bun run scripts/generate-registry.ts
import { readdirSync, readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";

const ROOT = join(import.meta.dir, "..");
const PACKAGES_DIR = join(ROOT, "packages");
const OUTPUT = join(ROOT, "registry.json");

const dirs = readdirSync(PACKAGES_DIR, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name)
  .sort();

const tools: any[] = [];

for (const dir of dirs) {
  const manifestPath = join(PACKAGES_DIR, dir, "tool.json");
  if (!existsSync(manifestPath)) {
    console.warn(`  Skipping ${dir} — no tool.json`);
    continue;
  }
  const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
  tools.push(manifest);
  console.log(`  Added: ${manifest.name} (${manifest.displayName})`);
}

const registry = {
  version: "1.0.0",
  generatedAt: new Date().toISOString(),
  tools,
};

writeFileSync(OUTPUT, JSON.stringify(registry, null, 2) + "\n");
console.log(`\n  Registry generated: ${OUTPUT} (${tools.length} tools)\n`);
