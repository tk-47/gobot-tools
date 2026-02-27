/**
 * Security Tools — CLI tool wrappers for deep scanning
 *
 * Wraps external security tools:
 * - nmap: port scanning + service detection
 * - nuclei: vulnerability scanning (11k+ templates)
 * - testssl.sh: deep TLS/SSL audit
 * - trufflehog: git history secrets scanning
 * - trivy: filesystem vulnerability scanning
 * - gitleaks: secrets detection (regex-based, complements trufflehog)
 * - checkdmarc: SPF/DMARC email security validation
 * - grype: dependency vulnerability scanning (complements trivy)
 * - semgrep: static analysis / SAST
 * - httpx: HTTP probe / tech detection / header recon
 * - sslyze: deep TLS analysis (Python-based, complements testssl)
 * - lynis: host hardening audit (runs on VPS via SSH)
 *
 * Each tool is spawned as a child process with JSON output parsing.
 * Tools that aren't installed gracefully return a "not installed" result.
 */

import { spawn } from "child_process";
import type { ScanResult } from "./scanner";
import { VPS_HOST, VPS_URL, VPS_USER, VPS_KEY, DOMAIN, PROJECT_ROOT, EXPECTED_PORTS, HTTPX_TARGETS } from "../config";

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
    const proc = spawn(cmd, args, { env: {
      ...process.env,
      PATH: `${process.env.PATH}:/opt/homebrew/bin:/usr/local/bin`,
      SEMGREP_SEND_METRICS: "off",
      GRYPE_CHECK_FOR_APP_UPDATE: "false",
    } });
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
      // Match .env files whether path is relative (.env) or absolute (/path/to/.env)
      const baseName = filePath.split("/").pop() || "";
      if (baseName.match(/^\.env(\.|$)/)) continue;
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
// GITLEAKS — Secrets detection (regex-based)
// ============================================================

export async function runGitleaks(): Promise<ScanResult[]> {
  const results: ScanResult[] = [];

  if (!toolInstalled("gitleaks")) {
    results.push(ok("secrets_gitleaks", "SECRETS", "Gitleaks secrets scan",
      false, "low", "gitleaks not installed (brew install gitleaks)",
      ["SOC2:CC6.1"]
    ));
    return results;
  }

  const { stdout, exitCode } = await runCLI("gitleaks", [
    "detect", "--source", PROJECT_ROOT,
    "--report-format", "json", "--report-path", "/dev/stdout",
    "--no-banner",
  ], 180_000);

  // Exit code 1 = leaks found (normal), >1 = error
  if (exitCode > 1) {
    results.push(ok("secrets_gitleaks", "SECRETS", "Gitleaks scan completed",
      false, "low", `gitleaks error (exit ${exitCode})`,
      ["SOC2:CC6.1"]
    ));
    return results;
  }

  const leaks: any[] = [];
  try {
    const parsed = JSON.parse(stdout || "[]");
    for (const leak of Array.isArray(parsed) ? parsed : []) {
      const filePath = leak.File || "";
      const baseName = filePath.split("/").pop() || "";
      if (baseName.match(/^\.env(\.|$)/)) continue;
      leaks.push(leak);
    }
  } catch {}

  results.push(ok("secrets_gitleaks_leaks", "SECRETS", "No secrets detected (Gitleaks)",
    leaks.length === 0, leaks.length > 0 ? "critical" : "info",
    leaks.length === 0
      ? "No secrets found"
      : `${leaks.length} secret(s) found: ${leaks.slice(0, 3).map((l: any) => `${l.RuleID || "unknown"} in ${l.File || "?"}`).join(", ")}`,
    ["SOC2:CC6.1", "SOC2:CC6.2", "PCI:2.2", "PCI:8.6", "HIPAA:164.312(a)"],
    leaks.length > 0 ? leaks.slice(0, 5).map((l: any) => `${l.RuleID}: ${l.File}:${l.StartLine}`).join("; ") : undefined
  ));

  return results;
}

// ============================================================
// CHECKDMARC — Email security (SPF/DMARC)
// ============================================================

