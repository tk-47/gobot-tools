import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";

const CONFIG_DIR = join(homedir(), ".gobot-tools");
const CONFIG_FILE = join(CONFIG_DIR, "config.json");

export interface Config {
  projectDir: string;
  installedTools: string[];
}

function defaultConfig(): Config {
  return {
    projectDir: "",
    installedTools: [],
  };
}

export function loadConfig(): Config {
  if (!existsSync(CONFIG_FILE)) return defaultConfig();
  try {
    return JSON.parse(readFileSync(CONFIG_FILE, "utf-8"));
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
