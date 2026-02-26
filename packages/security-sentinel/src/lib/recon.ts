/**
 * Security Recon — API-based external reconnaissance
 *
 * Zero-install checks using free APIs:
 * - Shodan InternetDB (open ports, known vulns)
 * - crt.sh (certificate transparency)
 * - DNS over HTTPS (record integrity)
 * - OSV.dev (dependency vulnerability checking)
 */

import { readFile } from "fs/promises";
import { join } from "path";
import type { ScanResult } from "./scanner";
import { VPS_HOST, DOMAIN, PROJECT_ROOT, EXPECTED_PORTS, CLOUDFLARE_RANGES } from "../config";

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

async function fetchJSON(url: string, timeout = 15_000): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "SecuritySentinel/1.0" },
    });
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

// ============================================================
// SHODAN InternetDB
// ============================================================

interface ShodanResult {
  cpes: string[];
  hostnames: string[];
  ip: string;
  ports: number[];
  tags: string[];
  vulns: string[];
}

export async function checkShodan(): Promise<ScanResult[]> {
  const results: ScanResult[] = [];

  try {
    const data = await fetchJSON(`https://internetdb.shodan.io/${VPS_HOST}`);

    if (!data || data.detail || !Array.isArray(data.ports)) {
      results.push(ok("recon_shodan_ports", "RECON", "Shodan InternetDB data available",
        true, "info",
        data?.detail || "No data available for this IP (may be too new or not indexed)",
        ["SOC2:CC7.1"],
        JSON.stringify(data).substring(0, 200)
      ));
      return results;
    }

    const unexpectedPorts = (data as ShodanResult).ports.filter((p) => !EXPECTED_PORTS.includes(p));
    results.push(ok("recon_shodan_ports", "RECON", "No unexpected ports visible to Shodan",
      unexpectedPorts.length === 0, unexpectedPorts.length > 0 ? "high" : "info",
      unexpectedPorts.length === 0
        ? `Open ports: ${data.ports.join(", ")} (all expected)`
        : `Unexpected ports: ${unexpectedPorts.join(", ")}`,
      ["SOC2:CC6.6", "PCI:1.3", "PCI:11.3"],
      `All ports: ${data.ports.join(", ")}`
    ));

    results.push(ok("recon_shodan_vulns", "RECON", "No known vulnerabilities on VPS IP (Shodan)",
      data.vulns.length === 0, data.vulns.length > 0 ? "critical" : "info",
      data.vulns.length === 0
        ? "No known vulns detected"
        : `${data.vulns.length} known vuln(s): ${data.vulns.slice(0, 5).join(", ")}`,
      ["SOC2:CC7.1", "PCI:11.3", "HIPAA:164.308(a)(1)"],
      data.vulns.length > 0 ? data.vulns.join(", ") : undefined
    ));

    if (data.cpes.length > 0) {
      results.push(ok("recon_shodan_cpes", "RECON", "Detected software on VPS (informational)",
        true, "info",
        `Software: ${data.cpes.join(", ")}`,
        ["PCI:2.2"],
        data.cpes.join(", ")
      ));
    }
  } catch (err: any) {
    results.push(ok("recon_shodan_error", "RECON", "Shodan InternetDB reachable",
      false, "low", `Shodan check failed: ${err.message}`,
      ["SOC2:CC7.1"], err.message
    ));
  }

  return results;
}

// ============================================================
// crt.sh — Certificate Transparency
// ============================================================

export async function checkCertTransparency(): Promise<ScanResult[]> {
  const results: ScanResult[] = [];

  try {
    const certs = await fetchJSON(`https://crt.sh/?q=%.${DOMAIN}&output=json`, 20_000);

    if (!Array.isArray(certs)) {
      results.push(ok("recon_crtsh_error", "RECON", "crt.sh reachable",
        false, "low", "crt.sh returned unexpected format",
        ["SOC2:CC7.1"]
      ));
      return results;
    }

    const uniqueNames = [...new Set(certs.map((c: any) => c.common_name))];

    results.push(ok("recon_crtsh_certs", "RECON", "Certificate transparency inventory",
      true, "info",
      `${certs.length} certificate(s) found, ${uniqueNames.length} unique CN(s)`,
      ["SOC2:CC7.1", "PCI:2.2"],
      `Common names: ${uniqueNames.slice(0, 10).join(", ")}`
    ));

    const allNames = [...new Set(certs.flatMap((c: any) =>
      (c.name_value || "").split("\n").map((n: string) => n.trim())
    ))];
    results.push(ok("recon_crtsh_subdomains", "RECON", "Certificate subdomains inventory (informational)",
      true, "info",
      `${allNames.length} unique name(s) in certificates`,
      ["SOC2:CC7.1"],
      allNames.slice(0, 20).join(", ")
    ));
  } catch (err: any) {
    results.push(ok("recon_crtsh_error", "RECON", "crt.sh reachable",
      false, "low", `crt.sh check failed: ${err.message}`,
      ["SOC2:CC7.1"], err.message
    ));
  }

  return results;
}

// ============================================================
// DNS — Record integrity via DoH
// ============================================================

async function dnsLookup(name: string, type: string): Promise<string[]> {
  const data = await fetchJSON(
    `https://dns.google/resolve?name=${encodeURIComponent(name)}&type=${type}`
  );
  if (!data.Answer) return [];
  return data.Answer.map((a: any) => a.data?.replace(/\.$/, "") || "");
}

