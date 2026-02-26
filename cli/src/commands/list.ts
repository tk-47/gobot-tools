import { getRegistry } from "../lib/registry.js";
import { isInstalled } from "../lib/installer.js";

export async function listCommand(): Promise<void> {
  const tools = await getRegistry();

  console.log(`\n  gobot-tools marketplace (${tools.length} tools)\n`);

  // Group by category
  const categories = new Map<string, typeof tools>();
  for (const tool of tools) {
    const cat = tool.category;
    if (!categories.has(cat)) categories.set(cat, []);
    categories.get(cat)!.push(tool);
  }

  for (const [category, catTools] of categories) {
    const label = category.charAt(0).toUpperCase() + category.slice(1);
    console.log(`  ${label}`);
    console.log(`  ${"─".repeat(50)}`);

    for (const tool of catTools) {
      const installed = isInstalled(tool.name) ? " [installed]" : "";
      const name = tool.name.padEnd(22);
      console.log(`  ${name} ${tool.displayName}${installed}`);
      console.log(`  ${"".padEnd(22)} ${dim(tool.description.slice(0, 70))}`);
    }
    console.log();
  }

  console.log(
    `  Run "gobot-tools info <tool>" for details, or "gobot-tools install <tool>" to install.\n`
  );
}

function dim(text: string): string {
  return `\x1b[2m${text}\x1b[0m`;
}
