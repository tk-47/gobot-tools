import { getRegistry } from "../lib/registry.js";
import { installTool, isInstalled } from "../lib/installer.js";
import { isInitialized } from "../lib/config.js";

export async function installCommand(name: string): Promise<void> {
  if (!isInitialized()) {
    console.log(
      `\n  Not initialized. Run "gobot-tools init" first to set your project directory.\n`
    );
    return;
  }

  const tools = await getRegistry();
  const tool = tools.find((t) => t.name === name);

  if (!tool) {
    console.log(`\n  Tool "${name}" not found.`);
    console.log(`  Run "gobot-tools list" to see available tools.\n`);
    return;
  }

  if (isInstalled(tool.name)) {
    console.log(`\n  "${tool.displayName}" is already installed.\n`);
    return;
  }

  // Check dependencies
  for (const dep of tool.dependencies) {
    if (!isInstalled(dep)) {
      console.log(
        `\n  Dependency "${dep}" is not installed. Install it first:\n`
      );
      console.log(`    gobot-tools install ${dep}\n`);
      return;
    }
  }

  console.log(`\n  Installing ${tool.displayName}...`);

  try {
    await installTool(tool);
    console.log(`  Installed to: <project>/.gobot-tools/${tool.name}/\n`);

    if (tool.envVars.length > 0) {
      console.log(`  Add these to your .env:`);
      for (const v of tool.envVars) {
        console.log(`    ${v}=your-value-here`);
      }
      console.log();
    }

    console.log(`  Next step: ${tool.postInstall}\n`);
  } catch (err: any) {
    console.log(`\n  Install failed: ${err.message}\n`);
  }
}
