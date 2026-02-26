import { getRegistry, searchTools } from "../lib/registry.js";
import { isInstalled } from "../lib/installer.js";

export async function searchCommand(query: string): Promise<void> {
  const tools = await getRegistry();
  const results = searchTools(tools, query);

  if (results.length === 0) {
    console.log(`\n  No tools found matching "${query}".\n`);
    return;
  }

  console.log(`\n  ${results.length} result(s) for "${query}":\n`);

  for (const tool of results) {
    const installed = isInstalled(tool.name) ? " [installed]" : "";
    console.log(`  ${tool.name} — ${tool.displayName}${installed}`);
    console.log(`    ${tool.description}`);
    console.log(`    Category: ${tool.category}  Tags: ${tool.tags.join(", ")}`);
    console.log();
  }
}
