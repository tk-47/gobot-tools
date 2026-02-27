# Security Sentinel — Setup Guide for Claude Code

When the user asks to set up Security Sentinel (or says anything like "set up security scanning", "configure this for my infrastructure", "get started", etc.), walk them through the following interactive setup process.

## Setup Walkthrough

### Step 1: Gather Infrastructure Details

Ask the user for their infrastructure information. Ask conversationally — don't dump a form. Start with the essentials and work outward:

1. **VPS URL** (required) — "What's the public URL of your VPS?" (e.g., `https://vps.example.com`)
2. **VPS SSH access** — "What's the IP address? What SSH user and key path do you use?" (defaults: `deploy`, `~/.ssh/id_ed25519`)
3. **Domain** — "What domain should I check DNS and certificates for?" (defaults to VPS_URL hostname)
4. **Webhook endpoints** — "Do you have any webhook endpoints that should require authentication? List them with their HTTP method." (e.g., `/telegram:POST`, `/deploy:POST`)
5. **PM2 process name** — "Are you using PM2? What's the process name?"
6. **Telegram alerts** — "Do you want Telegram notifications for critical findings? If so, what's your bot token and chat ID?"
7. **AI review** — "Do you have Ollama installed locally for AI-powered scan review? Do you want to use Claude API for deep scans?"

Don't ask about optional/advanced settings unless the user brings them up. The defaults are sensible.

### Step 2: Create the .env File

Based on their answers, create a `.env` file from `.env.example`. Only include values the user provided — comment out or omit anything they didn't specify. Use the defaults from `.env.example` for standard values.

**CRITICAL:** Never write real API keys, tokens, or secrets into any file other than `.env`. The `.env` file is gitignored.

### Step 3: Install Dependencies

Run:
```bash
bun install
```

### Step 4: Check Tool Availability

Run the install check:
```bash
bun run install-check
```

Show the user the results. If tools are missing, explain which scan modes they affect:
- **nmap, nuclei, trufflehog, trivy, semgrep, gitleaks, grype, checkdmarc, httpx** — needed for `daily` and `deep` scans. Without them, those tools are skipped gracefully.
- **lynis** — needs to be installed on the VPS (`apt install lynis`), not locally.
- **testssl.sh, sslyze** — needed for `deep` scan TLS audits only.
- **Ollama** — needed for AI review in `hourly` and `daily` modes.

Don't pressure them to install everything. The scanner works fine without optional tools — it just skips those checks.

### Step 5: Run the First Scan

Run a quick scan to verify everything works:
```bash
bun run scan
```

Review the output with the user. Explain any failures and what they mean. If there are critical or high-severity findings, highlight those and suggest remediation.

### Step 6: Set Up Scheduling (Optional)

Ask if they want automated scanning. If yes:

**macOS:** Create a launchd plist for hourly scans. Use `which bun` to get the correct bun path and `pwd` for the working directory. Create the plist at `~/Library/LaunchAgents/com.sentinel.security-hourly.plist` and load it with `launchctl load`.

**Linux:** Add a cron entry for hourly scans.

Suggest running `daily` scans at a quiet hour (e.g., 3:00 AM) if they have the CLI tools installed.

### Step 7: Summary

Recap what was configured:
- Which scan modes are available (based on installed tools)
- Whether Telegram alerts are active
- Whether AI review is configured
- Whether scheduling is set up
- How to run scans: `bun run scan`, `bun run hourly`, `bun run daily`, `bun run deep`
- How to check compliance: `bun run compliance`
- Where reports are saved: `logs/security/`

---

## General Instructions

- This is a security scanning tool. All checks are defensive — testing the user's own infrastructure for misconfigurations and vulnerabilities.
- Reports are saved as JSON in `logs/security/`. Each scan diffs against the previous report automatically.
- Every finding maps to SOC2, HIPAA, and PCI-DSS compliance controls.
- The scanner gracefully handles missing tools, unreachable hosts, and unconfigured features. It never crashes on a missing optional dependency.
- When reviewing scan results, prioritize critical and high-severity findings. Explain what each finding means in plain language and suggest specific remediation steps.
