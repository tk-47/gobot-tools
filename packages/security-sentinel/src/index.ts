#!/usr/bin/env bun
/**
 * Security Sentinel — Autonomous security scanning agent
 *
 * Modes:
 *   scan       — Quick deterministic scan (no AI)
 *   hourly     — Deterministic + recon + Ollama review
 *   daily      — All hourly + nmap/nuclei/trufflehog/trivy + Ollama review
 *   deep       — Everything + Claude API analysis
 *   compliance — Compliance report from last scan
 *   install    — Check/install required tools
 *
 * Usage:
 *   bun run src/index.ts scan
 *   bun run src/index.ts hourly
 *   bun run src/index.ts daily
 *   bun run src/index.ts deep
 */

import { mkdir, readdir, readFile, writeFile } from "fs/promises";
import { join } from "path";
import { runScan, type ScanReport, type ScanResult, COMPLIANCE_CONTROLS } from "./lib/scanner";
import { runRecon } from "./lib/recon";
import { runDailyTools, runWeeklyTools } from "./lib/tools";
import {
  PROJECT_ROOT, OLLAMA_URL, OLLAMA_MODEL,
  ANTHROPIC_API_KEY, ANTHROPIC_MODEL,
  TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID,
  TIMEZONE, getInfraDescription,
} from "./config";
import {
  loadIgnores, isIgnored, addIgnore, removeIgnore, listIgnores, formatExpiry,
  type IgnoreRule,
} from "./lib/ignores";

// ============================================================
// CONFIGURATION
// ============================================================

const LOGS_DIR = join(PROJECT_ROOT, "logs", "security");

export type Mode = "scan" | "hourly" | "daily" | "deep" | "compliance" | "install" | "ignore" | "unignore" | "ignores";

// ============================================================
// REPORT PERSISTENCE
// ============================================================

async function ensureLogsDir() {
  await mkdir(LOGS_DIR, { recursive: true });
}

async function saveReport(report: ScanReport & { ai_summary?: string; mode: string }) {
  await ensureLogsDir();
  const filename = report.timestamp.replace(/[:.]/g, "-") + ".json";
  await writeFile(join(LOGS_DIR, filename), JSON.stringify(report, null, 2));
  return filename;
}

async function getLastReport(): Promise<(ScanReport & { ai_summary?: string; mode: string }) | null> {
  try {
    await ensureLogsDir();
    const files = (await readdir(LOGS_DIR)).filter((f) => f.endsWith(".json")).sort();
    if (files.length === 0) return null;
    const content = await readFile(join(LOGS_DIR, files[files.length - 1]), "utf-8");
    return JSON.parse(content);
  } catch {
    return null;
  }
}

// ============================================================
// DIFF
// ============================================================

interface ScanDiff {
  new_failures: ScanResult[];
  resolved: ScanResult[];
  persistent_failures: ScanResult[];
}

function diffReports(current: ScanResult[], previous: ScanResult[] | null): ScanDiff {
  if (!previous) {
    return {
      new_failures: current.filter((r) => !r.pass),
      resolved: [],
      persistent_failures: [],
    };
  }

  const prevMap = new Map(previous.map((r) => [r.id, r]));
  const currMap = new Map(current.map((r) => [r.id, r]));

  const new_failures: ScanResult[] = [];
  const resolved: ScanResult[] = [];
  const persistent_failures: ScanResult[] = [];

  for (const r of current) {
    if (!r.pass) {
      const prev = prevMap.get(r.id);
      if (!prev || prev.pass) new_failures.push(r);
      else persistent_failures.push(r);
    }
  }

  for (const r of previous) {
    if (!r.pass) {
      const curr = currMap.get(r.id);
      if (!curr || curr.pass) resolved.push(r);
    }
  }

  return { new_failures, resolved, persistent_failures };
}

// ============================================================
// REPORT FORMATTING
// ============================================================

