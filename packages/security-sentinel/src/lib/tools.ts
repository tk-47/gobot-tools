/**
 * Security Tools — CLI tool wrappers for deep scanning
 *
 * Wraps external security tools (installed via brew):
 * - nmap: port scanning + service detection
 * - nuclei: vulnerability scanning (11k+ templates)
 * - testssl.sh: deep TLS/SSL audit
 * - trufflehog: git history secrets scanning
 * - trivy: filesystem vulnerability scanning
 *
 * Each tool is spawned as a child process with JSON output parsing.
 * Tools that aren't installed gracefully return a "not installed" result.
 */

import { spawn } from "child_process";
import type { ScanResult } from "./scanner";
import { VPS_HOST, VPS_URL, PROJECT_ROOT, EXPECTED_PORTS } from "../config";

function ok(
  id: string, category: string, name: string,
  pass: boolean, severity: ScanResult["severity"],
  details: string, compliance: string[], evidence?: string
): ScanResult {
  return {
    id, category, name, pass,
    severity: pass ? "info" : severity,
    details, evidence, compliance,
  };
}

async function runCLI(
  cmd: string,
  args: string[],
  timeout = 120_000
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve) => {
    const proc = spawn(cmd, args, { env: { ...process.env, PATH: `${process.env.PATH}:/opt/homebrew/bin:/usr/local/bin` } });
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d: Buffer) => (stdout += d));
    proc.stderr.on("data", (d: Buffer) => (stderr += d));
    proc.on("close", (code) =>
      resolve({ stdout: stdout.trim(), stderr: stderr.trim(), exitCode: code ?? 1 })
    );
    proc.on("error", (err) =>
      resolve({ stdout: "", stderr: err.message, exitCode: 127 })
    );
    const timer = setTimeout(() => {
      try { proc.kill("SIGTERM"); } catch {}
    }, timeout);
    proc.on("close", () => clearTimeout(timer));
  });
}

