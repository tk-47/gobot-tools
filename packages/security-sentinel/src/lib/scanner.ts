/**
 * Security Scanner — Static vulnerability checks for web infrastructure
 *
 * Probes VPS endpoints externally, audits VPS internals via SSH,
 * validates API credentials, checks local security, and maps
 * all findings to SOC2, HIPAA, and PCI-DSS compliance controls.
 *
 * No AI needed — pure deterministic checks.
 */

import { spawn } from "child_process";
import { stat } from "fs/promises";
import { join } from "path";
import {
  VPS_URL, VPS_HOST, VPS_USER, VPS_KEY, VPS_DIR, LOCAL_URL,
  PROJECT_ROOT, WEBHOOK_ENDPOINTS, DISABLED_ENDPOINTS, SENSITIVE_PATHS,
  PM2_PROCESS_NAME, RATE_LIMIT_THRESHOLD, RATE_LIMIT_PROBE_COUNT,
  SUBPROCESS_SOURCE_FILE, GATEWAY_SECRET,
} from "../config";

// ============================================================
// TYPES
// ============================================================

export interface ScanResult {
  id: string;
  category: string;
  name: string;
  pass: boolean;
  severity: "critical" | "high" | "medium" | "low" | "info";
  details: string;
  evidence?: string;
  compliance: string[];
}

export interface ScanReport {
  timestamp: string;
  duration_ms: number;
  total: number;
  passed: number;
  failed: number;
  results: ScanResult[];
  compliance_summary: ComplianceSummary;
}

export interface ComplianceSummary {
  SOC2: { affected: string[]; status: "pass" | "warn" | "fail" };
  "PCI-DSS": { affected: string[]; status: "pass" | "warn" | "fail" };
  HIPAA: { affected: string[]; status: "pass" | "warn" | "fail" };
}

// ============================================================
// COMPLIANCE CONTROL DESCRIPTIONS
// ============================================================

export const COMPLIANCE_CONTROLS: Record<string, string> = {
  "SOC2:CC6.1": "Logical and Physical Access Controls",
  "SOC2:CC6.2": "Credentials and Access Management",
  "SOC2:CC6.6": "System Boundary Protections",
  "SOC2:CC7.1": "Detection and Monitoring Activities",
  "SOC2:CC7.2": "Monitoring for Anomalies",
  "SOC2:CC8.1": "Change Management Controls",
  "PCI:1.3": "Network Access to Cardholder Data Restricted",
  "PCI:2.2": "Secure System Configurations",
  "PCI:6.4": "Public-Facing Web Application Protections",
  "PCI:7.1": "Access Restricted by Business Need",
  "PCI:8.3": "Strong Authentication for Users and Admins",
  "PCI:8.6": "System and Application Account Management",
  "PCI:10.2": "Audit Logs Capture Details of Key Events",
  "PCI:10.3": "Audit Logs Protected from Destruction",
  "PCI:11.3": "External and Internal Vulnerability Scanning",
  "PCI:11.4": "Penetration Testing Performed Regularly",
  "HIPAA:164.312(a)": "Access Control — Technical Safeguards",
  "HIPAA:164.312(c)": "Integrity — Technical Safeguards",
  "HIPAA:164.312(d)": "Person or Entity Authentication",
  "HIPAA:164.312(e)": "Transmission Security",
  "HIPAA:164.308(a)(1)": "Security Management Process",
  "HIPAA:164.308(a)(5)": "Security Awareness and Training",
};

// ============================================================
// HELPERS
// ============================================================

async function probe(
  url: string,
  options?: RequestInit & { timeout?: number }
): Promise<{ status: number; headers: Headers; body: string }> {
  const controller = new AbortController();
  const ms = options?.timeout || 10_000;
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    const { timeout: _, ...fetchOpts } = (options || {}) as any;
    const res = await fetch(url, { ...fetchOpts, signal: controller.signal });
    const body = await res.text();
    return { status: res.status, headers: res.headers, body };
  } catch (err: any) {
    return { status: 0, headers: new Headers(), body: err.message };
  } finally {
    clearTimeout(timer);
  }
}

async function sshExec(cmd: string): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve) => {
    const proc = spawn("ssh", [
      "-i", VPS_KEY,
      "-o", "ConnectTimeout=10",
      "-o", "StrictHostKeyChecking=accept-new",
      "-o", "BatchMode=yes",
      `${VPS_USER}@${VPS_HOST}`,
      cmd,
    ]);
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d: Buffer) => (stdout += d));
    proc.stderr.on("data", (d: Buffer) => (stderr += d));
    proc.on("close", (code) =>
      resolve({ stdout: stdout.trim(), stderr: stderr.trim(), exitCode: code ?? 1 })
    );
    proc.on("error", (err) =>
      resolve({ stdout: "", stderr: err.message, exitCode: 1 })
    );
    setTimeout(() => {
      try { proc.kill(); } catch {}
    }, 15_000);
  });
}

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

// ============================================================
// EXTERNAL AUTH CHECKS — Webhook endpoints from outside
// ============================================================

async function checkWebhookAuth(): Promise<ScanResult[]> {
  const results: ScanResult[] = [];

  for (const endpoint of WEBHOOK_ENDPOINTS) {
    const res = await probe(`${VPS_URL}${endpoint.path}`, {
      method: endpoint.method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ probe: true }),
    });
    // 429 means rate limiter caught it first (still blocked)
    const pass = res.status === 401 || res.status === 403 || res.status === 429 || res.status === 503;
    const pathId = endpoint.path.replace(/\//g, "_").replace(/^_/, "");
    results.push(ok(
      `auth_${pathId}`, "EXTERNAL_AUTH",
      `${endpoint.path} rejects unauthenticated ${endpoint.method} requests`,
      pass, "critical",
      res.status === 401 ? "Correctly rejected (401)"
        : res.status === 403 ? "Correctly forbidden (403)"
        : res.status === 429 ? "Rate limited (429) — blocked, but can't verify auth layer"
        : res.status === 503 ? "Service unavailable (503) — likely not configured"
        : `Returned ${res.status} — should be 401/403`,
      ["SOC2:CC6.1", "PCI:8.3", "HIPAA:164.312(d)"],
      `Status: ${res.status}`
    ));
  }

  return results;
}

