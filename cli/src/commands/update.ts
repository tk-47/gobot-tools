import { getRegistry } from "../lib/registry.js";
import { installTool, isInstalled, getInstalledVersion } from "../lib/installer.js";
import { isInitialized } from "../lib/config.js";

export async function updateCommand(name?: string): Promise<void> {
  if (!isInitialized()) {
    console.log(
      `\n  Not initialized. Run "gobot-tools init" first to set your project directory.\n`
    );
    return;
  }

  const tools = await getRegistry();

  const targets = name
    ? tools.filter((t) => t.name === name)
    : tools.filter((t) => isInstalled(t.name));

  if (name && targets.length === 0) {
    console.log(`\n  Tool "${name}" not found.`);
    console.log(`  Run "gobot-tools list" to see available tools.\n`);
    return;
  }

  if (targets.length === 0) {
    console.log(`\n  No tools installed yet. Run "gobot-tools install <tool>" first.\n`);
    return;
  }

  let updatedCount = 0;
  let upToDateCount = 0;

  for (const tool of targets) {
    const installedVersion = getInstalledVersion(tool.name);

    if (installedVersion === tool.version) {
      console.log(`  ${tool.displayName}: already up to date (${tool.version})`);
      upToDateCount++;
      continue;
    }

    const from = installedVersion ?? "unknown";
    console.log(`\n  Updating ${tool.displayName}: ${from} → ${tool.version}...`);

    try {
      await installTool(tool);
      console.log(`  Updated.`);
      updatedCount++;
    } catch (err: any) {
      console.log(`  Update failed: ${err.message}`);
    }
  }

  console.log();
  if (updatedCount > 0) {
    console.log(`  ${updatedCount} tool(s) updated.`);
  }
  if (upToDateCount > 0 && updatedCount === 0) {
    console.log(`  All tools are up to date.`);
  }
  console.log();
}