export async function runCheckdmarc(): Promise<ScanResult[]> {
  const results: ScanResult[] = [];

  if (!toolInstalled("checkdmarc")) {
    results.push(ok("email_checkdmarc", "EMAIL", "checkdmarc email security scan",
      false, "low", "checkdmarc not installed (pip3 install checkdmarc)",
      ["SOC2:CC6.6"]
    ));
    return results;
  }

  const { stdout, exitCode } = await runCLI("checkdmarc", [DOMAIN, "--json"], 60_000);

  try {
    const report = JSON.parse(stdout);

    // SPF check
    const spfValid = report.spf?.valid === true;
    results.push(ok("email_spf", "EMAIL", "SPF record valid",
      spfValid, spfValid ? "info" : "medium",
      spfValid ? `SPF valid: ${report.spf?.record || "present"}` : "SPF record missing or invalid",
      ["SOC2:CC6.6", "PCI:2.2"],
      report.spf?.record
    ));

    // DMARC check
    const dmarcValid = report.dmarc?.valid === true;
    results.push(ok("email_dmarc", "EMAIL", "DMARC record valid",
      dmarcValid, dmarcValid ? "info" : "medium",
      dmarcValid ? `DMARC valid: ${report.dmarc?.record || "present"}` : "DMARC record missing or invalid",
      ["SOC2:CC6.6", "PCI:2.2"],
      report.dmarc?.record
    ));

    // DMARC policy check
    const policy = report.dmarc?.tags?.p?.value || "none";
    const strongPolicy = policy === "reject" || policy === "quarantine";
    results.push(ok("email_dmarc_policy", "EMAIL", "DMARC policy enforced (reject/quarantine)",
      strongPolicy, strongPolicy ? "info" : "medium",
      `DMARC policy: ${policy}`,
      ["SOC2:CC6.6"],
      policy
    ));
  } catch (err: any) {
    results.push(ok("email_checkdmarc_parse", "EMAIL", "checkdmarc results parsed",
      false, "low", `Failed to parse checkdmarc output: ${err.message}`,
      ["SOC2:CC6.6"], err.message
    ));
  }

  return results;
}

// ============================================================
// GRYPE — Dependency vulnerability scanning
// ============================================================

export async function runGrype(): Promise<ScanResult[]> {
  const results: ScanResult[] = [];

  if (!toolInstalled("grype")) {
    results.push(ok("deps_grype", "DEPS", "Grype vulnerability scan",
      false, "low", "grype not installed (brew install grype)",
      ["PCI:11.3"]
    ));
    return results;
  }

  const { stdout } = await runCLI("grype", [
    `dir:${PROJECT_ROOT}`, "-o", "json", "--only-fixed",
  ], 180_000);

  try {
    const report = JSON.parse(stdout);
    const matches = report.matches || [];
    const criticals = matches.filter((m: any) => m.vulnerability?.severity === "Critical");
    const highs = matches.filter((m: any) => m.vulnerability?.severity === "High");

    results.push(ok("deps_grype_critical", "DEPS", "No critical vulnerabilities (Grype)",
      criticals.length === 0, "critical",
      criticals.length === 0 ? "No critical vulns (fixable)"
        : `${criticals.length} critical: ${criticals.slice(0, 3).map((m: any) => `${m.artifact?.name}:${m.vulnerability?.id}`).join(", ")}`,
      ["SOC2:CC7.1", "PCI:6.4", "PCI:11.3", "HIPAA:164.308(a)(1)"],
      criticals.length > 0 ? criticals.map((m: any) => `${m.artifact?.name}:${m.vulnerability?.id}`).join("; ") : undefined
    ));

    results.push(ok("deps_grype_high", "DEPS", "No high-severity vulnerabilities (Grype)",
      highs.length === 0, "high",
      highs.length === 0 ? "No high-severity vulns (fixable)"
        : `${highs.length} high: ${highs.slice(0, 3).map((m: any) => `${m.artifact?.name}:${m.vulnerability?.id}`).join(", ")}`,
      ["SOC2:CC7.1", "PCI:6.4", "PCI:11.3"],
      highs.length > 0 ? highs.map((m: any) => `${m.artifact?.name}:${m.vulnerability?.id}`).join("; ") : undefined
    ));
  } catch (err: any) {
    results.push(ok("deps_grype_parse", "DEPS", "Grype results parsed",
      false, "low", `Failed to parse grype output: ${err.message}`,
      ["PCI:11.3"], err.message
    ));
  }

  return results;
}

// ============================================================
// SEMGREP — Static Analysis (SAST)
// ============================================================