function toolInstalled(name: string): boolean {
  try {
    const { execSync } = require("child_process");
    execSync(`which ${name}`, { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

// ============================================================
// NMAP
// ============================================================

export async function runNmap(): Promise<ScanResult[]> {
  const results: ScanResult[] = [];

  if (!toolInstalled("nmap")) {
    results.push(ok("ports_nmap", "PORTS", "nmap port scan",
      false, "low", "nmap not installed (brew install nmap)",
      ["PCI:11.3"]
    ));
    return results;
  }

  const { stdout, stderr, exitCode } = await runCLI("nmap", [
    "-sV", "--top-ports", "100", "-T4", "-oX", "-", VPS_HOST,
  ], 180_000);

  if (exitCode !== 0 && !stdout.includes("<port")) {
    results.push(ok("ports_nmap", "PORTS", "nmap port scan completed",
      false, "medium",
      `nmap failed (exit ${exitCode}): ${(stderr || stdout).substring(0, 200)}`,
      ["PCI:11.3"],
      (stderr || stdout).substring(0, 200)
    ));
    return results;
  }

  const openPorts: { port: number; service: string; version: string }[] = [];
  const portRegex = /<port protocol="tcp" portid="(\d+)".*?<state state="open".*?<service name="([^"]*)"[^/]*?(?:product="([^"]*)")?/gs;
  let match;
  while ((match = portRegex.exec(stdout)) !== null) {
    openPorts.push({
      port: parseInt(match[1]),
      service: match[2] || "unknown",
      version: match[3] || "",
    });
  }

  if (openPorts.length === 0) {
    const simpleRegex = /portid="(\d+)"[\s\S]*?state="open"/g;
    while ((match = simpleRegex.exec(stdout)) !== null) {
      openPorts.push({ port: parseInt(match[1]), service: "unknown", version: "" });
    }
  }

  const unexpected = openPorts.filter((p) => !EXPECTED_PORTS.includes(p.port));

  results.push(ok("ports_nmap_unexpected", "PORTS", "No unexpected open ports (nmap)",
    unexpected.length === 0, unexpected.length > 0 ? "high" : "info",
    unexpected.length === 0
      ? `${openPorts.length} open port(s), all expected: ${openPorts.map((p) => p.port).join(", ")}`
      : `Unexpected: ${unexpected.map((p) => `${p.port}/${p.service}`).join(", ")}`,
    ["SOC2:CC6.6", "PCI:1.3", "PCI:11.3"],
    openPorts.map((p) => `${p.port}/${p.service} ${p.version}`.trim()).join(", ")
  ));

  const debugPorts = openPorts.filter((p) => [3000, 8080, 8443, 9229, 5432, 6379, 27017].includes(p.port));
  if (debugPorts.length > 0) {
    results.push(ok("ports_nmap_debug", "PORTS", "No debug/dev ports exposed externally",
      false, "critical",
      `Debug ports open: ${debugPorts.map((p) => `${p.port}/${p.service}`).join(", ")}`,
      ["SOC2:CC6.1", "PCI:1.3", "PCI:2.2"],
      debugPorts.map((p) => `${p.port}/${p.service}`).join(", ")
    ));
  }

  return results;
}

// ============================================================
// NUCLEI
// ============================================================

interface NucleiResult {
  "template-id": string;
  info: { name: string; severity: string; description?: string };
  "matched-at"?: string;
  host?: string;
  type?: string;
}

export async function runNuclei(): Promise<ScanResult[]> {
  const results: ScanResult[] = [];

  if (!toolInstalled("nuclei")) {
    results.push(ok("vuln_nuclei", "VULN", "Nuclei vulnerability scan",
      false, "low", "nuclei not installed (brew install nuclei)",
      ["PCI:11.3"]
    ));
    return results;
  }

  const { stdout } = await runCLI("nuclei", [
    "-u", VPS_URL,
    "-severity", "critical,high,medium",
    "-json", "-silent",
    "-no-interactsh",
    "-rate-limit", "10",
    "-timeout", "10",
    "-retries", "1",
  ], 300_000);

  const findings: NucleiResult[] = [];
  for (const line of stdout.split("\n")) {
    if (!line.trim()) continue;
    try { findings.push(JSON.parse(line)); } catch {}
  }

  const criticals = findings.filter((f) => f.info.severity === "critical");
  const highs = findings.filter((f) => f.info.severity === "high");
  const mediums = findings.filter((f) => f.info.severity === "medium");

  results.push(ok("vuln_nuclei_critical", "VULN", "No critical vulnerabilities (Nuclei)",
    criticals.length === 0, "critical",
    criticals.length === 0 ? "No critical findings"
      : `${criticals.length} critical: ${criticals.map((f) => f.info.name).join(", ")}`,
    ["SOC2:CC7.1", "PCI:11.3", "PCI:6.4", "HIPAA:164.308(a)(1)"],
    criticals.length > 0 ? criticals.map((f) => `${f["template-id"]}: ${f.info.name}`).join("; ") : undefined
  ));

  results.push(ok("vuln_nuclei_high", "VULN", "No high-severity vulnerabilities (Nuclei)",
    highs.length === 0, "high",
    highs.length === 0 ? "No high-severity findings"
      : `${highs.length} high: ${highs.map((f) => f.info.name).join(", ")}`,
    ["SOC2:CC7.1", "PCI:11.3", "PCI:6.4"],
    highs.length > 0 ? highs.map((f) => `${f["template-id"]}: ${f.info.name}`).join("; ") : undefined
  ));

  results.push(ok("vuln_nuclei_summary", "VULN", "Nuclei scan summary (informational)",
    true, "info",
    `${findings.length} total finding(s): ${criticals.length} critical, ${highs.length} high, ${mediums.length} medium`,
    ["PCI:11.3"],
    `Total: ${findings.length}`
  ));

  return results;
}

// ============================================================
// TESTSSL.SH
// ============================================================

export async function runTestSSL(): Promise<ScanResult[]> {
  const results: ScanResult[] = [];
  const hostname = new URL(VPS_URL).hostname;

  if (!toolInstalled("testssl.sh")) {
    results.push(ok("tls_deep", "TLS_DEEP", "testssl.sh deep TLS audit",
      false, "low", "testssl.sh not installed (brew install testssl)",
      ["PCI:2.2"]
    ));
    return results;
  }

  const { stdout } = await runCLI("testssl.sh", [
    "--jsonfile", "/dev/stdout", "--quiet", "--fast", "--sneaky", `${hostname}:443`,
  ], 180_000);

  try {
    let findings: any[] = [];
    const jsonStart = stdout.indexOf("[");
    const jsonEnd = stdout.lastIndexOf("]");
    if (jsonStart >= 0 && jsonEnd > jsonStart) {
      findings = JSON.parse(stdout.substring(jsonStart, jsonEnd + 1));
    }

    const vulnProtocols = findings.filter((f: any) =>
      f.id?.match(/^(SSLv2|SSLv3|TLS1$|TLS1_1)/) && f.severity === "CRITICAL" || f.severity === "HIGH"
    );
    results.push(ok("tls_deep_protocols", "TLS_DEEP", "No vulnerable TLS protocols (SSLv2/3, TLS 1.0/1.1)",
      vulnProtocols.length === 0, "high",
      vulnProtocols.length === 0
        ? "Only secure protocols enabled"
        : `Vulnerable protocols: ${vulnProtocols.map((f: any) => f.id).join(", ")}`,
      ["SOC2:CC6.6", "HIPAA:164.312(e)", "PCI:2.2"],
      vulnProtocols.length > 0 ? vulnProtocols.map((f: any) => `${f.id}: ${f.finding}`).join("; ") : undefined
    ));

    const knownVulns = findings.filter((f: any) =>
      f.id?.match(/^(heartbleed|CCS|ticketbleed|ROBOT|secure_renego|secure_client_renego|BEAST|POODLE|SWEET32|FREAK|DROWN|LOGJAM|LUCKY13)/) &&
      (f.severity === "CRITICAL" || f.severity === "HIGH" || f.severity === "MEDIUM")
    );
    results.push(ok("tls_deep_vulns", "TLS_DEEP", "No known TLS vulnerabilities",
      knownVulns.length === 0, knownVulns.some((f: any) => f.severity === "CRITICAL") ? "critical" : "high",
      knownVulns.length === 0
        ? "No Heartbleed, POODLE, ROBOT, etc."
        : `${knownVulns.length} vuln(s): ${knownVulns.map((f: any) => f.id).join(", ")}`,
      ["SOC2:CC6.6", "HIPAA:164.312(e)", "PCI:2.2", "PCI:11.3"],
      knownVulns.length > 0 ? knownVulns.map((f: any) => `${f.id}: ${f.finding}`).join("; ") : undefined
    ));

    const overallRating = findings.find((f: any) => f.id === "overall_grade");
    if (overallRating) {
      const grade = overallRating.finding || "unknown";
      const goodGrade = grade.startsWith("A");
      results.push(ok("tls_deep_grade", "TLS_DEEP", "TLS grade A or better",
        goodGrade, goodGrade ? "info" : "medium",
        `TLS grade: ${grade}`,
        ["SOC2:CC6.6", "PCI:2.2"],
        grade
      ));
    }
  } catch (err: any) {
    results.push(ok("tls_deep_parse", "TLS_DEEP", "testssl.sh results parsed",
      false, "low", `Failed to parse testssl output: ${err.message}`,
      ["PCI:2.2"], err.message
    ));
  }

  return results;
}

// ============================================================
// TRUFFLEHOG
// ============================================================

export async function runTruffleHog(): Promise<ScanResult[]> {
  const results: ScanResult[] = [];

  if (!toolInstalled("trufflehog")) {
    results.push(ok("secrets_trufflehog", "SECRETS", "TruffleHog secrets scan",
      false, "low", "trufflehog not installed (brew install trufflehog)",
      ["SOC2:CC6.1"]
    ));
    return results;
  }

  const { stdout } = await runCLI("trufflehog", [
    "filesystem", "--directory", PROJECT_ROOT,
    "--only-verified", "--json", "--no-update",
  ], 180_000);

  const secrets: any[] = [];
  for (const line of stdout.split("\n")) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line);
      const filePath = parsed?.SourceMetadata?.Data?.Filesystem?.file || "";
      if (filePath.match(/^\.env(\.|$)/)) continue;
      secrets.push(parsed);
    } catch {}
  }

  results.push(ok("secrets_trufflehog_verified", "SECRETS", "No verified active secrets in codebase",
    secrets.length === 0, secrets.length > 0 ? "critical" : "info",
    secrets.length === 0
      ? "No verified secrets found"
      : `${secrets.length} VERIFIED secret(s) found!`,
    ["SOC2:CC6.1", "SOC2:CC6.2", "PCI:2.2", "PCI:8.6", "HIPAA:164.312(a)"],
    secrets.length > 0
      ? secrets.map((s) => `${s.DetectorName || s.SourceMetadata?.Data?.Filesystem?.file || "unknown"}`).slice(0, 5).join("; ")
      : undefined
  ));

  return results;
}

