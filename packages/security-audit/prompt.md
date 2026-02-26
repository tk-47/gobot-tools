# Application Security Audit Prompt

Paste this entire prompt into Claude Code while in your project directory. It will audit your application code for security vulnerabilities, rank them by severity, and walk you through fixing each one.

> **Companion to:** [VPS Hardening Prompt](vps-hardening.md) — that covers infrastructure (SSH, firewall, OS). This covers your application code.

---

## The Prompt

```
I need you to perform a comprehensive application-level security audit of this codebase. You are acting as a cybersecurity expert reviewing a production application. Be thorough, be specific, and assume an attacker's mindset.

IMPORTANT: Do NOT make any changes yet. This is a read-only audit. We will fix issues one at a time after the full report.

### Phase 1: Understand the Attack Surface

Before looking for bugs, map the entire attack surface by reading the codebase:

1. **Entry points** — Every HTTP endpoint, webhook handler, WebSocket connection, and CLI entrypoint. For each one, document:
   - URL/path
   - Authentication method (or lack thereof)
   - Who can reach it (public internet, internal only, specific services)
   - What untrusted input it accepts

2. **Outbound connections** — Every external API call, database connection, and subprocess spawn. For each one, document:
   - What credentials are used and how they're stored
   - Whether secrets could leak (in URLs, logs, error messages)

3. **Subprocess/child process execution** — Any place the app spawns shells, runs commands, or delegates to external tools. Document:
   - What input flows into the command
   - What permissions/capabilities the subprocess has
   - Whether untrusted data could influence execution

4. **File operations** — Any place the app reads, writes, or deletes files based on external input. Document:
   - Whether filenames/paths are sanitized
   - Whether uploads are constrained to a safe directory

5. **Data flow** — Trace how user input moves through the system:
   - Where does untrusted input enter?
   - Where is it stored?
   - Where is it rendered, executed, or passed to other systems?

Present the attack surface as a clear inventory before proceeding.

### Phase 2: Identify Vulnerabilities

Now analyze every file for security issues. Check for (but don't limit yourself to):

**Injection & Execution**
- Command injection (unsanitized input in shell commands, subprocess args)
- Prompt injection (untrusted content fed to LLM prompts that trigger tool use)
- SQL/NoSQL injection (unsanitized input in database queries)
- Path traversal (user-controlled filenames used in file operations)
- Server-side request forgery (SSRF — user input in URLs the server fetches)

**Authentication & Authorization**
- Unauthenticated endpoints that should require auth
- Weak or missing webhook signature verification
- Hardcoded secrets, API keys, or tokens in source code
- Secrets in URL query parameters (leak in logs)
- JWT/token validation bypasses or weak fallbacks
- Missing user authorization checks (authn ≠ authz)

**Cryptographic Issues**
- Non-constant-time secret comparison (timing attacks)
- Weak or missing HMAC/signature verification
- Use of broken or obsolete crypto algorithms

**Configuration & Exposure**
- Overly permissive CORS headers
- Verbose error messages that leak internals
- Debug/development endpoints left enabled in production
- Sensitive data in console logs
- Missing rate limiting on public endpoints
- Hardcoded configuration that should be in environment variables

**Data Handling**
- Secrets in git history (.env files, API keys committed then removed)
- Uploaded files never cleaned up (disk exhaustion)
- Sensitive data stored unencrypted
- Missing input validation at system boundaries

### Phase 3: Classify and Rank

For each issue found, assign a severity:

| Severity | Criteria | Examples |
|----------|----------|----------|
| **P0 — Critical** | Remote code execution, full system compromise, or data breach possible with no authentication | Unrestricted subprocess execution, unauthenticated admin endpoints |
| **P1 — High** | Significant security impact, exploitable by an external attacker with minimal effort | Missing webhook auth, path traversal, SSRF, secrets in URLs |
| **P2 — Medium** | Security weakness that requires specific conditions or has limited blast radius | Timing attacks, missing rate limiting, weak JWT validation |
| **P3 — Low** | Best practice violations, defense-in-depth improvements, or issues with minimal real-world impact | Verbose logging, missing cleanup, hardcoded non-secret config |

Present the full report as a ranked table:

| # | Issue | File(s) | Severity | Description |
|---|-------|---------|----------|-------------|

### Phase 4: Fix One at a Time

After presenting the report, say: "Ready to begin fixes. Which severity level should we start with?"

For each fix:
1. Explain the vulnerability in plain language — what an attacker could do
2. Propose the fix with specific code changes
3. Explain the practical impact — will anything break?
4. Wait for my approval before implementing
5. Implement, commit with a descriptive message, and move to the next issue

Do NOT batch fixes. One issue per commit so each can be individually reverted if needed.

### Phase 5: Verification

After all fixes are applied:
1. Re-scan for any issues introduced by the fixes themselves
2. Provide a final before/after summary table
3. Note any remaining risks that can't be fixed in code (e.g., "consider adding Cloudflare WAF rules")

### Rules

- Read EVERY source file. Do not skip files because they "look fine."
- Check config files too: .env.example, package.json, docker-compose, CI/CD configs.
- If you find secrets committed in git history, flag it even if they're now in .gitignore.
- Consider the FULL chain: if untrusted input from Service A flows through the database and is later used in Service B, that's a vulnerability in Service B even though Service A looks safe.
- When in doubt, flag it. False positives are better than missed vulnerabilities.
- Save the audit results to memory so we can reference them in future sessions.

Be thorough. Be methodical. Miss nothing.
```

---

## How to Use

1. **Open Claude Code** in your project directory
2. **Paste the entire prompt above**
3. **Wait for the full report** — don't interrupt the audit phase
4. **Review the findings** and approve/deny each fix
5. **Test your application** after all fixes are applied

## What This Catches

| Category | What It Finds |
|----------|--------------|
| **Injection** | Command injection, prompt injection, SQL injection, path traversal |
| **Auth gaps** | Unauthenticated endpoints, missing webhook verification, JWT bypasses |
| **Secret leaks** | API keys in URLs/logs, hardcoded credentials, secrets in git history |
| **Crypto flaws** | Timing attacks, weak signature verification |
| **Config issues** | Permissive CORS, missing rate limiting, debug endpoints in production |
| **Data handling** | File upload abuse, sensitive data in logs, missing cleanup |

## When to Run This

- **After initial development** — before going to production
- **After adding a new integration** — each webhook/API adds attack surface
- **After adding subprocess execution** — shells and LLM tool use are high-risk
- **Periodically** — every few months, or after major feature work
- **After a dependency update** — new APIs may change security assumptions

## Complements (Not Replaces)

This prompt audits your **application code**. You also need:

- **[VPS Hardening](vps-hardening.md)** — SSH, firewall, OS security
- **Dependency auditing** — `npm audit`, `bun audit`, Snyk, or Dependabot
- **Secret scanning** — GitHub secret scanning, truffleHog, or gitleaks
- **Runtime monitoring** — Log aggregation, uptime monitoring, alerting

---

*Created from a real security audit that found 16 issues across 4 severity levels in a production Telegram bot. Every category above reflects an actual vulnerability that was discovered and fixed.*