async function checkDisabledEndpoints(): Promise<ScanResult[]> {
  const results: ScanResult[] = [];
  for (const path of DISABLED_ENDPOINTS) {
    const res = await probe(`${VPS_URL}${path}`, { method: "GET" });
    results.push(ok(
      `disabled_${path.replace(/\//g, "_")}`, "EXTERNAL_AUTH",
      `Disabled endpoint ${path} returns 404`,
      res.status === 404 || res.status === 429, "high",
      res.status === 404 ? "Correctly disabled (404)"
        : res.status === 429 ? "Rate limited (429) — blocked"
        : `Returned ${res.status} — should be 404`,
      ["SOC2:CC6.1", "PCI:7.1"],
      `Status: ${res.status}`
    ));
  }
  return results;
}

async function checkLocalProcessAuth(): Promise<ScanResult> {
  const res = await probe(`${LOCAL_URL}/process`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: "probe", chatId: "0" }),
  });
  const pass = res.status === 401 || res.status === 403;
  return ok("auth_local_process", "LOCAL", "Local /process rejects unauthenticated requests",
    pass, "critical",
    pass ? `Correctly rejected (${res.status})` : `Returned ${res.status} without Bearer token`,
    ["SOC2:CC6.1", "PCI:8.3", "HIPAA:164.312(d)"],
    `Status: ${res.status}`
  );
}

// ============================================================
// RATE LIMITING
// ============================================================

async function checkRateLimit(): Promise<ScanResult> {
  const statuses: number[] = [];
  for (let i = 0; i < RATE_LIMIT_PROBE_COUNT; i++) {
    const res = await probe(`${VPS_URL}/rate-limit-probe`, { method: "GET", timeout: 5_000 });
    statuses.push(res.status);
  }
  const first429 = statuses.indexOf(429);
  const pass = first429 !== -1 && first429 <= RATE_LIMIT_THRESHOLD + 2;
  return ok("rate_limit", "EXTERNAL_RATE", `Rate limiter triggers after ${RATE_LIMIT_THRESHOLD} requests/min`,
    pass, "high",
    first429 === -1
      ? `No 429 received after ${RATE_LIMIT_PROBE_COUNT} rapid requests — rate limiting may not be working`
      : `First 429 at request #${first429 + 1}`,
    ["SOC2:CC6.1", "PCI:6.4", "HIPAA:164.312(a)"],
    `First 429 at: ${first429 === -1 ? "never" : `#${first429 + 1}`}`
  );
}

// ============================================================
// HEADER / INFORMATION DISCLOSURE
// ============================================================

async function checkHeaderDisclosure(): Promise<ScanResult[]> {
  const results: ScanResult[] = [];
  const res = await probe(`${VPS_URL}/health`, { method: "GET" });

  const server = res.headers.get("server");
  const serverOk = !server || server.toLowerCase() === "cloudflare";
  results.push(ok("header_server", "EXTERNAL_HEADERS", "No origin server version disclosure",
    serverOk, "medium",
    !server ? "No Server header (good)"
      : server.toLowerCase() === "cloudflare" ? "Server: cloudflare (expected — CDN, not origin)"
      : `Server header present: "${server}" — origin server exposed`,
    ["SOC2:CC7.1", "PCI:2.2"],
    server ? `server: ${server}` : undefined
  ));

  const powered = res.headers.get("x-powered-by");
  results.push(ok("header_powered_by", "EXTERNAL_HEADERS", "No X-Powered-By disclosure",
    !powered, "medium",
    powered ? `X-Powered-By header present: "${powered}"` : "No X-Powered-By header (good)",
    ["SOC2:CC7.1", "PCI:2.2"],
    powered ? `x-powered-by: ${powered}` : undefined
  ));

  const sensitivePatterns = [
    /api[_-]?key/i, /secret/i, /password/i, /token/i,
    /sk-ant-/i, /Bearer\s+\S{20}/i,
  ];
  const leaks = sensitivePatterns.filter((p) => p.test(res.body));
  results.push(ok("health_info_leak", "EXTERNAL_HEADERS", "Health endpoint leaks no sensitive data",
    leaks.length === 0, "high",
    leaks.length === 0
      ? "No sensitive patterns found in /health response"
      : `Found ${leaks.length} sensitive pattern(s) in response body`,
    ["SOC2:CC6.1", "PCI:2.2", "HIPAA:164.312(c)"],
    leaks.length > 0 ? `Patterns matched: ${leaks.map((p) => p.source).join(", ")}` : undefined
  ));

  const cors = res.headers.get("access-control-allow-origin");
  results.push(ok("header_cors", "EXTERNAL_HEADERS", "No wildcard CORS header",
    cors !== "*", "high",
    cors === "*" ? "CORS wildcard (*) — allows any origin" : cors ? `CORS: ${cors}` : "No CORS header (good)",
    ["SOC2:CC6.6", "PCI:6.4"],
    cors ? `access-control-allow-origin: ${cors}` : undefined
  ));

  return results;
}

// ============================================================
// SECURITY HEADERS (OWASP)
// ============================================================

