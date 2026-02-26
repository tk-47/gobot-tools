import { createInterface } from "readline";
import { existsSync } from "fs";
import { resolve } from "path";
import { loadConfig, saveConfig } from "../lib/config.js";

function prompt(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((res) => {
    rl.question(question, (answer) => {
      rl.close();
      res(answer.trim());
    });
  });
}

export async function initCommand(): Promise<void> {
  console.log("\n  gobot-tools init\n");
  console.log("  This sets up gobot-tools for your project.\n");

  const config = loadConfig();

  if (config.projectDir) {
    console.log(`  Current project directory: ${config.projectDir}`);
    const change = await prompt("  Change it? (y/N) ");
    if (change.toLowerCase() !== "y") {
      console.log("  Keeping existing configuration.\n");
      return;
    }
  }

  const dir = await prompt(
    "  Where is your bot project? (absolute path) "
  );
  const resolved = resolve(dir);

  if (!existsSync(resolved)) {
    console.log(`\n  Directory not found: ${resolved}`);
    const create = await prompt("  Create it? (y/N) ");
    if (create.toLowerCase() === "y") {
      const { mkdirSync } = require("fs");
      mkdirSync(resolved, { recursive: true });
      console.log(`  Created ${resolved}`);
    } else {
      console.log("  Aborted.\n");
      return;
    }
  }

  config.projectDir = resolved;
  saveConfig(config);

  console.log(`\n  Project directory set to: ${resolved}`);
  console.log(`  Config saved to: ~/.gobot-tools/config.json`);
  console.log(`\n  Next: run "gobot-tools list" to see available tools.\n`);
}
