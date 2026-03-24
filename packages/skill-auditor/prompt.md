# Skill Auditor Setup

Let's get Skill Auditor running so you can scan any Claude Code skill from GitHub before installing it.

## Step 1 — Install the tool

```bash
gobot-tools install skill-auditor
```

This downloads the scanner files to `~/.gobot-tools/skill-auditor/`.

## Step 2 — Copy SKILL.md to your skills directory

The `/audit-skill` command is defined in `SKILL.md`. Copy it to your Claude Code skills directory so Claude Code recognizes it:

```bash
mkdir -p ~/.claude/skills/skill-auditor
cp ~/.gobot-tools/skill-auditor/SKILL.md ~/.claude/skills/skill-auditor/SKILL.md
```

Restart Claude Code (or reload skills) after copying.

## Step 3 — Scan a skill

Invoke the command from any Claude Code session:

```
/audit-skill owner/repo@skill-name
```

Example:

```
/audit-skill tk-47/gobot-tools@security-sentinel
```

The scanner will:
1. Fetch the skill files from GitHub
2. Run 10 deterministic security checks
3. Run an AI semantic review
4. Print a verdict (CLEAN / CAUTION / RISK) with details

## Step 4 — Check saved reports

Every scan saves a full markdown report to:

```
~/.claude/skill-audits/
```

Reports are named by skill and timestamp so you can review past scans.

## Optional — GitHub token for private repos or higher rate limits

If you want to scan private repos, or if you hit GitHub API rate limits on public repos, set a token:

```bash
export GITHUB_TOKEN=your_github_token_here
```

No token is required for public repositories.

## Updating

```bash
gobot-tools update skill-auditor
```