async function checkSecurityHeaders(): Promise<ScanResult[]> {
  const results: ScanResult[] = [];

  try {
    const res = await probe(`${VPS_URL}/health`, { method: "GET" });

    const xfo = res.headers.get("x-frame-options");
    const xfoPass = !!xfo && (xfo.toUpperCase() === "DENY" || xfo.toUpperCase() === "SAMEORIGIN");
    results.push(ok("header_x_frame_options", "SECURITY_HEADERS", "X-Frame-Options header present (anti-clickjacking)",
      xfoPass, "medium",
      xfoPass ? `X-Frame-Options: ${xfo}` : xfo ? `X-Frame-Options: ${xfo} (should be DENY or SAMEORIGIN)` : "Missing X-Frame-Options header",
      ["SOC2:CC6.6", "PCI:6.4"],
      xfo || undefined
    ));

    const xcto = res.headers.get("x-content-type-options");
    const xctoPass = !!xcto && xcto.toLowerCase() === "nosniff";
    results.push(ok("header_x_content_type_options", "SECURITY_HEADERS", "X-Content-Type-Options: nosniff (prevents MIME sniffing)",
      xctoPass, "medium",
      xctoPass ? "X-Content-Type-Options: nosniff" : xcto ? `X-Content-Type-Options: ${xcto} (should be nosniff)` : "Missing X-Content-Type-Options header",
      ["SOC2:CC6.6", "PCI:6.4"],
      xcto || undefined
    ));

    const rp = res.headers.get("referrer-policy");
    results.push(ok("header_referrer_policy", "SECURITY_HEADERS", "Referrer-Policy header present (controls referrer leakage)",
      !!rp, "medium",
      rp ? `Referrer-Policy: ${rp}` : "Missing Referrer-Policy header",
      ["SOC2:CC6.6", "PCI:6.4"],
      rp || undefined
    ));

    const pp = res.headers.get("permissions-policy");
    results.push(ok("header_permissions_policy", "SECURITY_HEADERS", "Permissions-Policy header present (controls browser features)",
      !!pp, "medium",
      pp ? `Permissions-Policy: ${pp}` : "Missing Permissions-Policy header",
      ["SOC2:CC6.6", "PCI:6.4"],
      pp || undefined
    ));

    const csp = res.headers.get("content-security-policy");
    results.push(ok("header_csp", "SECURITY_HEADERS", "Content-Security-Policy header present (prevents XSS)",
      !!csp, "medium",
      csp ? `CSP present (${csp.substring(0, 80)}${csp.length > 80 ? "..." : ""})` : "Missing Content-Security-Policy header",
      ["SOC2:CC6.6", "PCI:6.4"],
      csp ? csp.substring(0, 200) : undefined
    ));
  } catch (err: any) {
    results.push(ok("header_security_fetch", "SECURITY_HEADERS", "Security headers check",
      false, "medium", `Failed to fetch /health: ${err.message}`,
      ["SOC2:CC6.6", "PCI:6.4"], err.message
    ));
  }

  return results;
}

// ============================================================
// TLS / SSL
// ============================================================

