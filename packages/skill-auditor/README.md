# Skill Auditor

Pre-install security scanner for Claude Code skills. Before you copy a skill from GitHub into your `~/.claude/skills/` directory, run Skill Auditor to know what you are getting.

The scanner fetches the skill source from GitHub, runs 10 deterministic regex checks, applies an AI semantic review, and produces a verdict — CLEAN, CAUTION, or RISK — along with a saved markdown report.

## Usage

Once installed, invoke the skill from Claude Code:

```
/audit-skill owner/repo@skill-name
```

Examples:

```
/audit-skill tk-47/gobot-tools@security-sentinel
/audit-skill someuser/claudebot-skills@my-workflow
```

The skill identifier format is `<github-owner>/<repo>@<skill-directory-name>`.

## Check Inventory

Ten deterministic checks run against every file in the skill directory:

| ID | What It Catches | Severity |
|----|-----------------|----------|
| `SHELL_EXEC` | `curl ... \| bash`, `wget ... \| sh`, `eval(`, `exec(`, `bash -c` | RISK |
| `EXTERNAL_URL` | HTTP/HTTPS URLs pointing to domains not on the safe list | CAUTION |
| `CREDENTIAL_ACCESS` | Reads of `~/.ssh/`, `~/.aws/`, `~/.gnupg/`, `~/.env`, `/etc/passwd`, `/etc/shadow` | RISK |
| `OBFUSCATED` | Base64 blocks 40+ chars long; hex escape sequences `\xNN` repeated 4+ times | RISK |
| `PROMPT_INJECTION` | "Ignore previous instructions", "you are now", `<\|im_start\|>`, "act as DAN", role-override phrases | RISK |
| `SECURITY_DISABLE` | `--no-verify`, `--dangerously-skip-permissions`, `--force`, `--insecure`, `--allow-root` | RISK |
| `POST_INSTALL` | `postinstall`, `preinstall`, `prepare` keys in package.json (auto-run code on install) | CAUTION |
| `TELEMETRY` | Keywords: analytics, telemetry, tracking, Sentry, Mixpanel, Datadog, New Relic, Segment, Amplitude | CAUTION |
| `FS_OUTSIDE_PROJECT` | Paths to `/tmp/`, `/var/`, `/etc/`, `/usr/`, `/home/<user>/`, `/root/`, or `../../../` traversal | CAUTION |
| `PERMISSION_ESCALATION` | `sudo`, `chmod 777`, `chown root`, `setuid(`, `su - root`, `pkexec`, `runAs` | RISK |

## Verdicts

**CLEAN** — No findings from any of the 10 checks. The AI review found nothing suspicious. Safe to install.

**CAUTION** — One or more CAUTION-severity findings, or the AI review noted something worth reading. Review the flagged lines before proceeding. Most CAUTION findings are benign (e.g., a URL to a known service), but they warrant a human look.

**RISK** — One or more RISK-severity findings. Do not install without thoroughly understanding every flagged line. Some RISK findings are non-downgradable (see below) and cannot be cleared by context alone.

## Non-Downgradable RISK Tier

Certain patterns are treated as non-downgradable regardless of context or AI review. These cannot be reclassified as CAUTION or CLEAN:

- **Remote shell execution**: `curl`/`wget` piped to `bash` or `sh` from a domain not on the safe list
- **Credential directory reads**: direct access to `~/.ssh/`, `~/.aws/`, or `~/.gnupg/`
- **Large obfuscated blobs**: base64 tokens over 100 characters, or hex escape runs over 20 pairs
- **Role-override injection**: "you are now", `<|im_start|>`, "act as" with AI/DAN target, "pretend you are"
- **Permission escalation**: any of `sudo`, `chmod 777`, `chown root`, `setuid(`, `su - root`, `pkexec`, `runAs`

These represent categories where the risk of a supply-chain attack or prompt hijack is high enough that no explanatory prose justifies automatic clearance. The AI reviewer is explicitly instructed not to downgrade these findings.

## How the Data Flows

```
User invokes /audit-skill owner/repo@skill-name
        |
   scan.ts reads the skill identifier
        |
   GitHub API (public, read-only)
   -> Fetches skill files from the target repo
   -> No authentication required for public repos
        |
   All analysis runs locally
   (10 regex checks in checks.ts, AI semantic review in Claude)
        |
   Report saved locally to ~/.claude/skill-audits/
        |
   Verdict and summary printed to terminal.
   Nothing leaves the machine beyond the GitHub fetch.
   No telemetry. No uploads. No analytics.
```

When you run `/audit-skill`, the scanner makes a read-only request to the GitHub API to retrieve the markdown and source files in the target skill directory. Those files are loaded into memory on your machine. All 10 deterministic checks run locally. The AI semantic review runs inside the same Claude Code session — the skill content is passed to Claude as context, never to any external AI endpoint. The final report is written to `~/.claude/skill-audits/` and never transmitted anywhere.

## Privacy

### Endpoint Security

The only external network request is a read-only GitHub API call to fetch the skill's source files. No write operations are performed. The GitHub API is accessed over HTTPS. No data is sent to any analytics service, logging endpoint, or third-party platform.

### Local-Only Storage

All scan reports are saved to `~/.claude/skill-audits/` on your machine. Nothing is uploaded. Reports persist locally until you delete them.

### Minimal Data

The scanner fetches only the files inside the specified skill directory — markdown and source files. It does not access your GitHub account, your private repos, your local filesystem outside the report output directory, or any other data.

### Credential Model

An optional `GITHUB_TOKEN` environment variable can be set to increase GitHub API rate limits or scan private repositories. No token is required for public repos. The token is read from your environment at runtime and is never stored, logged, or transmitted anywhere except to the GitHub API itself.

### No Telemetry

Skill Auditor contains no analytics, tracking, beacons, or phone-home behavior of any kind. The check inventory explicitly includes a `TELEMETRY` check that flags these patterns — the tool itself passes its own audit.

## Updating

```
gobot-tools update skill-auditor
```