// ============================================================
// TRIVY
// ============================================================

export async function runTrivy(): Promise<ScanResult[]> {
  const results: ScanResult[] = [];

  if (!toolInstalled("trivy")) {
    results.push(ok("deps_trivy", "DEPS", "Trivy filesystem scan",
      false, "low", "trivy not installed (brew install trivy)",
      ["PCI:11.3"]
    ));
    return results;
  }

  const { stdout } = await runCLI("trivy", [
    "fs", "--format", "json", "--severity", "CRITICAL,HIGH",
    "--scanners", "vuln", "--quiet", "--disable-telemetry", PROJECT_ROOT,
  ], 180_000);

  try {
    const report = JSON.parse(stdout);
    const allVulns: { id: string; pkg: string; severity: string }[] = [];

    for (const result of report.Results || []) {
      for (const vuln of result.Vulnerabilities || []) {
        allVulns.push({
          id: vuln.VulnerabilityID,
          pkg: vuln.PkgName,
          severity: vuln.Severity,
        });
      }
    }

    const criticals = allVulns.filter((v) => v.severity === "CRITICAL");
    const highs = allVulns.filter((v) => v.severity === "HIGH");

    results.push(ok("deps_trivy_critical", "DEPS", "No critical vulnerabilities (Trivy)",
      criticals.length === 0, "critical",
      criticals.length === 0 ? "No critical vulns in filesystem scan"
        : `${criticals.length} critical: ${criticals.slice(0, 3).map((v) => `${v.pkg}:${v.id}`).join(", ")}`,
      ["SOC2:CC7.1", "PCI:6.4", "PCI:11.3", "HIPAA:164.308(a)(1)"],
      criticals.length > 0 ? criticals.map((v) => `${v.pkg}:${v.id}`).join("; ") : undefined
    ));

    results.push(ok("deps_trivy_high", "DEPS", "No high-severity vulnerabilities (Trivy)",
      highs.length === 0, "high",
      highs.length === 0 ? "No high-severity vulns"
        : `${highs.length} high: ${highs.slice(0, 3).map((v) => `${v.pkg}:${v.id}`).join(", ")}`,
      ["SOC2:CC7.1", "PCI:6.4", "PCI:11.3"],
      highs.length > 0 ? highs.map((v) => `${v.pkg}:${v.id}`).join("; ") : undefined
    ));
  } catch (err: any) {
    results.push(ok("deps_trivy_parse", "DEPS", "Trivy results parsed",
      false, "low", `Failed to parse trivy output: ${err.message}`,
      ["PCI:11.3"], err.message
    ));
  }

  return results;
}

// ============================================================
// EXPORTS
// ============================================================

export async function runDailyTools(): Promise<ScanResult[]> {
  const all = await Promise.allSettled([
    runNmap(), runNuclei(), runTruffleHog(), runTrivy(),
  ]);
  const results: ScanResult[] = [];
  for (const check of all) {
    if (check.status === "fulfilled") results.push(...check.value);
  }
  return results;
}

export async function runWeeklyTools(): Promise<ScanResult[]> {
  const all = await Promise.allSettled([runTestSSL()]);
  const results: ScanResult[] = [];
  for (const check of all) {
    if (check.status === "fulfilled") results.push(...check.value);
  }
  return results;
}