function formatReport(
  report: ScanReport & { mode: string; ignored?: ScanResult[] },
  diff: ScanDiff,
  ignoreRules: IgnoreRule[],
  aiSummary?: string
): string {
  const lines: string[] = [];
  const ts = new Date(report.timestamp).toLocaleString("en-US", { timeZone: TIMEZONE });

  lines.push(`SECURITY SENTINEL REPORT — ${ts}`);
  lines.push("━".repeat(50));
  lines.push(`MODE: ${report.mode} | DURATION: ${(report.duration_ms / 1000).toFixed(1)}s`);
  lines.push("");

  const criticals = report.results.filter((r) => !r.pass && r.severity === "critical").length;
  const highs = report.results.filter((r) => !r.pass && r.severity === "high").length;
  const ignoredCount = report.ignored?.length ?? 0;

  const ignoredPart = ignoredCount > 0 ? ` | ${ignoredCount} ignored` : "";
  lines.push(`SUMMARY: ${report.total} checks | ${report.passed} passed | ${report.failed} failed${ignoredPart} | ${criticals} critical | ${highs} high`);
  lines.push("");

  if (diff.new_failures.length > 0 || diff.resolved.length > 0) {
    lines.push("CHANGES SINCE LAST SCAN:");
    for (const f of diff.new_failures) {
      lines.push(`  [NEW FAIL] ${f.id} — ${f.details}`);
    }
    for (const f of diff.resolved) {
      lines.push(`  [RESOLVED] ${f.id} — was: ${f.details}`);
    }
    lines.push("");
  }

  const failures = report.results.filter((r) => !r.pass).sort((a, b) => {
    const order = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
    return order[a.severity] - order[b.severity];
  });

  if (failures.length > 0) {
    lines.push("FAILURES:");
    for (const f of failures) {
      const sev = f.severity.toUpperCase().padEnd(8);
      lines.push(`  [${sev}] ${f.id} — ${f.name}`);
      lines.push(`           ${f.details}`);
      if (f.compliance.length > 0) {
        lines.push(`           Compliance: ${f.compliance.join(", ")}`);
      }
    }
    lines.push("");
  } else {
    lines.push("ALL CHECKS PASSED");
    lines.push("");
  }

  if (report.ignored && report.ignored.length > 0) {
    const sorted = [...report.ignored].sort((a, b) => {
      const order = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
      return order[a.severity] - order[b.severity];
    });
    lines.push(`IGNORED (${sorted.length}):`);
    for (const f of sorted) {
      const sev = f.severity.toUpperCase().padEnd(8);
      const rule = ignoreRules.find((r) => r.id === f.id);
      const note = rule ? `${rule.reason} — ${formatExpiry(rule.expires)}` : "no rule";
      lines.push(`  [${sev}] ${f.id} — ${f.name}`);
      lines.push(`           ${note}`);
    }
    lines.push("");
  }

  const cs = report.compliance_summary;
  lines.push("COMPLIANCE:");
  lines.push(`  SOC2:    ${cs.SOC2.status.toUpperCase()}${cs.SOC2.affected.length > 0 ? ` (${cs.SOC2.affected.length} finding(s))` : ""}`);
  lines.push(`  HIPAA:   ${cs.HIPAA.status.toUpperCase()}${cs.HIPAA.affected.length > 0 ? ` (${cs.HIPAA.affected.length} finding(s))` : ""}`);
  lines.push(`  PCI-DSS: ${cs["PCI-DSS"].status.toUpperCase()}${cs["PCI-DSS"].affected.length > 0 ? ` (${cs["PCI-DSS"].affected.length} finding(s))` : ""}`);
  lines.push("");

  if (aiSummary) {
    lines.push("AI ANALYSIS:");
    lines.push(aiSummary);
    lines.push("");
  }

  return lines.join("\n");
}

