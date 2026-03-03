#!/usr/bin/env bun

import { join } from "path";
import { existsSync, readFileSync } from "fs";
import { parseDateRange } from "../lib/ms365";
import { isUrlCalendarEnabled, getUrlCalendarEvents } from "../lib/url-calendar";

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

async function main() {
  if (!isUrlCalendarEnabled()) {
    console.error("Calendar URL is not configured. Set APPLE_CALENDAR_URL (or APPLE_CALENDAR_URLS).\n");
    process.exit(1);
  }

  const query = process.argv.slice(2).join(" ") || "today";
  const { start, end, label } = parseDateRange(query);
  const output = await getUrlCalendarEvents(start, end, label);
  console.log(`Apple Calendar URL — ${label}`);
  console.log(output);
}

main().catch((err) => {
  console.error("Error:", err.message || err);
  process.exit(1);
});