export async function runSemgrep(): Promise<ScanResult[]> {
  const results: ScanResult[] = [];

  if (!toolInstalled("semgrep")) {
    results.push(ok("sast_semgrep", "SAST", "Semgrep SAST scan",
      false, "low", "semgrep not installed (brew install semgrep)",
      ["SOC2:CC7.1"]
    ));
    return results;
  }

  const { stdout } = await runCLI("semgrep", [
    "scan", "--config", "auto", "--json", "--quiet",
    "--max-target-bytes", "1000000", PROJECT_ROOT,
  ], 300_000); // 5min timeout — first run downloads rulesets

  try {
    const report = JSON.parse(stdout);
    const findings = report.results || [];
    const errors = findings.filter((f: any) => f.extra?.severity === "ERROR");
    const warnings = findings.filter((f: any) => f.extra?.severity === "WARNING");

    results.push(ok("sast_semgrep_error", "SAST", "No high-severity SAST findings (Semgrep)",
      errors.length === 0, "high",
      errors.length === 0 ? "No ERROR-level findings"
        : `${errors.length} error(s): ${errors.slice(0, 3).map((f: any) => f.check_id).join(", ")}`,
      ["SOC2:CC7.1", "PCI:6.4", "PCI:6.5"],
      errors.length > 0 ? errors.slice(0, 5).map((f: any) => `${f.check_id}: ${f.path}:${f.start?.line}`).join("; ") : undefined
    ));

    results.push(ok("sast_semgrep_warning", "SAST", "No medium-severity SAST findings (Semgrep)",
      warnings.length === 0, "medium",
      warnings.length === 0 ? "No WARNING-level findings"
        : `${warnings.length} warning(s): ${warnings.slice(0, 3).map((f: any) => f.check_id).join(", ")}`,
      ["SOC2:CC7.1", "PCI:6.5"],
      warnings.length > 0 ? warnings.slice(0, 5).map((f: any) => `${f.check_id}: ${f.path}:${f.start?.line}`).join("; ") : undefined
    ));

    results.push(ok("sast_semgrep_summary", "SAST", "Semgrep scan summary (informational)",
      true, "info",
      `${findings.length} total finding(s): ${errors.length} error, ${warnings.length} warning`,
      ["PCI:6.5"],
      `Total: ${findings.length}`
    ));
  } catch (err: any) {
    results.push(ok("sast_semgrep_parse", "SAST", "Semgrep results parsed",
      false, "low", `Failed to parse semgrep output: ${err.message}`,
      ["SOC2:CC7.1"], err.message
    ));
  }

  return results;
}

// ============================================================
// HTTPX — HTTP probe / tech detection
// ============================================================

export async function runHttpx(): Promise<ScanResult[]> {
  const results: ScanResult[] = [];

  if (!toolInstalled("httpx")) {
    results.push(ok("recon_httpx", "RECON", "httpx HTTP probe",
      false, "low", "httpx not installed (brew install httpx)",
      ["SOC2:CC7.1"]
    ));
    return results;
  }

  const targets = HTTPX_TARGETS.join("\\n");
  const { stdout } = await runCLI("sh", [
    "-c", `printf '${targets}' | httpx -json -silent -duc -status-code -tech-detect -title -server -follow-redirects`,
  ], 60_000);

  const probes: any[] = [];
  for (const line of stdout.split("\n")) {
    if (!line.trim()) continue;
    try { probes.push(JSON.parse(line)); } catch {}
  }

  if (probes.length === 0) {
    results.push(ok("recon_httpx_status", "RECON", "All targets reachable (httpx)",
      false, "high",
      `No targets responded (${HTTPX_TARGETS.join(", ")})`,
      ["SOC2:CC7.1", "PCI:11.3"]
    ));
    return results;
  }

  // Check for unreachable targets
  const respondedUrls = new Set(probes.map((p) => p.url || p.input));
  const unreachable = HTTPX_TARGETS.filter((t) => !probes.some((p) => (p.url || p.input || "").includes(t)));
  if (unreachable.length > 0) {
    results.push(ok("recon_httpx_status", "RECON", "All targets reachable (httpx)",
      false, "high",
      `Unreachable: ${unreachable.join(", ")}`,
      ["SOC2:CC7.1", "PCI:11.3"],
      unreachable.join(", ")
    ));
  } else {
    results.push(ok("recon_httpx_status", "RECON", "All targets reachable (httpx)",
      true, "info",
      `${probes.length} target(s) responded`,
      ["SOC2:CC7.1"]
    ));
  }

  // Check for server header version leaks
  const leakyServers = probes.filter((p) => {
    const server = p.webserver || "";
    return server && /\d+\.\d+/.test(server);
  });
  results.push(ok("recon_httpx_server_header", "RECON", "No server version leaks in headers",
    leakyServers.length === 0, leakyServers.length > 0 ? "medium" : "info",
    leakyServers.length === 0
      ? "No version info leaked in Server headers"
      : `Version leak: ${leakyServers.map((p) => `${p.input}: ${p.webserver}`).join(", ")}`,
    ["SOC2:CC6.6", "PCI:2.2"],
    leakyServers.length > 0 ? leakyServers.map((p) => p.webserver).join("; ") : undefined
  ));

  // Tech detection (informational)
  const allTech = probes.flatMap((p) => p.tech || []);
  const uniqueTech = [...new Set(allTech)];
  if (uniqueTech.length > 0) {
    results.push(ok("recon_httpx_tech", "RECON", "Detected technologies (informational)",
      true, "info",
      `Technologies: ${uniqueTech.join(", ")}`,
      ["SOC2:CC7.1"],
      uniqueTech.join(", ")
    ));
  }

  return results;
}

