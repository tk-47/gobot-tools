import { existsSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { loadConfig, saveConfig } from "./config.js";
import type { ToolManifest } from "./registry.js";

const BASE_URL =
  "https://raw.githubusercontent.com/tk-47/gobot-tools/main/packages";

export async function installTool(tool: ToolManifest): Promise<void> {
  const config = loadConfig();
  if (!config.projectDir) {
    throw new Error(
      'No project directory configured. Run "gobot-tools init" first.'
    );
  }

  const installDir = join(config.projectDir, ".gobot-tools", tool.name);
  if (!existsSync(installDir)) mkdirSync(installDir, { recursive: true });

  // Download each file
  for (const file of tool.files) {
    const url = `${BASE_URL}/${tool.name}/${file}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Failed to download ${file}: ${res.status}`);
    const content = await res.text();
    const dest = join(installDir, file);
    writeFileSync(dest, content);
  }

  // Track installation
  if (!config.installedTools.includes(tool.name)) {
    config.installedTools.push(tool.name);
    saveConfig(config);
  }
}

export function uninstallTool(toolName: string): void {
  const config = loadConfig();
  if (!config.projectDir) {
    throw new Error(
      'No project directory configured. Run "gobot-tools init" first.'
    );
  }

  const installDir = join(config.projectDir, ".gobot-tools", toolName);
  if (existsSync(installDir)) {
    const { rmSync } = require("fs");
    rmSync(installDir, { recursive: true });
  }

  config.installedTools = config.installedTools.filter((t) => t !== toolName);
  saveConfig(config);
}

export function isInstalled(toolName: string): boolean {
  const config = loadConfig();
  return config.installedTools.includes(toolName);
}
