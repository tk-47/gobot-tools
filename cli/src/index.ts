#!/usr/bin/env node
import { Command } from "commander";
import { initCommand } from "./commands/init.js";
import { listCommand } from "./commands/list.js";
import { searchCommand } from "./commands/search.js";
import { infoCommand } from "./commands/info.js";
import { installCommand } from "./commands/install.js";
import { uninstallCommand } from "./commands/uninstall.js";

const program = new Command();

program
  .name("gobot-tools")
  .description("CLI marketplace for Autonomee community bot tools")
  .version("1.0.0");

program
  .command("init")
  .description("Set up gobot-tools for your project")
  .action(initCommand);

program
  .command("list")
  .description("Browse all available tools")
  .action(listCommand);

program
  .command("search <query>")
  .description("Search tools by name, category, or keyword")
  .action(searchCommand);

program
  .command("info <tool>")
  .description("Show details about a specific tool")
  .action(infoCommand);

program
  .command("install <tool>")
  .description("Install a tool into your project")
  .action(installCommand);

program
  .command("uninstall <tool>")
  .description("Remove an installed tool")
  .action(uninstallCommand);

program.parse();