// ============================================================
// SSLYZE — Deep TLS analysis (Python)
// ============================================================

export async function runSSLyze(): Promise<ScanResult[]> {
  const results: ScanResult[] = [];
  const hostname = new URL(VPS_URL).hostname;

  if (!toolInstalled("sslyze")) {
    results.push(ok("tls_sslyze", "TLS_DEEP", "SSLyze deep TLS scan",
      false, "low", "sslyze not installed (pip3 install sslyze)",
      ["PCI:2.2"]
    ));
    return results;
  }

  const { stdout } = await runCLI("sslyze", [
    `--json_out=-`, `${hostname}:443`,
  ], 120_000);

  try {
    const report = JSON.parse(stdout);
    const serverResults = report.server_scan_results?.[0];
    if (!serverResults) {
      results.push(ok("tls_sslyze_parse", "TLS_DEEP", "SSLyze scan returned results",
        false, "low", "No server scan results returned",
        ["PCI:2.2"]
      ));
      return results;
    }

    const cmds = serverResults.scan_result || {};

    // Check deprecated protocols (SSLv2, SSLv3, TLS 1.0, TLS 1.1)
    const deprecatedProtos: string[] = [];
    for (const proto of ["ssl_2_0", "ssl_3_0", "tls_1_0", "tls_1_1"]) {
      const protoResult = cmds[proto]?.result;
      if (protoResult?.accepted_cipher_suites?.length > 0) {
        deprecatedProtos.push(proto.replace(/_/g, "."));
      }
    }
    results.push(ok("tls_sslyze_deprecated", "TLS_DEEP", "No deprecated TLS protocols (SSLyze)",
      deprecatedProtos.length === 0, deprecatedProtos.length > 0 ? "high" : "info",
      deprecatedProtos.length === 0
        ? "No deprecated protocols accepted"
        : `Deprecated protocols: ${deprecatedProtos.join(", ")}`,
      ["SOC2:CC6.6", "HIPAA:164.312(e)", "PCI:2.2"],
      deprecatedProtos.length > 0 ? deprecatedProtos.join(", ") : undefined
    ));

    // Heartbleed
    const heartbleed = cmds.heartbleed?.result?.is_vulnerable_to_heartbleed;
    if (heartbleed !== undefined) {
      results.push(ok("tls_sslyze_heartbleed", "TLS_DEEP", "Not vulnerable to Heartbleed (SSLyze)",
        !heartbleed, heartbleed ? "critical" : "info",
        heartbleed ? "VULNERABLE to Heartbleed!" : "Not vulnerable to Heartbleed",
        ["SOC2:CC6.6", "PCI:2.2", "PCI:11.3"],
        heartbleed ? "VULNERABLE" : undefined
      ));
    }

    // Certificate validity
    const certInfo = cmds.certificate_info?.result?.certificate_deployments?.[0];
    if (certInfo) {
      const validChain = certInfo.verified_certificate_chain !== null;
      const leafCert = certInfo.received_certificate_chain?.[0];
      const notAfter = leafCert?.not_valid_after ? new Date(leafCert.not_valid_after) : null;
      const daysLeft = notAfter ? Math.floor((notAfter.getTime() - Date.now()) / 86400000) : null;
      const certOk = validChain && (daysLeft === null || daysLeft > 14);
      results.push(ok("tls_sslyze_cert", "TLS_DEEP", "TLS certificate valid (SSLyze)",
        certOk, certOk ? "info" : "high",
        daysLeft !== null
          ? `Certificate ${validChain ? "valid" : "INVALID chain"}, expires in ${daysLeft} days`
          : `Certificate chain ${validChain ? "valid" : "INVALID"}`,
        ["SOC2:CC6.6", "PCI:2.2"],
        daysLeft !== null ? `${daysLeft} days until expiry` : undefined
      ));
    }

    // TLS 1.3 support
    const tls13 = cmds.tls_1_3?.result;
    const tls13Supported = (tls13?.accepted_cipher_suites?.length || 0) > 0;
    results.push(ok("tls_sslyze_tls13", "TLS_DEEP", "TLS 1.3 supported (SSLyze)",
      tls13Supported, tls13Supported ? "info" : "medium",
      tls13Supported ? "TLS 1.3 supported" : "TLS 1.3 not supported",
      ["SOC2:CC6.6", "PCI:2.2"],
      tls13Supported ? `${tls13.accepted_cipher_suites.length} TLS 1.3 cipher suites` : undefined
    ));
  } catch (err: any) {
    results.push(ok("tls_sslyze_parse", "TLS_DEEP", "SSLyze results parsed",
      false, "low", `Failed to parse sslyze output: ${err.message}`,
      ["PCI:2.2"], err.message
    ));
  }

  return results;
}

