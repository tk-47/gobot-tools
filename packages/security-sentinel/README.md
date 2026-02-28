# Security Sentinel

**Automated security scanning for VPS and web infrastructure — 90+ checks across 12 tools, compliance reporting, and AI-powered analysis.**

Most teams don't find out their infrastructure has problems until something breaks. A misconfigured firewall rule, an expired TLS certificate, a leaked API key in git history, a webhook endpoint that forgot to check authentication — these are the kinds of issues that sit quietly until they become incidents. Security Sentinel finds them before that happens.

It runs 64–94 automated checks across your entire stack: VPS hardening, web application security, TLS configuration, API credential validation, dependency vulnerabilities, secrets scanning, static analysis, email security, HTTP recon, and host hardening. Every finding maps to SOC2, HIPAA, and PCI-DSS compliance controls, so you get audit-ready reports alongside actionable security data. Schedule it to run hourly and it becomes a continuous security monitor — with optional AI analysis from a local model or Claude API, and Telegram alerts when something new breaks.

---

## Why Security Sentinel

- **Catches real problems.** Not theoretical vulnerabilities — actual misconfigurations, exposed endpoints, leaked secrets, and missing hardening that affect your running infrastructure right now.

- **Runs in seconds, not hours.** A quick scan completes in ~15 seconds. A daily scan with all 10 tools finishes in ~4 minutes. Even the deepest scan with TLS audits and Claude API analysis finishes in ~6 minutes.

- **Zero vendor lock-in.** Runs locally on your machine with Bun. No SaaS dashboard, no per-seat pricing, no data leaving your network (unless you opt into deep scan with Claude API).

