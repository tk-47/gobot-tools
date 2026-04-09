import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { ScanResult, CheckId } from "./types.ts";

// All 10 check IDs in display order
const ALL_CHECKS: CheckId[] = [
  "SHELL_EXEC",
  "EXTERNAL_URL",
  "CREDENTIAL_ACCESS",
  "OBFUSCATED",
  "PROMPT_INJECTION",
  "SECURITY_DISABLE",
  "POST_INSTALL",
  "TELEMETRY",
  "FS_OUTSIDE_PROJECT",
  "PERMISSION_ESCALATION",
];

// ─── Verdict helpers ──────────────────────────────────────────────────────────

type Verdict = "CLEAN" | "CAUTION" | "RISK";

function getVerdict(result: ScanResult): Verdict {
  if (result.summary.riskCount > 0) return "RISK";
  if (result.summary.cautionCount > 0) return "CAUTION";
  return "CLEAN";
}

// ─── getReportPath ────────────────────────────────────────────────────────────

/**
 * Returns the full absolute path for a report file.
 * Expands ~ to $HOME; formats skill identifier to be filesystem-safe.
 *
 * @example
 *   getReportPath("owner/repo@skill-name")
 *   // → "/Users/you/.claude/skill-audits/owner-repo-skill-name-2026-03-23.md"
 */
export function getReportPath(skill: string): string {
  const home = process.env.HOME ?? "~";
  const today = new Date().toISOString().split("T")[0]; // YYYY-MM-DD
  // Replace / and @ with - to make a safe filename segment
  const safeName = skill.replace(/[/@]/g, "-");
  return `${home}/.claude/skill-audits/${safeName}-${today}.md`;
}

// ─── formatTerminalOutput ─────────────────────────────────────────────────────

/**
 * Generates a compact, human-readable terminal summary of the scan result.
 */
export function formatTerminalOutput(result: ScanResult): string {
  const verdict = getVerdict(result);
  const reportPath = getReportPath(result.skill);
  const lines: string[] = [];

  lines.push(`Skill Auditor -- ${result.skill}`);
  lines.push("--------------------------------------------");
  lines.push(`Files scanned: ${result.summary.totalFiles}`);
  lines.push(
    `Checks passed: ${result.summary.checksPassed}/${result.summary.checksRun}`
  );

  if (result.findings.length > 0) {
    lines.push("");
    for (const finding of result.findings) {
      lines.push(
        `[${finding.severity}] ${finding.checkId} in ${finding.file}:${finding.line}`
      );
      lines.push(`  -> ${finding.match}`);
    }
  }

  lines.push("");

  switch (verdict) {
    case "CLEAN":
      lines.push("Verdict: CLEAN");
      break;
    case "CAUTION":
      lines.push("Verdict: CAUTION");
      break;
    case "RISK":
      lines.push("Verdict: RISK -- DO NOT INSTALL");
      break;
  }

  lines.push(`Full report: ${reportPath}`);

  return lines.join("\n");
}

// ─── generateMarkdownReport ───────────────────────────────────────────────────

/**
 * Generates a full markdown audit report for the scan result.
 */
export function generateMarkdownReport(result: ScanResult): string {
  const verdict = getVerdict(result);
  const date = result.timestamp.split("T")[0];
  const sections: string[] = [];

  // ── 1. Header ──
  sections.push(`# Skill Audit: ${result.skill}`);
  sections.push("");
  sections.push(`**Date:** ${date}`);
  sections.push(`**Verdict:** ${verdict}`);
  sections.push(`**Scanner Version:** ${result.scannerVersion}`);

  // ── 2. Summary ──
  sections.push("");
  sections.push("## Summary");
  sections.push("");
  const verdictSentence =
    verdict === "CLEAN"
      ? "No security concerns were identified."
      : verdict === "CAUTION"
        ? "One or more items warrant review before installation."
        : "High-severity security issues were found. Installation is not recommended.";
  sections.push(
    `This audit scanned ${result.summary.totalFiles} file(s) totalling ${result.summary.totalLines} lines across ${result.summary.checksRun} security checks. ` +
      `${result.summary.checksPassed} of ${result.summary.checksRun} checks passed. ${verdictSentence}`
  );

  // ── 3. Files Scanned ──
  sections.push("");
  sections.push("## Files Scanned");
  sections.push("");
  sections.push("| File | Lines | Notes |");
  sections.push("|------|-------|-------|");
  for (const file of result.files) {
    const notes = file.skipped
      ? `Skipped — ${file.skipReason ?? "unknown reason"}`
      : "";
    sections.push(`| ${file.path} | ${file.lines} | ${notes} |`);
  }

  // ── 4. Findings ──
  sections.push("");
  sections.push("## Findings");
  sections.push("");
  if (result.findings.length === 0) {
    sections.push("No findings.");
  } else {
    for (const finding of result.findings) {
      const ndFlag = finding.nonDowngradable ? " **[NON-DOWNGRADABLE]**" : "";
      sections.push(
        `### [${finding.severity}] ${finding.checkId}${ndFlag}`
      );
      sections.push("");
      sections.push(`- **File:** ${finding.file}:${finding.line}`);
      sections.push(`- **Pattern matched:** \`${finding.match}\``);
      sections.push(`- **Context:** ${finding.context}`);
      sections.push("");
    }
  }

  // ── 5. Checklist ──
  sections.push("## Checklist");
  sections.push("");
  sections.push("| Check | Status | Findings |");
  sections.push("|-------|--------|----------|");
  for (const checkId of ALL_CHECKS) {
    const findingsForCheck = result.findings.filter(
      (f) => f.checkId === checkId
    );
    const status = findingsForCheck.length === 0 ? "Pass" : "Fail";
    const count =
      findingsForCheck.length === 0
        ? "—"
        : String(findingsForCheck.length);
    sections.push(`| ${checkId} | ${status} | ${count} |`);
  }

  // ── 6. Content Hash ──
  sections.push("");
  sections.push("## Content Hash");
  sections.push("");
  sections.push(`- **Scanner Version:** ${result.scannerVersion}`);
  sections.push(`- **SHA-256:** \`${result.contentHash}\``);

  if (result.errors.length > 0) {
    sections.push("");
    sections.push("## Errors");
    sections.push("");
    for (const err of result.errors) {
      sections.push(`- ${err}`);
    }
  }

  return sections.join("\n");
}

// ─── saveReport ───────────────────────────────────────────────────────────────

/**
 * Creates any missing parent directories and writes content to reportPath.
 */
export async function saveReport(
  reportPath: string,
  content: string
): Promise<void> {
  await mkdir(dirname(reportPath), { recursive: true });
  await writeFile(reportPath, content, "utf-8");
}