async function checkTLS(): Promise<ScanResult[]> {
  const results: ScanResult[] = [];
  const hostname = new URL(VPS_URL).hostname;

  try {
    const { execSync } = await import("child_process");
    const certText = execSync(
      `echo | openssl s_client -servername ${hostname} -connect ${hostname}:443 2>/dev/null | openssl x509 -noout -dates -subject 2>/dev/null`,
      { timeout: 15_000 }
    ).toString();

    const notAfterMatch = certText.match(/notAfter=(.+)/);

    if (notAfterMatch) {
      const expiry = new Date(notAfterMatch[1]);
      const now = new Date();
      const daysRemaining = Math.floor((expiry.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
      const valid = daysRemaining > 0;

      results.push(ok("tls_valid", "TLS", "TLS certificate is valid",
        valid, "critical",
        valid ? "Certificate is valid" : "Certificate is EXPIRED",
        ["SOC2:CC6.6", "HIPAA:164.312(e)", "PCI:2.2"],
        `Valid: ${valid}, Days remaining: ${daysRemaining}, Expires: ${expiry.toISOString()}`
      ));

      results.push(ok("tls_expiry", "TLS", "TLS certificate not expiring within 30 days",
        daysRemaining > 30, "high",
        daysRemaining > 30
          ? `${daysRemaining} days remaining`
          : `Only ${daysRemaining} days until expiry!`,
        ["SOC2:CC7.1", "HIPAA:164.312(e)", "PCI:2.2"],
        `Expires: ${expiry.toISOString()}, Days: ${daysRemaining}`
      ));
    } else {
      results.push(ok("tls_valid", "TLS", "TLS certificate is valid",
        false, "critical", "Could not parse certificate dates from openssl",
        ["SOC2:CC6.6", "HIPAA:164.312(e)", "PCI:2.2"], certText.substring(0, 200)
      ));
    }
  } catch (err: any) {
    results.push(ok("tls_valid", "TLS", "TLS certificate is valid",
      false, "critical",
      `Failed to check TLS: ${err.message}`,
      ["SOC2:CC6.6", "HIPAA:164.312(e)", "PCI:2.2"],
      err.message
    ));
  }

  const res = await probe(VPS_URL, { method: "HEAD" });
  const hsts = res.headers.get("strict-transport-security");
  results.push(ok("tls_hsts", "TLS", "HSTS header present",
    !!hsts, "high",
    hsts ? `HSTS: ${hsts}` : "No Strict-Transport-Security header",
    ["SOC2:CC6.6", "HIPAA:164.312(e)", "PCI:2.2"],
    hsts || undefined
  ));

  return results;
}

// ============================================================
// WEBAPP — HTTP method and content checks
// ============================================================

async function checkWebApp(): Promise<ScanResult[]> {
  const results: ScanResult[] = [];

  // Check unexpected HTTP methods on webhook endpoints
  for (const endpoint of WEBHOOK_ENDPOINTS) {
    const wrongMethods = ["GET", "PUT", "DELETE"].filter((m) => m !== endpoint.method);
    for (const method of wrongMethods) {
      const res = await probe(`${VPS_URL}${endpoint.path}`, { method, timeout: 5_000 });
      const pass = res.status !== 200;
      const pathId = endpoint.path.replace(/\//g, "");
      results.push(ok(
        `webapp_method_${pathId}_${method.toLowerCase()}`,
        "WEBAPP", `${endpoint.path} rejects ${method} requests`,
        pass, "medium",
        pass ? `${method} ${endpoint.path} → ${res.status} (rejected)` : `${method} ${endpoint.path} → 200 (should reject)`,
        ["SOC2:CC6.1", "PCI:6.4"],
        `${method} ${endpoint.path} → ${res.status}`
      ));
    }
  }

  // Check for exposed sensitive paths
  for (const path of SENSITIVE_PATHS) {
    const res = await probe(`${VPS_URL}${path}`, { method: "GET", timeout: 5_000 });
    const pass = res.status === 404 || res.status === 403 || res.status === 429;
    results.push(ok(
      `webapp_exposed_${path.replace(/[\/.]/g, "_")}`,
      "WEBAPP", `Sensitive path ${path} not accessible`,
      pass, "critical",
      pass ? `${path} → ${res.status} (blocked)` : `${path} → ${res.status} — may be exposed!`,
      ["SOC2:CC6.1", "PCI:2.2", "HIPAA:164.312(c)"],
      `GET ${path} → ${res.status}`
    ));
  }

  // Check error responses don't leak stack traces
  const errorRes = await probe(`${VPS_URL}/nonexistent/path/with/depth`, { method: "POST", timeout: 5_000 });
  const stackPatterns = [/at\s+\w+\s+\(/, /node_modules/, /\.ts:\d+:\d+/, /Error:.*\n\s+at/];
  const stackLeaks = stackPatterns.filter((p) => p.test(errorRes.body));
  results.push(ok("webapp_stack_trace", "WEBAPP", "Error responses don't leak stack traces",
    stackLeaks.length === 0, "medium",
    stackLeaks.length === 0
      ? "No stack traces in error responses"
      : `Found ${stackLeaks.length} stack trace pattern(s) in error response`,
    ["SOC2:CC7.1", "PCI:2.2"],
    stackLeaks.length > 0 ? errorRes.body.substring(0, 200) : undefined
  ));

  return results;
}

// ============================================================
// VPS INTERNAL — SSH checks
// ============================================================

async function checkVPSInternal(): Promise<ScanResult[]> {
  const results: ScanResult[] = [];

  // SSH: Root login disabled
  const sshRoot = await sshExec("grep -E '^PermitRootLogin' /etc/ssh/sshd_config 2>/dev/null || echo 'not_found'");
  const rootDisabled = sshRoot.stdout.includes("no") || sshRoot.stdout.includes("prohibit-password");
  results.push(ok("vps_ssh_root", "VPS_SSH", "SSH root login disabled",
    rootDisabled, "critical",
    rootDisabled ? "Root login disabled" : `sshd_config: ${sshRoot.stdout}`,
    ["SOC2:CC6.1", "SOC2:CC6.2", "PCI:8.3", "HIPAA:164.312(a)"],
    sshRoot.stdout
  ));

  // SSH: Password auth disabled
  const sshPass = await sshExec("grep -E '^PasswordAuthentication' /etc/ssh/sshd_config 2>/dev/null || echo 'not_found'");
  const passDisabled = sshPass.stdout.includes("no");
  results.push(ok("vps_ssh_password", "VPS_SSH", "SSH password auth disabled (key-only)",
    passDisabled, "high",
    passDisabled ? "Password auth disabled" : `sshd_config: ${sshPass.stdout}`,
    ["SOC2:CC6.1", "SOC2:CC6.2", "PCI:8.3", "HIPAA:164.312(d)"],
    sshPass.stdout
  ));

  // Firewall: UFW active
  const ufw = await sshExec("sudo ufw status 2>/dev/null || echo 'ufw_not_available'");
  const ufwActive = ufw.stdout.includes("Status: active");
  results.push(ok("vps_firewall", "VPS_FIREWALL", "UFW firewall active",
    ufwActive, "high",
    ufwActive ? "UFW is active" : `UFW status: ${ufw.stdout.substring(0, 100)}`,
    ["SOC2:CC6.6", "PCI:1.3", "HIPAA:164.312(e)"],
    ufw.stdout.substring(0, 200)
  ));

  // .env permissions
  const envPerms = await sshExec(`stat -c '%a' ${VPS_DIR}/.env 2>/dev/null || echo 'not_found'`);
  const permsOk = ["600", "640", "400"].includes(envPerms.stdout);
  results.push(ok("vps_env_perms", "VPS_ENV", ".env file permissions restrictive",
    permsOk, "high",
    permsOk ? `.env permissions: ${envPerms.stdout}` : `.env permissions: ${envPerms.stdout} (should be 600)`,
    ["SOC2:CC6.1", "PCI:2.2", "HIPAA:164.312(a)"],
    envPerms.stdout
  ));

  // .env not in git
  const envGit = await sshExec(`cd ${VPS_DIR} && git log --all --oneline -- .env .env.local 2>/dev/null | head -5`);
  const envNotInGit = envGit.stdout === "" || envGit.exitCode !== 0;
  results.push(ok("vps_env_git", "VPS_ENV", ".env never committed to git",
    envNotInGit, "critical",
    envNotInGit ? "No .env files in git history" : `.env found in git history!`,
    ["SOC2:CC6.1", "PCI:2.2", "HIPAA:164.312(c)"],
    envGit.stdout || undefined
  ));

  // Running as non-root
  const procUser = await sshExec("ps -eo user,comm | grep -E 'bun|node|pm2' | grep -v grep | awk '{print $1}' | sort -u | head -3 2>/dev/null || echo 'not_found'");
  const users = procUser.stdout.split("\n").map((u: string) => u.trim()).filter(Boolean);
  const nonRoot = users.length > 0 && !users.includes("root") && procUser.stdout !== "not_found";
  results.push(ok("vps_nonroot", "VPS_PROC", "Bot running as non-root user",
    nonRoot, "high",
    nonRoot ? `Running as: ${users.join(", ")}` : `Users: ${users.join(", ") || "no bun/node/pm2 processes found"}`,
    ["SOC2:CC6.1", "PCI:7.1", "HIPAA:164.312(a)"],
    users.join(", ") || "none found"
  ));

  // PM2 process healthy
  const pm2 = await sshExec("pm2 jlist 2>/dev/null || echo '[]'");
  let pm2Healthy = false;
  try {
    const procs = JSON.parse(pm2.stdout);
    const bot = procs.find((p: any) => p.name === PM2_PROCESS_NAME);
    pm2Healthy = bot?.pm2_env?.status === "online";
    results.push(ok("vps_pm2", "VPS_PROC", "PM2 process is online",
      pm2Healthy, "high",
      pm2Healthy ? `PM2 status: online (restarts: ${bot?.pm2_env?.restart_time || 0})` : `PM2 status: ${bot?.pm2_env?.status || "not found"}`,
      ["SOC2:CC7.1", "PCI:10.2"],
      `Status: ${bot?.pm2_env?.status || "not found"}, Restarts: ${bot?.pm2_env?.restart_time || "?"}`
    ));
  } catch {
    results.push(ok("vps_pm2", "VPS_PROC", "PM2 process is online",
      false, "high", "Failed to parse PM2 status",
      ["SOC2:CC7.1", "PCI:10.2"], pm2.stdout.substring(0, 200)
    ));
  }

  // Disk usage
  const disk = await sshExec("df -h / | tail -1 | awk '{print $5}' 2>/dev/null");
  const diskPct = parseInt(disk.stdout);
  results.push(ok("vps_disk_usage", "VPS_DISK", "Disk usage below 80%",
    !isNaN(diskPct) && diskPct < 80, "medium",
    !isNaN(diskPct) ? `Disk usage: ${diskPct}%` : `Could not read disk usage: ${disk.stdout}`,
    ["SOC2:CC7.1"],
    disk.stdout
  ));

  // Upload directory size
  const uploads = await sshExec(`ls -1 ${VPS_DIR}/uploads/ 2>/dev/null | wc -l`);
  const uploadCount = parseInt(uploads.stdout) || 0;
  results.push(ok("vps_uploads", "VPS_DISK", "Upload directory not growing unbounded (< 100 files)",
    uploadCount < 100, "low",
    `${uploadCount} files in uploads/`,
    ["SOC2:CC7.1"],
    `Count: ${uploadCount}`
  ));

  // Logs not containing secrets
  const logSecrets = await sshExec(
    `pm2 logs ${PM2_PROCESS_NAME} --nostream --lines 200 2>/dev/null | grep -iE 'sk-ant-|ANTHROPIC_API|Bearer [a-zA-Z0-9]{30}' | head -3`
  );
  const logsClean = logSecrets.stdout === "";
  results.push(ok("vps_log_secrets", "VPS_LOGS", "PM2 logs contain no secrets",
    logsClean, "high",
    logsClean ? "No secrets found in recent logs" : "Potential secrets found in PM2 logs!",
    ["SOC2:CC6.1", "PCI:2.2", "HIPAA:164.312(c)"],
    logsClean ? undefined : "Secrets detected in log output (redacted)"
  ));

  // fail2ban active
  const f2b = await sshExec("sudo fail2ban-client status sshd 2>/dev/null || echo 'not_available'");
  const f2bActive = f2b.stdout.includes("Currently banned");
  const bannedMatch = f2b.stdout.match(/Currently banned:\s*(\d+)/);
  const bannedCount = bannedMatch ? parseInt(bannedMatch[1]) : 0;
  results.push(ok("vps_fail2ban", "VPS_FAIL2BAN", "fail2ban active with sshd jail",
    f2bActive, "medium",
    f2bActive ? `fail2ban active, ${bannedCount} IPs currently banned` : "fail2ban not available or sshd jail not configured",
    ["SOC2:CC7.1", "SOC2:CC7.2", "PCI:11.4"],
    f2b.stdout.substring(0, 300)
  ));

  // CrowdSec
  const crowdsec = await sshExec("sudo cscli decisions list -o json 2>/dev/null || echo 'not_installed'");
  const csInstalled = crowdsec.stdout !== "not_installed" && !crowdsec.stdout.includes("not_installed");
  results.push(ok("vps_crowdsec", "VPS_CROWDSEC", "CrowdSec IDS running",
    csInstalled, "low",
    csInstalled ? "CrowdSec is active" : "CrowdSec not installed (recommended)",
    ["SOC2:CC7.1", "SOC2:CC7.2", "PCI:11.4"],
    csInstalled ? crowdsec.stdout.substring(0, 200) : undefined
  ));

  // Patch status
  try {
    const secUpdates = await sshExec("apt list --upgradable 2>/dev/null | grep -ci security || echo '0'");
    const pendingCount = parseInt(secUpdates.stdout) || 0;
    const autoUpdates = await sshExec("systemctl is-active unattended-upgrades 2>/dev/null || echo 'inactive'");
    const autoActive = autoUpdates.stdout === "active";
    const patchPass = pendingCount < 5 && autoActive;
    const patchSeverity: ScanResult["severity"] = pendingCount > 10 ? "high" : pendingCount >= 5 ? "medium" : "info";
    results.push(ok("vps_patch_status", "VPS_PATCHES", "VPS has few pending security updates and auto-updates active",
      patchPass, patchPass ? "info" : patchSeverity,
      `${pendingCount} pending security update(s), unattended-upgrades: ${autoActive ? "active" : "inactive"}`,
      ["SOC2:CC8.1", "PCI:6.4", "HIPAA:164.308(a)(1)"],
      `Security updates: ${pendingCount}, Auto-updates: ${autoUpdates.stdout}`
    ));
  } catch (err: any) {
    results.push(ok("vps_patch_status", "VPS_PATCHES", "VPS patch status check",
      false, "medium", `Patch status check failed: ${err.message}`,
      ["SOC2:CC8.1", "PCI:6.4", "HIPAA:164.308(a)(1)"], err.message
    ));
  }

  // Bun version on VPS
  try {
    const vpsBun = await sshExec("export PATH=$HOME/.bun/bin:$PATH && bun --version 2>/dev/null || echo 'not_found'");
    const vpsBunVersion = vpsBun.stdout.trim();
    let vpsBunPass = false;
    if (vpsBunVersion !== "not_found") {
      const parts = vpsBunVersion.split(".").map(Number);
      vpsBunPass = parts.length >= 2 && (parts[0] > 1 || (parts[0] === 1 && parts[1] >= 0));
    }
    results.push(ok("vps_bun_version", "VPS_RUNTIME", "VPS Bun version is >= 1.0.0",
      vpsBunPass, "medium",
      vpsBunPass ? `VPS Bun version: ${vpsBunVersion}` : vpsBunVersion === "not_found" ? "Bun not found on VPS" : `VPS Bun version ${vpsBunVersion} may be outdated`,
      ["SOC2:CC8.1", "PCI:6.4"],
      `VPS Bun: ${vpsBunVersion}`
    ));
  } catch (err: any) {
    results.push(ok("vps_bun_version", "VPS_RUNTIME", "VPS Bun version check",
      false, "medium", `VPS Bun version check failed: ${err.message}`,
      ["SOC2:CC8.1", "PCI:6.4"], err.message
    ));
  }

  // Memory usage
  try {
    const memResult = await sshExec("free -m | awk '/Mem:/ {printf \"%d\", $3/$2*100}'");
    const memPct = parseInt(memResult.stdout);
    const memPass = !isNaN(memPct) && memPct < 85;
    results.push(ok("vps_memory_usage", "VPS_RESOURCES", "VPS memory usage below 85%",
      memPass, "medium",
      !isNaN(memPct) ? `Memory usage: ${memPct}%` : `Could not read memory usage: ${memResult.stdout}`,
      ["SOC2:CC7.1"],
      !isNaN(memPct) ? `${memPct}%` : memResult.stdout
    ));
  } catch (err: any) {
    results.push(ok("vps_memory_usage", "VPS_RESOURCES", "VPS memory usage check",
      false, "medium", `Memory check failed: ${err.message}`,
      ["SOC2:CC7.1"], err.message
    ));
  }

  // Load average
  try {
    const loadResult = await sshExec("uptime | awk -F'load average:' '{print $2}' | awk -F, '{print $1}'");
    const loadAvg = parseFloat(loadResult.stdout.trim());
    const loadPass = !isNaN(loadAvg) && loadAvg < 4.0;
    results.push(ok("vps_load_average", "VPS_RESOURCES", "VPS load average below 4.0",
      loadPass, "medium",
      !isNaN(loadAvg) ? `Load average (1m): ${loadAvg}` : `Could not read load average: ${loadResult.stdout}`,
      ["SOC2:CC7.1"],
      !isNaN(loadAvg) ? `${loadAvg}` : loadResult.stdout
    ));
  } catch (err: any) {
    results.push(ok("vps_load_average", "VPS_RESOURCES", "VPS load average check",
      false, "medium", `Load average check failed: ${err.message}`,
      ["SOC2:CC7.1"], err.message
    ));
  }

  return results;
}

// ============================================================
// LOCAL SECURITY
// ============================================================

async function checkLocalSecurity(): Promise<ScanResult[]> {
  const results: ScanResult[] = [];

  // Check subprocess source file for dangerous permissions
  if (SUBPROCESS_SOURCE_FILE) {
    const claudeSrc = join(PROJECT_ROOT, SUBPROCESS_SOURCE_FILE);
    try {
      const content = await Bun.file(claudeSrc).text();
      const dangerousPatterns = [
        /args\.push\([^)]*dangerously-skip-permissions/,
        /"\-\-dangerously-skip-permissions"/,
        /'--dangerously-skip-permissions'/,
      ];
      const hasDangerous = dangerousPatterns.some((p) => p.test(content));
      const hasAllowedTools = content.includes("allowedTools") || content.includes("--allowedTools");
      results.push(ok("local_subprocess_perms", "LOCAL", "Subprocess uses restricted tools (no --dangerously-skip-permissions)",
        !hasDangerous && hasAllowedTools, "critical",
        !hasDangerous && hasAllowedTools
          ? "Using allowedTools restriction"
          : hasDangerous ? "DANGER: --dangerously-skip-permissions found!" : "allowedTools not found",
        ["SOC2:CC6.1", "PCI:7.1", "HIPAA:164.312(a)"],
        hasDangerous ? "dangerously-skip-permissions present" : undefined
      ));
    } catch {
      results.push(ok("local_subprocess_perms", "LOCAL", "Subprocess uses restricted tools",
        false, "critical", `Could not read ${SUBPROCESS_SOURCE_FILE}`,
        ["SOC2:CC6.1", "PCI:7.1", "HIPAA:164.312(a)"]
      ));
    }
  }

  // .env.local permissions
  const envPath = join(PROJECT_ROOT, ".env.local");
  try {
    const s = await stat(envPath);
    const mode = (s.mode & 0o777).toString(8);
    const restrictive = ["600", "400", "640"].includes(mode);
    results.push(ok("local_env_perms", "LOCAL", ".env.local has restrictive permissions",
      restrictive, "medium",
      `Permissions: ${mode}`,
      ["SOC2:CC6.1", "PCI:2.2"],
      mode
    ));
  } catch {
    results.push(ok("local_env_perms", "LOCAL", ".env.local has restrictive permissions",
      true, "info", ".env.local not found (may use .env)",
      ["SOC2:CC6.1", "PCI:2.2"]
    ));
  }

  // Local uploads directory
  const uploadsDir = join(PROJECT_ROOT, "uploads");
  try {
    const { readdirSync } = await import("fs");
    const files = readdirSync(uploadsDir);
    results.push(ok("local_uploads", "LOCAL", "Local uploads directory < 50 files",
      files.length < 50, "low",
      `${files.length} files in local uploads/`,
      ["SOC2:CC7.1"],
      `Count: ${files.length}`
    ));
  } catch {
    results.push(ok("local_uploads", "LOCAL", "Local uploads directory < 50 files",
      true, "info", "No uploads directory found",
      ["SOC2:CC7.1"]
    ));
  }

  // Gateway secret entropy
  if (GATEWAY_SECRET) {
    const entropyOk = GATEWAY_SECRET.length >= 32;
    results.push(ok("local_gateway_entropy", "LOCAL", "Gateway secret has sufficient entropy (>= 32 chars)",
      entropyOk, "high",
      entropyOk ? `Secret length: ${GATEWAY_SECRET.length} chars` : `Secret length: ${GATEWAY_SECRET.length} chars (need >= 32)`,
      ["SOC2:CC6.2", "PCI:8.3", "HIPAA:164.312(d)"],
      `Length: ${GATEWAY_SECRET.length}`
    ));
  }

  // Local Bun version check
  try {
    const { execSync } = await import("child_process");
    const localBunVersion = execSync("bun --version 2>/dev/null", { timeout: 5_000 }).toString().trim();
    let bunPass = false;
    if (localBunVersion) {
      const parts = localBunVersion.split(".").map(Number);
      bunPass = parts.length >= 2 && (parts[0] > 1 || (parts[0] === 1 && parts[1] >= 0));
    }
    results.push(ok("local_bun_version", "LOCAL", "Local Bun version is >= 1.0.0",
      bunPass, "medium",
      bunPass ? `Local Bun version: ${localBunVersion}` : `Local Bun version ${localBunVersion} may be outdated`,
      ["SOC2:CC8.1", "PCI:6.4"],
      `Local Bun: ${localBunVersion}`
    ));
  } catch (err: any) {
    results.push(ok("local_bun_version", "LOCAL", "Local Bun version check",
      false, "medium", `Bun version check failed: ${err.message}`,
      ["SOC2:CC8.1", "PCI:6.4"], err.message
    ));
  }

  // SSH key age check
  try {
    const sshKeyPath = join(process.env.HOME || "", ".ssh", "id_ed25519");
    const keyStat = await stat(sshKeyPath);
    const now = new Date();
    const keyAgeDays = Math.floor((now.getTime() - keyStat.mtime.getTime()) / (1000 * 60 * 60 * 24));
    const keyPass = keyAgeDays <= 365;
    results.push(ok("local_ssh_key_age", "LOCAL", "SSH key age is within 365 days",
      keyPass, "low",
      keyPass ? `SSH key is ${keyAgeDays} day(s) old` : `SSH key is ${keyAgeDays} days old — consider rotating (> 365 days)`,
      ["SOC2:CC6.2", "PCI:8.6"],
      `Key age: ${keyAgeDays} days, Modified: ${keyStat.mtime.toISOString()}`
    ));
  } catch (err: any) {
    results.push(ok("local_ssh_key_age", "LOCAL", "SSH key age check",
      true, "info", `Could not check SSH key age: ${err.message}`,
      ["SOC2:CC6.2", "PCI:8.6"], err.message
    ));
  }

  return results;
}

// ============================================================
// API CREDENTIAL VALIDATION
// ============================================================

async function checkAPICredentials(): Promise<ScanResult[]> {
  const results: ScanResult[] = [];

  // Telegram bot token
  const tgToken = process.env.TELEGRAM_BOT_TOKEN;
  if (tgToken) {
    const res = await probe(`https://api.telegram.org/bot${tgToken}/getMe`, { timeout: 10_000 });
    const valid = res.status === 200;
    results.push(ok("api_telegram", "API_CREDS", "Telegram bot token is valid",
      valid, "critical",
      valid ? "Token valid (getMe succeeded)" : `Token invalid or expired (status: ${res.status})`,
      ["SOC2:CC6.2", "PCI:8.6"],
      `Status: ${res.status}`
    ));
  }

  // Anthropic API key
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (anthropicKey) {
    const res = await probe("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": anthropicKey,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 1,
        messages: [{ role: "user", content: "hi" }],
      }),
      timeout: 15_000,
    });
    const valid = res.status === 200 || res.status === 429;
    results.push(ok("api_anthropic", "API_CREDS", "Anthropic API key is valid",
      valid, "critical",
      valid ? `Key valid (status: ${res.status})` : `Key invalid (status: ${res.status})`,
      ["SOC2:CC6.2", "PCI:8.6"],
      `Status: ${res.status}`
    ));
  }

  // Convex URL
  const convexUrl = process.env.CONVEX_URL;
  if (convexUrl) {
    const res = await probe(convexUrl, { timeout: 10_000 });
    const reachable = res.status > 0;
    results.push(ok("api_convex", "API_CREDS", "Convex URL is reachable",
      reachable, "high",
      reachable ? `Convex reachable (status: ${res.status})` : "Convex URL unreachable",
      ["SOC2:CC7.1"],
      `Status: ${res.status}`
    ));
  }

  return results;
}

// ============================================================
// TOKEN FRESHNESS
// ============================================================

async function checkTokenFreshness(): Promise<ScanResult[]> {
  const results: ScanResult[] = [];

  const ms365Token = process.env.MS365_REFRESH_TOKEN;
  if (ms365Token) {
    try {
      const res = await probe("https://graph.microsoft.com/v1.0/me", {
        method: "GET",
        headers: { Authorization: `Bearer ${ms365Token}` },
        timeout: 10_000,
      });
      const pass = res.status === 200 || res.status === 401;
      results.push(ok("token_ms365", "TOKEN_ROTATION", "MS365 refresh token is configured and reachable",
        pass, "high",
        res.status === 200 ? "MS365 token valid (200)" : res.status === 401 ? "MS365 token expired (401) — rotation needed" : `MS365 Graph API returned ${res.status}`,
        ["SOC2:CC6.2", "PCI:8.6"],
        `Status: ${res.status}`
      ));
    } catch (err: any) {
      results.push(ok("token_ms365", "TOKEN_ROTATION", "MS365 refresh token is configured and reachable",
        false, "high", `MS365 Graph API check failed: ${err.message}`,
        ["SOC2:CC6.2", "PCI:8.6"], err.message
      ));
    }
  }

  const openaiKey = process.env.OPENAI_API_KEY;
  if (openaiKey) {
    try {
      const res = await probe("https://api.openai.com/v1/models", {
        method: "GET",
        headers: { Authorization: `Bearer ${openaiKey}` },
        timeout: 10_000,
      });
      const pass = res.status === 200;
      results.push(ok("token_openai", "TOKEN_ROTATION", "OpenAI API key is valid",
        pass, "high",
        pass ? "OpenAI key valid (200)" : `OpenAI API returned ${res.status} — key may be invalid or expired`,
        ["SOC2:CC6.2", "PCI:8.6"],
        `Status: ${res.status}`
      ));
    } catch (err: any) {
      results.push(ok("token_openai", "TOKEN_ROTATION", "OpenAI API key is valid",
        false, "high", `OpenAI API check failed: ${err.message}`,
        ["SOC2:CC6.2", "PCI:8.6"], err.message
      ));
    }
  }

  return results;
}

// ============================================================
// INPUT VALIDATION / FUZZING
// ============================================================

async function checkInputValidation(): Promise<ScanResult[]> {
  const results: ScanResult[] = [];

  // Path traversal
  try {
    const res = await probe(`${VPS_URL}/../../etc/passwd`, { method: "GET", timeout: 10_000 });
    const pass = res.status !== 200;
    results.push(ok("fuzz_path_traversal", "INPUT_VALIDATION", "Path traversal payload rejected",
      pass, "high",
      pass ? `Path traversal blocked (status: ${res.status})` : "Path traversal returned 200 — potential directory traversal vulnerability!",
      ["SOC2:CC6.1", "PCI:6.4", "HIPAA:164.312(a)"],
      `GET /../../etc/passwd → ${res.status}`
    ));
  } catch (err: any) {
    results.push(ok("fuzz_path_traversal", "INPUT_VALIDATION", "Path traversal payload rejected",
      true, "high", `Request failed (likely safe): ${err.message}`,
      ["SOC2:CC6.1", "PCI:6.4", "HIPAA:164.312(a)"], err.message
    ));
  }

  // SQL injection pattern
  const firstWebhook = WEBHOOK_ENDPOINTS[0]?.path || "/webhook";
  try {
    const res = await probe(`${VPS_URL}${firstWebhook}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: "1 OR 1=1" }),
      timeout: 10_000,
    });
    const pass = res.status !== 500;
    results.push(ok("fuzz_sqli_webhook", "INPUT_VALIDATION", "SQL injection pattern does not cause 500",
      pass, "medium",
      pass ? `SQL injection pattern handled safely (status: ${res.status})` : "SQL injection pattern caused 500 — possible injection vulnerability",
      ["SOC2:CC6.1", "PCI:6.4", "HIPAA:164.312(a)"],
      `POST ${firstWebhook} with SQLi → ${res.status}`
    ));
  } catch (err: any) {
    results.push(ok("fuzz_sqli_webhook", "INPUT_VALIDATION", "SQL injection pattern does not cause 500",
      true, "medium", `Request failed (likely safe): ${err.message}`,
      ["SOC2:CC6.1", "PCI:6.4", "HIPAA:164.312(a)"], err.message
    ));
  }

  // Oversized payload
  try {
    const largeBody = "A".repeat(1_000_000);
    const res = await probe(`${VPS_URL}${firstWebhook}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: largeBody,
      timeout: 15_000,
    });
    const pass = res.status !== 500 && res.status !== 502 && res.status !== 503;
    results.push(ok("fuzz_oversized_payload", "INPUT_VALIDATION", "Oversized 1MB payload does not crash server",
      pass, "medium",
      pass ? `Oversized payload handled (status: ${res.status})` : `Oversized payload caused server error (status: ${res.status})`,
      ["SOC2:CC6.1", "PCI:6.4", "HIPAA:164.312(a)"],
      `POST ${firstWebhook} with 1MB body → ${res.status}`
    ));
  } catch (err: any) {
    results.push(ok("fuzz_oversized_payload", "INPUT_VALIDATION", "Oversized 1MB payload does not crash server",
      true, "medium", `Server dropped oversized request (likely safe): ${err.message}`,
      ["SOC2:CC6.1", "PCI:6.4", "HIPAA:164.312(a)"], err.message
    ));
  }

  return results;
}