- **Privacy-first tooling.** Telemetry is disabled by default for all tools that have it (Semgrep, Grype, httpx). See [Data Sharing & Privacy](#data-sharing--privacy) for the full breakdown.

- **Compliance built in.** Every check maps to specific SOC2, HIPAA, and PCI-DSS controls. Generate compliance reports from any scan with a single command.

- **Diff tracking between scans.** Each scan produces a JSON report and compares it to the previous one — so you see exactly what's new, what's resolved, and what persists.

- **AI-powered analysis (optional).** Local AI review via Ollama for hourly/daily scans (free, private). Claude API for deep expert analysis on demand. Both are optional — the scanner works without any AI.

---

## Quick Start

### Interactive Setup (Claude Code)

Open this repo in [Claude Code](https://claude.com/claude-code) and say:

> "Set up Security Sentinel for my infrastructure"

Claude will walk you through configuration step by step — gathering your VPS details, creating your `.env`, verifying tool installation, and running your first scan.

### Manual Setup

```bash
# 1. Clone and install
git clone https://github.com/tk-47/claudebot-security-sentinel.git
cd claudebot-security-sentinel
bun install
cp .env.example .env
# Edit .env with your VPS URL, SSH details, etc.

# 2. Run your first scan
bun run scan
```

That's it for a basic scan. For deeper coverage, install the optional CLI tools:

```bash
# Core tools (daily scans)
brew install nmap nuclei trufflehog trivy semgrep gitleaks grype lynis httpx

# Python tools (daily + weekly scans)
pipx install sslyze checkdmarc
# or: pip3 install --user sslyze checkdmarc

# TLS deep audit (weekly/deep scans)
brew install testssl

# Local AI review
ollama pull qwen3:8b
```

Security Sentinel gracefully handles missing tools — checks that require them are skipped with an informational note rather than failing.

### Updating

If you installed via `gobot-tools`, pull the latest version with:

```bash
gobot-tools update security-sentinel
```

If you cloned the standalone repo directly, pull from GitHub:

```bash
git pull
bun install
```

---

## How It Runs

Security Sentinel supports two operational modes: **on-demand** and **scheduled**.

### On-Demand Scanning

Run any scan mode directly from the command line:

```bash
bun run scan           # Quick deterministic scan
bun run hourly         # + external recon + local AI review
bun run daily          # + 10 CLI security tools + AI review
bun run deep           # + testssl.sh + sslyze + Claude API expert analysis
bun run compliance     # Generate compliance report from last scan
bun run install-check  # Verify all tools are installed
```

### Scheduled Scanning

Set up automated scans via macOS `launchd` (or `cron` on Linux) for continuous monitoring:

- **Hourly scans** — lightweight recon + AI review, catches regressions fast
- **Daily scans** — full tool suite, comprehensive coverage overnight
- **Deep scans** — on-demand or weekly, Claude API expert analysis

When scheduled, Security Sentinel runs silently in the background. If a new critical or high-severity finding appears, it sends a Telegram alert. Otherwise, reports accumulate in `logs/security/` for review.

See [Scheduling](#scheduling) below for setup instructions.

---

## Scan Modes

Security Sentinel offers four scan tiers, each building on the previous one:

| Mode | Checks | Duration | What's Added |
|------|--------|----------|--------------|
| `scan` | ~64 | ~15 sec | Core deterministic checks only |
| `hourly` | ~72 | ~20 sec | + external recon (Shodan, crt.sh, DNS, OSV) + Ollama AI review |
| `daily` | ~90 | ~4 min | + 10 CLI tools (nmap, nuclei, trufflehog, trivy, semgrep, gitleaks, grype, checkdmarc, httpx, lynis) |
| `deep` | ~94 | ~6 min | + testssl.sh + sslyze TLS audits + Claude API expert analysis |

### `scan` — Quick Deterministic (~15 seconds, ~64 checks)

The baseline. Runs ~64 checks with zero external dependencies — no AI, no CLI tools, no API calls to third-party services. Pure HTTP probing, SSH auditing, and local file inspection.

**Best for:** Quick health checks, CI/CD gates, verifying a fix worked.

```bash
bun run scan
```

### `hourly` — Recon + Local AI (~20 seconds, ~72 checks)

Everything in `scan`, plus external reconnaissance via free APIs (Shodan, crt.sh, DNS, OSV.dev) and a local AI review of failures using Ollama.

**Best for:** Scheduled hourly monitoring. Catches new external exposures and provides AI-prioritized remediation.

```bash
bun run hourly
```

### `daily` — Full Tool Suite (~4 minutes, ~90 checks)

Everything in `hourly`, plus deep scanning with 10 industry-standard CLI tools: nmap port scanning, Nuclei vulnerability templates, TruffleHog + Gitleaks secrets scanning, Trivy + Grype dependency scanning, Semgrep static analysis, checkdmarc email security, httpx HTTP reconnaissance, and Lynis host hardening audit.

**Best for:** Nightly comprehensive scans. Finds vulnerabilities that lightweight probes can't detect.

```bash
bun run daily
```

### `deep` — Expert Analysis (~6 minutes, ~94 checks)

Everything in `daily`, plus full TLS audits (testssl.sh + SSLyze) and Claude API expert analysis. The AI review includes risk assessment, attack chain analysis, compliance gap assessment, and a prioritized remediation plan.

**Best for:** Weekly deep dives, pre-audit preparation, incident investigation.

```bash
bun run deep
```

---

## What It Checks

### Authentication & Access Control
- Sends unsigned/malformed requests to every configured webhook endpoint and verifies they're rejected with proper HTTP status codes (401/403)
- Tests disabled endpoints return 404
- Validates local process endpoints require authentication

### Rate Limiting
- Fires rapid concurrent requests to confirm your rate limiter activates at the configured threshold

### Information Disclosure
- Checks for leaked server software versions in headers (`Server`, `X-Powered-By`)
- Detects framework identifiers (Express, Fastify, Next.js, etc.)
- Tests for CORS misconfiguration (wildcard origins)
- Verifies error responses don't leak stack traces or internal paths

### Security Headers (OWASP)
- X-Frame-Options (clickjacking protection)
- X-Content-Type-Options (MIME sniffing prevention)
- Referrer-Policy (referrer leakage control)
- Permissions-Policy (browser feature restrictions)
- Content-Security-Policy (XSS mitigation)
- Strict-Transport-Security / HSTS

### TLS / SSL
- Certificate validity and chain verification
- Expiry warning (30-day threshold)
- HSTS header presence and max-age
- **Deep mode:** Full testssl.sh audit — protocol versions, cipher suites, Heartbleed, POODLE, ROBOT, SWEET32, FREAK, DROWN, LOGJAM, and more
- **Deep mode:** SSLyze analysis — deprecated protocols, Heartbleed, certificate validity, TLS 1.3 support

### Static Analysis (SAST)
- Semgrep scan with auto rulesets — detects injection vulnerabilities, insecure patterns, path traversal, and more
- Findings grouped by severity (ERROR = high, WARNING = medium)

### Secrets Detection
- TruffleHog: verified active secrets in codebase (ignores `.env` files)
- Gitleaks: regex-based secrets scanning (complements TruffleHog with broader pattern matching)

### Dependency Vulnerabilities
- Trivy: filesystem vulnerability scanning for critical/high CVEs
- Grype: dependency scanning with fix-available filtering (complements Trivy)

### Email Security
- checkdmarc: validates SPF records, DMARC records, and DMARC enforcement policy

### HTTP Reconnaissance
- httpx: probes target URLs for reachability, server version leaks, and technology detection

### Web Application Security
- HTTP method rejection (PUT, DELETE, PATCH on endpoints that shouldn't accept them)
- Sensitive path exposure (`.env`, `.git/config`, `node_modules`, `.env.local`)
- Stack trace leakage on error paths
- Path traversal attempt detection
- SQL injection pattern testing
- Oversized payload handling

### VPS Hardening (via SSH)
- Root login disabled
- Password authentication disabled
- Firewall active (ufw/iptables)
- `.env` file permissions (should be 600/640)
- Process isolation (non-root user)
- PM2 process health and uptime
- Disk, memory, and CPU usage thresholds
- fail2ban or CrowdSec active
- Unattended security updates enabled
- Pending security patches
- Node.js / Bun runtime versions
- **Lynis host hardening audit** — hardening score, warnings, suggestions (runs on VPS via SSH)

### Local Security
- Subprocess permission configuration audit
- Local `.env` file permissions
- SSH key age (warns if > 365 days)
- Gateway secret entropy validation

### API Credential Validation
- Tests configured API tokens against their live endpoints:
  - Telegram Bot API
  - Anthropic API
  - Convex
  - MS365
  - OpenAI

### Backup Verification
- Checks for recent backup files on VPS
- Validates backup freshness

### Token Freshness
- Checks age and rotation status of configured API tokens

---

## External Reconnaissance (hourly+)

These checks use free, unauthenticated public APIs — no accounts or API keys needed:

| Service | What It Checks |
|---------|---------------|
| **Shodan InternetDB** | Open ports visible from the internet, known CVEs associated with your IP, detected software/CPEs |
| **crt.sh** | Certificate transparency logs — inventories all certificates and subdomains issued for your domain |
| **Google DNS (DoH)** | DNS A record integrity — verifies your domain resolves to the expected IP (or Cloudflare proxy) |
| **OSV.dev** | Checks every npm dependency in `package.json` against Google's open-source vulnerability database |

---

## CLI Security Tools (daily+)

These require installation but are all free and open-source. Security Sentinel automatically disables telemetry for tools that have it (Semgrep, Grype, httpx) — see [Data Sharing & Privacy](#data-sharing--privacy).

### Daily Tools

| Tool | Category | What It Does | Install |
|------|----------|-------------|---------|
| **nmap** | Ports | Port scanning with service/version detection. Scans top 100 ports, flags unexpected open ports and debug/dev services. | `brew install nmap` |
| **Nuclei** | Vuln | Vulnerability scanning with 11,000+ community templates. Tests for known CVEs, misconfigurations, exposed panels, default credentials. | `brew install nuclei` |
| **TruffleHog** | Secrets | Scans codebase for verified, active secrets — API keys, tokens, passwords that are actually live and working. Ignores `.env` files. | `brew install trufflehog` |
| **Gitleaks** | Secrets | Regex-based secrets detection. Complements TruffleHog with broader pattern matching beyond verified-only secrets. | `brew install gitleaks` |
| **Trivy** | Deps | Filesystem vulnerability scanning. Checks installed packages and dependencies for known critical and high-severity CVEs. | `brew install trivy` |
| **Grype** | Deps | Dependency vulnerability scanning with fix-available filter. Complements Trivy with a second opinion from Anchore's vulnerability database. | `brew install grype` |
| **Semgrep** | SAST | Static analysis with auto-configured rulesets. Detects injection vulnerabilities, insecure patterns, and code quality issues. | `brew install semgrep` |
| **checkdmarc** | Email | Validates SPF and DMARC records for your domain. Flags missing records, invalid syntax, and weak enforcement policies. | `pipx install checkdmarc` |
| **httpx** | Recon | HTTP probe with tech detection. Tests target reachability, detects server version leaks in headers, and identifies web technologies. | `brew install httpx` |
| **Lynis** | Host | Host hardening audit. Runs on your VPS via SSH to assess system hardening, security warnings, and configuration suggestions. | `apt install lynis` (on VPS) |

### Weekly / Deep Tools

| Tool | Category | What It Does | Install |
|------|----------|-------------|---------|
| **testssl.sh** | TLS | Deep TLS/SSL audit. Tests protocol versions, cipher suites, certificate chains, and known vulnerabilities (Heartbleed, POODLE, ROBOT, etc.). | `brew install testssl` |
| **SSLyze** | TLS | Python-based TLS analysis. Checks deprecated protocols, Heartbleed vulnerability, certificate validity/expiry, and TLS 1.3 support. | `pipx install sslyze` |

### AI Review Tools (optional)

| Tool | Purpose | Install |
|------|---------|---------|
| **Ollama** | Local AI model for analyzing scan failures, identifying attack chains, and recommending remediation. Runs entirely on your machine — no data leaves your network. Default model: `qwen3:8b`. | [ollama.com](https://ollama.com) + `ollama pull qwen3:8b` |
| **Claude API** | Expert-level security analysis for deep scans. Provides risk assessment, attack chain analysis, compliance gap assessment, and prioritized remediation plans. Costs ~$0.05-0.10 per scan. | Set `ANTHROPIC_API_KEY` in `.env` |

---

## Compliance & Regulatory Reporting

Every finding in Security Sentinel is tagged with the specific compliance controls it affects. This isn't generic mapping — each check was designed with specific regulatory requirements in mind.

### Frameworks Covered

| Framework | Controls | What's Tested |
|-----------|----------|---------------|
| **SOC2** | CC6.1, CC6.2, CC6.6, CC7.1, CC7.2, CC8.1 | Access controls, credential management, system boundaries, detection/monitoring, change management |
| **HIPAA** | 164.312(a)(c)(d)(e), 164.308(a)(1)(5) | Technical safeguards (access control, integrity, authentication, transmission security), security management |
| **PCI-DSS v4.0** | 1.3, 2.2, 6.4, 6.5, 7.1, 8.3, 8.6, 10.2, 10.3, 11.3, 11.4 | Network restrictions, secure configurations, web app protections, secure coding, access control, authentication, audit logs, vulnerability scanning, penetration testing |

### Generating a Compliance Report

```bash
bun run compliance
```

This reads the most recent scan report and generates a structured compliance summary showing the status of each framework (pass/warn/fail) and which specific controls have findings. Example output:

```
COMPLIANCE REPORT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Based on: daily scan at 2026-02-25T03:00:00.000Z

SOC2: PASS
  All controls satisfied.

HIPAA: WARN
  * tls_expiry_warning: HIPAA:164.312(e) (Transmission Security)

PCI-DSS: PASS
  All controls satisfied.
```

The compliance data is also embedded in every JSON report, making it easy to feed into GRC tools or audit documentation.

---

## Report Output

Every scan produces a timestamped JSON report in `logs/security/`. Reports include:

- **Full results array** — every check with id, category, pass/fail, severity, details, raw evidence, and compliance tags
- **Compliance summary** — per-framework status with affected control list
- **AI analysis** (if applicable) — Ollama or Claude review text
- **Scan metadata** — timestamp, duration, mode, total/passed/failed counts

### Diff Tracking

Each scan automatically compares against the previous report and identifies:
- **New failures** — checks that were passing but now fail (these trigger Telegram alerts)
- **Resolved issues** — checks that were failing but now pass
- **Persistent failures** — checks that remain in a failed state

This makes it easy to track security posture over time and catch regressions immediately.

### Telegram Alerts

When configured (`TELEGRAM_BOT_TOKEN` + `TELEGRAM_USER_ID` in `.env`), Security Sentinel sends a Telegram notification whenever:
- A new critical or high-severity failure appears
- Previously passing checks start failing

Silent scans (no new issues) don't generate alerts.

---

## Configuration

All configuration is via environment variables. Copy `.env.example` to `.env` and fill in your values. Only `VPS_URL` is required — everything else has sensible defaults.

| Variable | Required | Description |
|----------|----------|-------------|
| `VPS_URL` | Yes | Public URL of your VPS (e.g., `https://vps.example.com`) |
| `VPS_SSH_HOST` | Yes | VPS IP address for SSH + nmap |
| `VPS_SSH_USER` | No | SSH username (default: `deploy`) |
| `VPS_SSH_KEY` | No | SSH key path (default: `~/.ssh/id_ed25519`) |
| `VPS_PROJECT_DIR` | No | Project directory on VPS (default: `/home/deploy/app`) |
| `DOMAIN` | No | Your domain (defaults to VPS_URL hostname) |
| `WEBHOOK_ENDPOINTS` | No | Comma-separated webhook paths to test auth on |
| `DISABLED_ENDPOINTS` | No | Endpoints that should return 404 |
| `SENSITIVE_PATHS` | No | Paths that should not be publicly accessible |
| `EXPECTED_PORTS` | No | Ports expected to be open (default: `22,80,443`) |
| `HTTPX_TARGETS` | No | Comma-separated URLs for httpx probing (default: `VPS_URL`) |
| `PM2_PROCESS_NAME` | No | PM2 process name to check health |
| `RATE_LIMIT_THRESHOLD` | No | Expected rate limit trigger count (default: `30`) |
| `TELEGRAM_BOT_TOKEN` | No | For alert notifications |
| `TELEGRAM_USER_ID` | No | Telegram chat ID for alerts |
| `ANTHROPIC_API_KEY` | No | For Claude deep scan analysis |
| `SECURITY_OLLAMA_MODEL` | No | Ollama model name (default: `qwen3:8b`) |
| `SECURITY_CLAUDE_MODEL` | No | Claude model (default: `claude-sonnet-4-5-20250929`) |
| `TIMEZONE` | No | For report timestamps (default: `UTC`) |

### Configuring Webhook Endpoints

```bash
# Format: /path:METHOD:auth_type (comma-separated)
WEBHOOK_ENDPOINTS=/telegram:POST:signature,/deploy:POST:signature,/api/data:POST:bearer
```

See `.env.example` for the full list with documentation.

---

## Scheduling

### macOS (launchd)

Create a plist at `~/Library/LaunchAgents/com.sentinel.security-hourly.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.sentinel.security-hourly</string>
  <key>ProgramArguments</key>
  <array>
    <string>/path/to/bun</string>
    <string>run</string>
    <string>src/index.ts</string>
    <string>hourly</string>
  </array>
  <key>WorkingDirectory</key><string>/path/to/claudebot-security-sentinel</string>
  <key>StartCalendarInterval</key>
  <dict><key>Minute</key><integer>0</integer></dict>
  <key>StandardOutPath</key><string>/tmp/sentinel-hourly.log</string>
  <key>StandardErrorPath</key><string>/tmp/sentinel-hourly.log</string>
</dict>
</plist>
```

Load it:
```bash
launchctl load ~/Library/LaunchAgents/com.sentinel.security-hourly.plist
```

### Linux (cron)

```bash
# Hourly scan
0 * * * * cd /path/to/claudebot-security-sentinel && /path/to/bun run hourly >> /var/log/sentinel-hourly.log 2>&1

# Daily scan at 3:00 AM
0 3 * * * cd /path/to/claudebot-security-sentinel && /path/to/bun run daily >> /var/log/sentinel-daily.log 2>&1
```

---

## Architecture

```
src/
  index.ts          # Main orchestrator — scan dispatch, AI review, reporting, alerts
  config.ts         # Configuration from environment variables
  lib/
    scanner.ts      # Core deterministic checks (~64 checks)
    recon.ts        # External recon APIs (Shodan, crt.sh, DNS, OSV.dev)
    tools.ts        # CLI tool wrappers (12 tools)
logs/
  security/         # One JSON report per scan, timestamped
```

```
                    +------------------+
  CLI / Scheduler   |    index.ts      |  <- Orchestrator
                    +---+----+----+----+
                        |    |    |
           +------------+    |    +-------------+
           v                 v                  v
  +----------------+ +--------------+ +-------------------+
  | scanner.ts     | | recon.ts     | | tools.ts          |
  | ~64 checks     | | Shodan       | | nmap       (PORTS)|
  | Auth, TLS,     | | crt.sh       | | Nuclei     (VULN) |
  | VPS, Local,    | | DNS (DoH)    | | testssl.sh (TLS)  |
  | Headers, etc.  | | OSV.dev      | | sslyze     (TLS)  |
  +-------+--------+ +------+-------+ | TruffleHog (SEC)  |
          |                  |         | Gitleaks   (SEC)  |
          +--------+---------+         | Trivy      (DEPS) |
                   v                   | Grype      (DEPS) |
           +---------------+          | Semgrep    (SAST) |
           | Ollama        |          | checkdmarc (EMAIL)|
           | (local AI)    |<---------+ httpx      (RECON)|
           +---------------+          | Lynis      (HOST) |
           +---------------+          +--------+----------+
           | Claude API    |  deep             |
           +-------+-------+                   |
                   v                           |
           +---------------+                   |
           | Telegram      |  alerts           |
           +---------------+                   |
```

---

## Customization

### Adding a New Check

Every check follows this pattern in `scanner.ts`:

```typescript
results.push(ok(
  "unique_check_id",     // Unique identifier for diff tracking
  "CATEGORY",            // Category for grouping
  "Human-readable name", // What the check tests
  true_or_false,         // Pass/fail boolean
  "medium",              // Severity: critical, high, medium, low, info
  "Details about result", // Explanation
  ["SOC2:CC6.1"],        // Compliance control tags
  "optional evidence"     // Raw evidence string
));
```

### Switching AI Models

```bash
SECURITY_OLLAMA_MODEL=llama3:8b                      # Any Ollama model
SECURITY_CLAUDE_MODEL=claude-sonnet-4-5-20250929     # Any Anthropic model
```

---

## Data Sharing & Privacy

All 12 CLI tools are open source. Security Sentinel disables telemetry by default for the three tools that have it.

### Tool Telemetry

| Tool | Telemetry | What Sentinel Does | License |
|------|-----------|-------------------|---------|
| **Semgrep** | Metrics when using Registry rules (hashed project name, rule timing, file sizes, IP) | **Disabled** via `SEMGREP_SEND_METRICS=off` in spawn env | LGPL-2.1 |
| **Grype** | Version check + vuln DB download on startup | **Version check disabled** via `GRYPE_CHECK_FOR_APP_UPDATE=false`; DB download kept (needed for scanning) | Apache-2.0 |
| **httpx** | Version check on startup | **Disabled** via `-duc` flag | MIT |
| **Gitleaks** | None | N/A | MIT |
| **Lynis** | None | N/A | GPLv3 |
| **SSLyze** | None | N/A | AGPL-3.0 |
| **checkdmarc** | None (DNS queries only — its core function) | N/A | Apache-2.0 |
| **nmap** | None | N/A | NPSL |
| **Nuclei** | None (unless you use cloud dashboard, which Sentinel doesn't) | N/A | MIT |
| **TruffleHog** | None | N/A | AGPL-3.0 |
| **Trivy** | None | N/A | Apache-2.0 |
| **testssl.sh** | None | N/A | GPLv2 |

### External API Calls

| Data | Destination | When | Can Disable? |
|------|------------|------|-------------|
| VPS IP | Shodan InternetDB | hourly+ scans | Yes — use `scan` mode only |
| Domain | crt.sh, Google DNS | hourly+ scans | Yes — use `scan` mode only |
| Domain | DNS resolvers (checkdmarc) | daily+ scans | Yes — don't install checkdmarc |
| Package versions | OSV.dev (Google) | hourly+ scans | Yes — use `scan` mode only |
| Vuln DB download | grype.anchore.io | daily+ scans (if DB stale) | Yes — set `GRYPE_DB_AUTO_UPDATE=false` |
| Scan results summary | Anthropic API | deep scans only | Yes — don't set `ANTHROPIC_API_KEY` |

**Never shared:** Source code, `.env` contents, API keys, SSH credentials, file contents. The `scan` mode makes zero external API calls. No tool ever uploads your source code or scan results to any third party.

---

## License

MIT