function formatTelegramAlert(report: ScanReport & { mode: string }, diff: ScanDiff): string | null {
  const criticals = report.results.filter((r) => !r.pass && r.severity === "critical");
  const highs = report.results.filter((r) => !r.pass && r.severity === "high");

  if (criticals.length === 0 && highs.length === 0 && diff.new_failures.length === 0) {
    return null;
  }

  const lines: string[] = [];
  lines.push("🔒 <b>Security Sentinel Alert</b>");
  lines.push("");
  lines.push(`<b>${report.total}</b> checks | <b>${report.failed}</b> failed`);

  if (diff.new_failures.length > 0) {
    lines.push("");
    lines.push("<b>New failures:</b>");
    for (const f of diff.new_failures.slice(0, 5)) {
      lines.push(`• [${f.severity.toUpperCase()}] ${f.name}: ${f.details}`);
    }
  }

  if (criticals.length > 0) {
    lines.push("");
    lines.push("<b>Critical:</b>");
    for (const f of criticals.slice(0, 3)) {
      lines.push(`• ${f.name}: ${f.details}`);
    }
  }

  if (highs.length > 0) {
    lines.push("");
    lines.push(`<b>High:</b> ${highs.length} finding(s)`);
  }

  if (diff.resolved.length > 0) {
    lines.push("");
    lines.push(`✅ ${diff.resolved.length} issue(s) resolved since last scan`);
  }

  return lines.join("\n");
}

/**
 * Compact Telegram summary for interactive scan commands.
 * Shows pass/fail counts, critical/high findings, and compliance status.
 * Full report is saved to logs/security/ for detailed review.
 */
function formatCompactTelegram(
  report: ScanReport & { mode: string; ignored?: ScanResult[] },
  diff: ScanDiff,
  reportFilename: string,
  aiSummary?: string
): string {
  const lines: string[] = [];
  const ts = new Date(report.timestamp).toLocaleString("en-US", {
    timeZone: TIMEZONE,
    month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
  });

  const criticals = report.results.filter((r) => !r.pass && r.severity === "critical");
  const highs = report.results.filter((r) => !r.pass && r.severity === "high");
  const mediums = report.results.filter((r) => !r.pass && r.severity === "medium");
  const ignoredCount = report.ignored?.length ?? 0;

  // Header
  const modeLabel = report.mode === "deep" ? "Deep Scan" : report.mode === "scan" ? "Quick Scan" : `${report.mode} scan`;
  lines.push(`🔒 <b>Security ${modeLabel}</b> — ${ts}`);
  lines.push(`${(report.duration_ms / 1000).toFixed(1)}s | ${report.total} checks | <b>${report.passed} passed</b> | <b>${report.failed} failed</b>`);

  // Status emoji
  if (criticals.length > 0) {
    lines.push("");
    lines.push(`🔴 <b>${criticals.length} CRITICAL</b>`);
    for (const f of criticals) {
      lines.push(`  • ${f.name}`);
    }
  }

  if (highs.length > 0) {
    lines.push("");
    lines.push(`🟠 <b>${highs.length} HIGH</b>`);
    for (const f of highs) {
      lines.push(`  • ${f.name}`);
    }
  }

  if (mediums.length > 0) {
    lines.push("");
    lines.push(`🟡 ${mediums.length} medium`);
  }

  // Changes
  if (diff.new_failures.length > 0) {
    lines.push("");
    lines.push(`⚠️ <b>${diff.new_failures.length} new failure(s)</b> since last scan`);
  }
  if (diff.resolved.length > 0) {
    lines.push(`✅ ${diff.resolved.length} resolved`);
  }
  if (ignoredCount > 0) {
    lines.push(`⏭️ ${ignoredCount} ignored`);
  }

  // Compliance one-liner
  const cs = report.compliance_summary;
  const compParts: string[] = [];
  if (cs.SOC2.status !== "pass") compParts.push(`SOC2:${cs.SOC2.status}`);
  if (cs.HIPAA.status !== "pass") compParts.push(`HIPAA:${cs.HIPAA.status}`);
  if (cs["PCI-DSS"].status !== "pass") compParts.push(`PCI:${cs["PCI-DSS"].status}`);
  if (compParts.length > 0) {
    lines.push("");
    lines.push(`📋 Compliance: ${compParts.join(" | ")}`);
  } else {
    lines.push("");
    lines.push("📋 Compliance: all clear");
  }

  // AI summary snippet (first 2 sentences only)
  if (aiSummary) {
    const sentences = aiSummary.split(/(?<=[.!?])\s+/).slice(0, 2).join(" ");
    lines.push("");
    lines.push(`🤖 ${sentences}`);
  }

  // Footer
  lines.push("");
  lines.push(`📄 Full report: logs/security/${reportFilename}`);

  return lines.join("\n");
}