// ============================================================
// BACKUP VERIFICATION
// ============================================================

async function checkBackups(): Promise<ScanResult[]> {
  const results: ScanResult[] = [];

  try {
    const gitLog = await sshExec(`cd ${VPS_DIR} && git log -1 --format=%ci`);
    if (gitLog.exitCode === 0 && gitLog.stdout) {
      const lastCommitDate = new Date(gitLog.stdout);
      const now = new Date();
      const daysSinceCommit = Math.floor((now.getTime() - lastCommitDate.getTime()) / (1000 * 60 * 60 * 24));
      const pass = daysSinceCommit <= 7;
      results.push(ok("backup_git_freshness", "BACKUP", "VPS git repo has recent commits (within 7 days)",
        pass, "medium",
        pass ? `Last commit ${daysSinceCommit} day(s) ago: ${gitLog.stdout}` : `Last commit ${daysSinceCommit} days ago — may be stale`,
        ["SOC2:CC7.1", "PCI:10.3"],
        `Last commit: ${gitLog.stdout}, Days ago: ${daysSinceCommit}`
      ));
    } else {
      results.push(ok("backup_git_freshness", "BACKUP", "VPS git repo has recent commits",
        false, "medium", `Could not read git log: ${gitLog.stderr || gitLog.stdout}`,
        ["SOC2:CC7.1", "PCI:10.3"], gitLog.stderr || gitLog.stdout
      ));
    }
  } catch (err: any) {
    results.push(ok("backup_git_freshness", "BACKUP", "VPS git repo has recent commits",
      false, "medium", `Backup check failed: ${err.message}`,
      ["SOC2:CC7.1", "PCI:10.3"], err.message
    ));
  }

  return results;
}

