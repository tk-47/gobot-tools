import * as readline from "node:readline";
import { parseSkillIdentifier, fetchSkillFiles, computeContentHash } from "./lib/github.ts";
import { runAllChecks } from "./lib/checks.ts";
import {
  formatTerminalOutput,
  generateMarkdownReport,
  getReportPath,
  saveReport,
} from "./lib/report.ts";
import { SCANNER_VERSION, type ScanResult } from "./lib/types.ts";

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const arg = process.argv[2];

  // 1. Validate input
  if (!arg) {
    process.stderr.write(
      "Usage: bun run src/index.ts owner/repo@skill-name\n"
    );
    process.exit(1);
  }

  let identifier: ReturnType<typeof parseSkillIdentifier>;
  try {
    identifier = parseSkillIdentifier(arg);
  } catch (err: any) {
    process.stderr.write(`Error: ${err.message}\n`);
    process.exit(1);
  }

  // 2. GITHUB_TOKEN notice + optional confirmation
  if (process.env.GITHUB_TOKEN) {
    process.stderr.write(
      "Note: Using GITHUB_TOKEN for authenticated GitHub API access.\n"
    );

    if (process.stdout.isTTY) {
      // Interactive: prompt the user
      const confirmed = await promptConfirm("Proceed? (Y/n): ");
      if (!confirmed) {
        process.stderr.write("Aborted.\n");
        process.exit(1);
      }
    } else {
      // Piped/non-interactive: warn and proceed
      process.stderr.write(
        "Warning: Running non-interactively with GITHUB_TOKEN set. Proceeding.\n"
      );
    }
  }

  // 3. Fetch skill files
  process.stderr.write(`Fetching files for ${arg}...\n`);
  const { files, errors } = await fetchSkillFiles(identifier);

  if (errors.length > 0 && files.length === 0) {
    // Fatal fetch error — nothing to scan
    process.stderr.write(`Error: ${errors[0]}\n`);
    process.exit(1);
  }

  // 4. Run all checks
  const findings = runAllChecks(files, []);

  // 5. Compute content hash
  const contentHash = computeContentHash(files);

  // 6. Build summary
  const checksRun = 10;
  const checkIds = new Set(findings.map((f) => f.checkId));
  const checksPassed = checksRun - checkIds.size;

  const totalLines = files.reduce((sum, f) => sum + f.lines, 0);
  const riskCount = findings.filter((f) => f.severity === "RISK").length;
  const cautionCount = findings.filter((f) => f.severity === "CAUTION").length;

  // 7. Build ScanResult
  const result: ScanResult = {
    scannerVersion: SCANNER_VERSION,
    skill: arg,
    timestamp: new Date().toISOString(),
    files,
    findings,
    summary: {
      totalFiles: files.length,
      totalLines,
      totalFindings: findings.length,
      riskCount,
      cautionCount,
      checksRun,
      checksPassed,
    },
    contentHash,
    errors,
  };

  // 8. Output JSON to stdout (for AI consumption)
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");

  // 9. Print terminal-formatted summary to stderr (for human readability)
  process.stderr.write("\n" + formatTerminalOutput(result) + "\n");

  // 10. Save markdown report
  const reportPath = getReportPath(arg);
  const markdown = generateMarkdownReport(result);
  try {
    await saveReport(reportPath, markdown);
  } catch (err: any) {
    process.stderr.write(`Warning: Could not save report: ${err.message}\n`);
  }
}

// ---------------------------------------------------------------------------
// promptConfirm
// ---------------------------------------------------------------------------

/**
 * Prompts the user on stderr and reads a line from stdin.
 * Returns true if the user typed "y", "Y", or just pressed Enter.
 * Returns false if the user typed "n" or "N".
 */
function promptConfirm(prompt: string): Promise<boolean> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stderr,
    });

    rl.question(prompt, (answer) => {
      rl.close();
      const normalized = answer.trim().toLowerCase();
      resolve(normalized === "" || normalized === "y");
    });
  });
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

main().catch((err) => {
  process.stderr.write(`Fatal error: ${err.message}\n`);
  process.exit(1);
});
