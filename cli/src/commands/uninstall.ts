import { uninstallTool, isInstalled } from "../lib/installer.js";
import { isInitialized } from "../lib/config.js";

export async function uninstallCommand(name: string): Promise<void> {
  if (!isInitialized()) {
    console.log(
      `\n  Not initialized. Run "gobot-tools init" first.\n`
    );
    return;
  }

  if (!isInstalled(name)) {
    console.log(`\n  "${name}" is not installed.\n`);
    return;
  }

  uninstallTool(name);
  console.log(`\n  Uninstalled "${name}".\n`);
}
