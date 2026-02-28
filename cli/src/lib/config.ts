import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";

const CONFIG_DIR = join(homedir(), ".gobot-tools");
const CONFIG_FILE = join(CONFIG_DIR, "config.json");

export interface Config {
  projectDir: string;
  installedTools: string[];
  installedVersions: Record<string, string>;
}

function defaultConfig(): Config {
  return {
    projectDir: "",
    installedTools: [],
    installedVersions: {},
  };
}

export function loadConfig(): Config {
  if (!existsSync(CONFIG_FILE)) return defaultConfig();
  try {
    const raw = JSON.parse(readFileSync(CONFIG_FILE, "utf-8"));
    // Backwards-compat: existing configs won't have installedVersions
    return { installedVersions: {}, ...raw };
  } catch {
    return defaultConfig();
  }
}

export function saveConfig(config: Config): void {
  if (!existsSync(CONFIG_DIR)) mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2) + "\n");
}

export function isInitialized(): boolean {
  const config = loadConfig();
  return config.projectDir !== "";
}

export function getConfigDir(): string {
  return CONFIG_DIR;
}
