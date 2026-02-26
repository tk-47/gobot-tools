import { getRegistry } from "../lib/registry.js";
import { isInstalled } from "../lib/installer.js";

export async function infoCommand(name: string): Promise<void> {
  const tools = await getRegistry();
  const tool = tools.find((t) => t.name === name);

  if (!tool) {
    console.log(`\n  Tool "${name}" not found.`);
    console.log(`  Run "gobot-tools list" to see available tools.\n`);
    return;
  }

  const installed = isInstalled(tool.name);

  console.log(`\n  ${tool.displayName} (${tool.name})`);
  console.log(`  ${"─".repeat(50)}`);
  console.log(`  ${tool.description}\n`);
  console.log(`  Version:      ${tool.version}`);
  console.log(`  Author:       ${tool.author}`);
  console.log(`  Category:     ${tool.category}`);
  console.log(`  Tags:         ${tool.tags.join(", ")}`);
  console.log(`  Status:       ${installed ? "Installed" : "Not installed"}`);

  if (tool.dependencies.length > 0) {
    console.log(`  Dependencies: ${tool.dependencies.join(", ")}`);
  }

  if (tool.envVars.length > 0) {
    console.log(`\n  Environment variables needed:`);
    for (const v of tool.envVars) {
      console.log(`    - ${v}`);
    }
  }

  console.log(`\n  Files:`);
  for (const f of tool.files) {
    console.log(`    - ${f}`);
  }

  console.log(`\n  After install: ${tool.postInstall}\n`);

  if (!installed) {
    console.log(`  Run "gobot-tools install ${tool.name}" to install.\n`);
  }
}