export async function checkDNS(): Promise<ScanResult[]> {
  const results: ScanResult[] = [];

  try {
    const aRecords = await dnsLookup(DOMAIN, "A");
    const isCloudflare = aRecords.length > 0 && aRecords.every(
      (ip) => CLOUDFLARE_RANGES.some((prefix) => ip.startsWith(prefix))
    );
    const aOk = aRecords.length > 0 && (isCloudflare || aRecords.includes(VPS_HOST));
    results.push(ok("recon_dns_a", "RECON", "DNS A record resolves correctly",
      aOk, "critical",
      isCloudflare
        ? `A record: ${aRecords.join(", ")} (Cloudflare proxied — expected)`
        : aRecords.includes(VPS_HOST)
          ? `A record: ${aRecords.join(", ")} (direct to VPS)`
          : aRecords.length === 0
            ? "No A record found — domain may not be resolving"
            : `A record: ${aRecords.join(", ")} — unexpected IPs`,
      ["SOC2:CC6.6", "HIPAA:164.312(e)"],
      aRecords.join(", ")
    ));
  } catch (err: any) {
    results.push(ok("recon_dns_error", "RECON", "DNS checks completed",
      false, "low", `DNS check failed: ${err.message}`,
      ["SOC2:CC7.1"], err.message
    ));
  }

  return results;
}

// ============================================================
// OSV.dev — Dependency vulnerability checking
// ============================================================

export async function checkDependencies(): Promise<ScanResult[]> {
  const results: ScanResult[] = [];

  try {
    const pkgPath = join(PROJECT_ROOT, "package.json");
    const pkg = JSON.parse(await readFile(pkgPath, "utf-8"));
    const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };

    interface OSVQuery { version: string; package: { name: string; ecosystem: string } }
    const queries: { query: OSVQuery }[] = [];
    for (const [name, versionStr] of Object.entries(allDeps)) {
      const version = String(versionStr).replace(/^[\^~>=<]/, "").split(" ")[0];
      if (version && /^\d/.test(version)) {
        queries.push({
          query: { version, package: { name, ecosystem: "npm" } },
        });
      }
    }

    if (queries.length === 0) {
      results.push(ok("deps_osv", "DEPS", "Dependency vulnerability check",
        true, "info", "No parseable dependencies found",
        ["PCI:6.4", "PCI:11.3"]
      ));
      return results;
    }

    const batches = [];
    for (let i = 0; i < queries.length; i += 1000) {
      batches.push(queries.slice(i, i + 1000));
    }

    let totalVulns = 0;
    const criticalVulns: string[] = [];
    const highVulns: string[] = [];

    for (const batch of batches) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 30_000);
      try {
        const res = await fetch("https://api.osv.dev/v1/querybatch", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ queries: batch.map((b) => b.query) }),
          signal: controller.signal,
        });
        const data = await res.json();

        if (data.results) {
          for (let i = 0; i < data.results.length; i++) {
            const vulnList = data.results[i].vulns || [];
            if (vulnList.length > 0) {
              totalVulns += vulnList.length;
              const pkgName = batch[i].query.package.name;
              for (const v of vulnList) {
                const severity = v.database_specific?.severity?.toLowerCase() || "";
                if (severity === "critical") criticalVulns.push(`${pkgName}: ${v.id}`);
                else if (severity === "high") highVulns.push(`${pkgName}: ${v.id}`);
              }
            }
          }
        }
      } finally {
        clearTimeout(timer);
      }
    }

    results.push(ok("deps_osv_critical", "DEPS", "No critical CVEs in dependencies (OSV.dev)",
      criticalVulns.length === 0, "critical",
      criticalVulns.length === 0
        ? `Checked ${queries.length} packages — no critical vulns`
        : `${criticalVulns.length} critical vuln(s): ${criticalVulns.slice(0, 5).join("; ")}`,
      ["SOC2:CC7.1", "PCI:6.4", "PCI:11.3", "HIPAA:164.308(a)(1)"],
      criticalVulns.length > 0 ? criticalVulns.join("; ") : undefined
    ));

    results.push(ok("deps_osv_high", "DEPS", "No high-severity CVEs in dependencies (OSV.dev)",
      highVulns.length === 0, "high",
      highVulns.length === 0
        ? `No high-severity vulns`
        : `${highVulns.length} high vuln(s): ${highVulns.slice(0, 5).join("; ")}`,
      ["SOC2:CC7.1", "PCI:6.4", "PCI:11.3"],
      highVulns.length > 0 ? highVulns.join("; ") : undefined
    ));

    results.push(ok("deps_osv_total", "DEPS", "Dependency vulnerability summary (informational)",
      totalVulns === 0, "info",
      `${queries.length} packages checked, ${totalVulns} total vulnerability finding(s)`,
      ["PCI:11.3"],
      `Packages: ${queries.length}, Vulns: ${totalVulns}`
    ));
  } catch (err: any) {
    results.push(ok("deps_osv_error", "DEPS", "OSV.dev dependency check",
      false, "medium", `OSV check failed: ${err.message}`,
      ["PCI:11.3"], err.message
    ));
  }

  return results;
}

// ============================================================
// MAIN EXPORT
// ============================================================

export async function runRecon(): Promise<ScanResult[]> {
  const all = await Promise.allSettled([
    checkShodan(),
    checkCertTransparency(),
    checkDNS(),
    checkDependencies(),
  ]);

  const results: ScanResult[] = [];
  for (const check of all) {
    if (check.status === "fulfilled") results.push(...check.value);
  }
  return results;
}