// ============================================================
// LYNIS — Host hardening audit (VPS via SSH)
// ============================================================

export async function runLynis(): Promise<ScanResult[]> {
  const results: ScanResult[] = [];

  // Lynis runs on VPS via SSH — check ssh availability first
  if (!toolInstalled("ssh")) {
    results.push(ok("host_lynis", "HOST", "Lynis host audit",
      false, "low", "ssh not available",
      ["SOC2:CC6.1"]
    ));
    return results;
  }

  const { stdout, stderr, exitCode } = await runCLI("ssh", [
    "-i", VPS_KEY,
    "-o", "StrictHostKeyChecking=no",
    "-o", "ConnectTimeout=10",
    `${VPS_USER}@${VPS_HOST}`,
    "sudo lynis audit system --quick --no-colors --logfile /dev/null --report-file /dev/stdout",
  ], 120_000);

  if (exitCode === 127 || stderr.includes("command not found") || stderr.includes("not found")) {
    results.push(ok("host_lynis", "HOST", "Lynis host audit",
      false, "low", "lynis not installed on VPS (apt install lynis)",
      ["SOC2:CC6.1"]
    ));
    return results;
  }

  if (exitCode !== 0 && !stdout.includes("hardening_index")) {
    results.push(ok("host_lynis", "HOST", "Lynis host audit",
      false, "low", `Lynis SSH failed (exit ${exitCode}): ${(stderr || "").substring(0, 200)}`,
      ["SOC2:CC6.1"],
      (stderr || "").substring(0, 200)
    ));
    return results;
  }

  // Parse key-value report format
  const indexMatch = stdout.match(/hardening_index=(\d+)/);
  const hardIndex = indexMatch ? parseInt(indexMatch[1]) : null;
  const warningCount = (stdout.match(/warning\[\]/g) || []).length;
  const suggestionCount = (stdout.match(/suggestion\[\]/g) || []).length;

  if (hardIndex !== null) {
    const good = hardIndex >= 70;
    const severity = hardIndex < 50 ? "high" : hardIndex < 70 ? "medium" : "info";
    results.push(ok("host_lynis_hardening", "HOST", "VPS hardening score adequate (Lynis)",
      good, severity as ScanResult["severity"],
      `Hardening index: ${hardIndex}/100 (${warningCount} warnings, ${suggestionCount} suggestions)`,
      ["SOC2:CC6.1", "SOC2:CC6.6", "PCI:2.2", "HIPAA:164.308(a)(1)"],
      `Score: ${hardIndex}/100`
    ));
  }

  if (warningCount > 0) {
    results.push(ok("host_lynis_warnings", "HOST", "No Lynis warnings on VPS",
      false, warningCount > 5 ? "high" : "medium",
      `${warningCount} warning(s) from Lynis audit`,
      ["SOC2:CC6.1", "PCI:2.2"],
      `${warningCount} warnings`
    ));
  } else {
    results.push(ok("host_lynis_warnings", "HOST", "No Lynis warnings on VPS",
      true, "info",
      "No warnings from Lynis audit",
      ["SOC2:CC6.1"]
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
    runSemgrep(), runGitleaks(), runGrype(), runCheckdmarc(),
    runHttpx(), runLynis(),
  ]);
  const results: ScanResult[] = [];
  for (const check of all) {
    if (check.status === "fulfilled") results.push(...check.value);
  }
  return results;
}

export async function runWeeklyTools(): Promise<ScanResult[]> {
  const all = await Promise.allSettled([runTestSSL(), runSSLyze()]);
  const results: ScanResult[] = [];
  for (const check of all) {
    if (check.status === "fulfilled") results.push(...check.value);
  }
  return results;
}