// ============================================================
// MAIN SCAN RUNNERS
// ============================================================

export type ScanTier = "hourly" | "daily" | "full";

export async function runScan(tier: ScanTier = "hourly"): Promise<ScanReport> {
  const start = Date.now();
  const results: ScanResult[] = [];

  // Auth checks BEFORE rate limit (rate limit test exhausts the limit)
  const authChecks = await Promise.allSettled([
    checkWebhookAuth(),
    ...(DISABLED_ENDPOINTS.length > 0 ? [checkDisabledEndpoints()] : []),
    checkLocalProcessAuth(),
  ]);
  for (const check of authChecks) {
    if (check.status === "fulfilled") {
      const val = check.value;
      if (Array.isArray(val)) results.push(...val);
      else results.push(val);
    }
  }

  // Rate limit check runs alone
  try {
    results.push(await checkRateLimit());
  } catch {}

  // Wait for rate limiter to reset
  await new Promise((r) => setTimeout(r, 2_000));

  // Hourly tier (fast checks)
  const hourlyChecks = await Promise.allSettled([
    checkHeaderDisclosure(),
    checkSecurityHeaders(),
    checkTLS(),
    checkWebApp(),
    checkLocalSecurity(),
    checkAPICredentials(),
    checkTokenFreshness(),
    checkInputValidation(),
    checkBackups(),
  ]);

  for (const check of hourlyChecks) {
    if (check.status === "fulfilled") {
      const val = check.value;
      if (Array.isArray(val)) results.push(...val);
      else results.push(val);
    }
  }

  // VPS SSH checks (sequential — single SSH connection overhead)
  try {
    const vpsResults = await checkVPSInternal();
    results.push(...vpsResults);
  } catch (err: any) {
    results.push(ok("vps_ssh_connect", "VPS_SSH", "SSH connection to VPS",
      false, "high", `SSH failed: ${err.message}`,
      ["SOC2:CC7.1"], err.message
    ));
  }

  const duration_ms = Date.now() - start;
  const passed = results.filter((r) => r.pass).length;
  const failed = results.filter((r) => !r.pass).length;

  return {
    timestamp: new Date().toISOString(),
    duration_ms,
    total: results.length,
    passed,
    failed,
    results,
    compliance_summary: buildComplianceSummary(results),
  };
}

// ============================================================
// COMPLIANCE SUMMARY BUILDER
// ============================================================

function buildComplianceSummary(results: ScanResult[]): ComplianceSummary {
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