// ============================================================
// TELEGRAM NOTIFICATION
// ============================================================

async function sendTelegramAlert(message: string) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) return;

  try {
    await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: TELEGRAM_CHAT_ID,
        text: message,
        parse_mode: "HTML",
        disable_web_page_preview: true,
      }),
    });
  } catch (err: any) {
    console.error(`Failed to send Telegram alert: ${err.message}`);
  }
}

// ============================================================
// AI REVIEW — Ollama (local)
// ============================================================

async function reviewWithOllama(report: ScanReport, diff: ScanDiff): Promise<string> {
  const failures = report.results.filter((r) => !r.pass);
  if (failures.length === 0) return "All checks passed. No issues to review.";

  const prompt = `You are a cybersecurity analyst reviewing automated security scan results for a web application infrastructure.

SCAN RESULTS (failures only):
${JSON.stringify(failures.map((f) => ({
  id: f.id, severity: f.severity, name: f.name, details: f.details, compliance: f.compliance
})), null, 2)}

${diff.new_failures.length > 0 ? `NEW FAILURES (appeared since last scan): ${diff.new_failures.map((f) => f.id).join(", ")}` : "No new failures since last scan."}
${diff.resolved.length > 0 ? `RESOLVED: ${diff.resolved.map((f) => f.id).join(", ")}` : ""}

Provide a brief analysis (3-5 sentences):
1. What is the most urgent issue and why?
2. Are any failures related to each other (attack chain)?
3. One specific remediation recommendation.

Be concise. No markdown formatting. Respond directly with the analysis, no preamble.`;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 90_000);
    const res = await fetch(`${OLLAMA_URL}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        prompt,
        stream: false,
        options: { temperature: 0.3, num_predict: 800 },
      }),
      signal: controller.signal,
    });
    clearTimeout(timer);

    const data = await res.json();
    let response = data.response?.trim() || "";
    response = response.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
    return response || "Ollama returned empty response.";
  } catch (err: any) {
    return `Ollama review failed: ${err.message}. Is Ollama running?`;
  }
}

// ============================================================
// AI REVIEW — Claude API (deep scan)
// ============================================================

async function reviewWithClaude(report: ScanReport, diff: ScanDiff): Promise<string> {
  if (!ANTHROPIC_API_KEY) {
    return "Claude API key not configured. Set ANTHROPIC_API_KEY for deep scan analysis.";
  }

  const infraDesc = getInfraDescription();

  const prompt = `You are an expert penetration tester and compliance auditor reviewing automated security scan results for a production web application infrastructure.

INFRASTRUCTURE:
${infraDesc}

FULL SCAN RESULTS:
${JSON.stringify(report.results.map((r) => ({
  id: r.id, pass: r.pass, severity: r.severity, name: r.name,
  details: r.details, evidence: r.evidence, compliance: r.compliance,
})), null, 2)}

CHANGES SINCE LAST SCAN:
- New failures: ${diff.new_failures.map((f) => f.id).join(", ") || "none"}
- Resolved: ${diff.resolved.map((f) => f.id).join(", ") || "none"}
- Persistent failures: ${diff.persistent_failures.map((f) => f.id).join(", ") || "none"}

COMPLIANCE SUMMARY:
${JSON.stringify(report.compliance_summary, null, 2)}

Provide a thorough security analysis:

1. RISK ASSESSMENT: Rate overall risk (Critical/High/Medium/Low) with justification.

2. ATTACK CHAIN ANALYSIS: Can any combination of findings be chained into a real attack? Describe the most plausible attack scenario.

3. COMPLIANCE GAPS:
   - SOC2: Which Trust Services Criteria are affected? What evidence is needed?
   - HIPAA: Which Security Rule sections are at risk?
   - PCI-DSS: Which requirements fail? Self-assessment implications?

4. REMEDIATION PLAN: Prioritized list with specific commands/changes for each finding.

5. COMPARISON TO BASELINES: How does this compare to a typical small-business web application? What's better than average? What's worse?

Be specific and actionable. Reference finding IDs.`;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 120_000);
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: ANTHROPIC_MODEL,
        max_tokens: 4096,
        messages: [{ role: "user", content: prompt }],
      }),
      signal: controller.signal,
    });
    clearTimeout(timer);

    const data = await res.json();
    const text = data.content?.[0]?.text;
    return text || "Claude returned empty response.";
  } catch (err: any) {
    return `Claude deep analysis failed: ${err.message}`;
  }
}

// ============================================================
// TOOL INSTALLATION CHECK
// ============================================================

function checkInstall() {
  const { execSync } = require("child_process");
  const tools = [
    { name: "nmap", install: "brew install nmap" },
    { name: "nuclei", install: "brew install nuclei" },
    { name: "testssl.sh", install: "brew install testssl" },
    { name: "trufflehog", install: "brew install trufflehog" },
    { name: "trivy", install: "brew install trivy" },
    { name: "semgrep", install: "brew install semgrep" },
    { name: "gitleaks", install: "brew install gitleaks" },
    { name: "grype", install: "brew install grype" },
    { name: "lynis", install: "brew install lynis" },
    { name: "sslyze", install: "pip3 install sslyze" },
    { name: "checkdmarc", install: "pip3 install checkdmarc" },
    { name: "httpx", install: "brew install httpx" },
  ];

  console.log("Security Sentinel — Tool Check\n");
  let allGood = true;
  for (const tool of tools) {
    try {
      const path = execSync(`which ${tool.name}`, { stdio: "pipe" }).toString().trim();
      console.log(`  ✓ ${tool.name.padEnd(15)} ${path}`);
    } catch {
      console.log(`  ✗ ${tool.name.padEnd(15)} NOT INSTALLED → ${tool.install}`);
      allGood = false;
    }
  }

  try {
    const ollamaModels = execSync("ollama list 2>/dev/null", { stdio: "pipe" }).toString();
    const hasModel = ollamaModels.includes(OLLAMA_MODEL.split(":")[0]);
    if (hasModel) {
      console.log(`  ✓ ollama/${OLLAMA_MODEL.padEnd(8)} available`);
    } else {
      console.log(`  ✗ ollama/${OLLAMA_MODEL.padEnd(8)} NOT FOUND → ollama pull ${OLLAMA_MODEL}`);
      allGood = false;
    }
  } catch {
    console.log(`  ✗ ollama               NOT RUNNING`);
    allGood = false;
  }

  if (ANTHROPIC_API_KEY) {
    console.log(`  ✓ ANTHROPIC_API_KEY    configured (for deep scan)`);
  } else {
    console.log(`  ○ ANTHROPIC_API_KEY    not set (deep scan will skip Claude analysis)`);
  }

  console.log(`\n${allGood ? "All tools ready." : "Some tools missing — install them for full coverage."}`);
}

// ============================================================
// MAIN
// ============================================================

export interface ScanOutput {
  /** Full detailed report (for logs / terminal review) */
  full: string;
  /** Compact Telegram-friendly summary */
  compact: string;
  /** Report filename in logs/security/ */
  filename: string;
}

export async function runSecurityScan(mode: Mode): Promise<ScanOutput> {
  console.log(`Security Sentinel — ${mode} scan starting...`);
  const start = Date.now();

  const coreReport = await runScan("hourly");
  const allResults = [...coreReport.results];

  if (mode !== "scan") {
    console.log("Running external recon (Shodan, crt.sh, DNS, OSV)...");
    const reconResults = await runRecon();
    allResults.push(...reconResults);
  }

  if (mode === "daily" || mode === "deep") {
    console.log("Running security tools (nmap, nuclei, trufflehog, trivy, semgrep, gitleaks, grype, checkdmarc, httpx, lynis)...");
    const toolResults = await runDailyTools();
    allResults.push(...toolResults);
  }

  if (mode === "deep") {
    console.log("Running deep TLS audit (testssl.sh, sslyze)...");
    const weeklyResults = await runWeeklyTools();
    allResults.push(...weeklyResults);
  }

  // Apply ignore rules — excluded from scores, compliance, and AI prompts
  const ignores = await loadIgnores();
  const ignoredResults = allResults.filter((r) => !r.pass && isIgnored(r.id, ignores));
  const scoredResults = allResults.filter((r) => r.pass || !isIgnored(r.id, ignores));

  const duration_ms = Date.now() - start;
  const passed = scoredResults.filter((r) => r.pass).length;
  const failed = scoredResults.filter((r) => !r.pass).length;

  const report: ScanReport & { ai_summary?: string; mode: string; ignored?: ScanResult[] } = {
    timestamp: new Date().toISOString(),
    duration_ms,
    total: allResults.length,
    passed,
    failed,
    results: scoredResults,
    ignored: ignoredResults,
    compliance_summary: buildComplianceSummaryFromResults(scoredResults),
    mode,
  };

  // Diff excludes ignored checks on both sides
  const previous = await getLastReport();
  const prevScored = previous?.results
    ? previous.results.filter((r) => !isIgnored(r.id, ignores))
    : null;
  const diff = diffReports(scoredResults, prevScored);

  if (mode === "hourly" || mode === "daily") {
    console.log(`Running AI review (${OLLAMA_MODEL})...`);
    report.ai_summary = await reviewWithOllama(report, diff);
  } else if (mode === "deep") {
    console.log("Running Claude deep analysis...");
    report.ai_summary = await reviewWithClaude(report, diff);
  }

  const filename = await saveReport(report);
  console.log(`Report saved: logs/security/${filename}`);

  const full = formatReport(report, diff, ignores, report.ai_summary);
  const compact = formatCompactTelegram(report, diff, filename, report.ai_summary);

  if (mode !== "scan") {
    const alert = formatTelegramAlert(report, diff);
    if (alert) {
      await sendTelegramAlert(alert);
      console.log("Telegram alert sent.");
    }
  }

  return { full, compact, filename };
}

async function main() {
  const args = process.argv.slice(2);
  const mode = (args[0] || "scan") as Mode;

  if (mode === "install") {
    checkInstall();
    return;
  }

  if (mode === "compliance") {
    const last = await getLastReport();
    if (!last) {
      console.log("No previous scan found. Run a scan first.");
      return;
    }
    console.log(formatComplianceReport(last));
    return;
  }

  // ── Ignore management ──────────────────────────────────────

  if (mode === "ignores") {
    const { active, expired } = await listIgnores();
    if (active.length === 0 && expired.length === 0) {
      console.log("No ignore rules defined.");
      console.log("  Add one: bun run src/index.ts ignore <id> --reason \"...\" [--expires YYYY-MM-DD]");
      return;
    }
    if (active.length > 0) {
      console.log(`ACTIVE IGNORES (${active.length}):`);
      for (const r of active) {
        console.log(`  ${r.id.padEnd(30)} ${formatExpiry(r.expires).padEnd(25)} ${r.reason}`);
        console.log(`  ${"".padEnd(30)} added: ${new Date(r.addedAt).toLocaleDateString()}`);
      }
    }
    if (expired.length > 0) {
      console.log(`\nEXPIRED (${expired.length}) — will be removed on next scan:`);
      for (const r of expired) {
        console.log(`  ${r.id.padEnd(30)} expired: ${new Date(r.expires!).toLocaleDateString()}`);
      }
    }
    return;
  }

  if (mode === "ignore") {
    const id = args[1];
    if (!id) {
      console.error("Usage: bun run src/index.ts ignore <id> [--reason \"...\"] [--expires YYYY-MM-DD]");
      process.exit(1);
    }
    // Parse --reason and --expires flags
    let reason = "No reason provided";
    let expires: string | null = null;
    for (let i = 2; i < args.length; i++) {
      if (args[i] === "--reason" && args[i + 1]) {
        reason = args[++i];
      } else if (args[i] === "--expires" && args[i + 1]) {
        const d = new Date(args[++i]);
        if (isNaN(d.getTime())) {
          console.error(`Invalid date: ${args[i]}. Use YYYY-MM-DD format.`);
          process.exit(1);
        }
        expires = d.toISOString();
      }
    }
    const rule = await addIgnore(id, reason, expires);
    console.log(`Ignore rule added: ${rule.id}`);
    console.log(`  Reason:  ${rule.reason}`);
    console.log(`  Expires: ${formatExpiry(rule.expires)}`);
    return;
  }

  if (mode === "unignore") {
    const id = args[1];
    if (!id) {
      console.error("Usage: bun run src/index.ts unignore <id>");
      process.exit(1);
    }
    const removed = await removeIgnore(id);
    if (removed) {
      console.log(`Ignore rule removed: ${id}`);
      console.log(`  ${id} will now appear in failures on the next scan.`);
    } else {
      console.log(`No ignore rule found for: ${id}`);
    }
    return;
  }

  const output = await runSecurityScan(mode);
  console.log("\n" + output.full);
}

// ============================================================
// COMPLIANCE REPORT
// ============================================================

function formatComplianceReport(report: ScanReport & { mode: string }): string {
  const lines: string[] = [];
  lines.push("COMPLIANCE REPORT");
  lines.push("━".repeat(50));
  lines.push(`Based on: ${report.mode} scan at ${report.timestamp}`);
  lines.push("");

  for (const [framework, data] of Object.entries(report.compliance_summary)) {
    lines.push(`${framework}: ${data.status.toUpperCase()}`);
    if (data.affected.length > 0) {
      for (const item of data.affected) {
        const [id, ctrl] = item.split(": ");
        const desc = COMPLIANCE_CONTROLS[ctrl] || ctrl;
        lines.push(`  • ${id} → ${ctrl} (${desc})`);
      }
    } else {
      lines.push("  All controls satisfied.");
    }
    lines.push("");
  }

  return lines.join("\n");
}

function buildComplianceSummaryFromResults(results: ScanResult[]) {
  const frameworks = {
    SOC2: { affected: [] as string[], status: "pass" as "pass" | "warn" | "fail" },
    "PCI-DSS": { affected: [] as string[], status: "pass" as "pass" | "warn" | "fail" },
    HIPAA: { affected: [] as string[], status: "pass" as "pass" | "warn" | "fail" },
  };

  for (const r of results) {
    if (r.pass) continue;
    for (const ctrl of r.compliance) {
      if (ctrl.startsWith("SOC2:")) {
        frameworks.SOC2.affected.push(`${r.id}: ${ctrl}`);
        if (r.severity === "critical" || r.severity === "high") frameworks.SOC2.status = "fail";
        else if (frameworks.SOC2.status !== "fail") frameworks.SOC2.status = "warn";
      }
      if (ctrl.startsWith("PCI:")) {
        frameworks["PCI-DSS"].affected.push(`${r.id}: ${ctrl}`);
        if (r.severity === "critical" || r.severity === "high") frameworks["PCI-DSS"].status = "fail";
        else if (frameworks["PCI-DSS"].status !== "fail") frameworks["PCI-DSS"].status = "warn";
      }
      if (ctrl.startsWith("HIPAA:")) {
        frameworks.HIPAA.affected.push(`${r.id}: ${ctrl}`);
        if (r.severity === "critical" || r.severity === "high") frameworks.HIPAA.status = "fail";
        else if (frameworks.HIPAA.status !== "fail") frameworks.HIPAA.status = "warn";
      }
    }
  }

  frameworks.SOC2.affected = [...new Set(frameworks.SOC2.affected)];
  frameworks["PCI-DSS"].affected = [...new Set(frameworks["PCI-DSS"].affected)];
  frameworks.HIPAA.affected = [...new Set(frameworks.HIPAA.affected)];

  return frameworks;
}

// ============================================================
// RUN
// ============================================================

main().catch((err) => {
  console.error("Security Sentinel fatal error:", err);
  process.exit(1);
});
