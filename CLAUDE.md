# gobot-tools — Claudebot Tool Marketplace

npm CLI (`gobot-tools`) for browsing, installing, and updating community tools for the Claudebot AI agent. Published at `tk-47/gobot-tools`.

## Project Structure

```
cli/
  src/
    index.ts          # CLI entry point + command definitions
    commands/         # One file per CLI command
    lib/              # Shared utilities (registry fetch, file install, version check)
packages/
  <tool-name>/
    prompt.md         # Claude Code setup guide (loaded by user to configure tool)
    README.md         # Public docs — MUST include Data Flow + Privacy sections
    .env.example      # All env vars the tool needs
    src/              # Tool source file(s)
scripts/
  generate-registry.ts  # Rebuilds registry.json from packages/
registry.json         # Published registry (generated, not hand-edited)
dist/
  index.js            # Built CLI (committed, not gitignored)
```

## CLI Commands

```bash
gobot-tools list                    # Browse available tools
gobot-tools install <tool>          # Install a tool into the bot
gobot-tools update [tool]           # Re-download if registry version > installed version
gobot-tools remove <tool>           # Uninstall a tool

# Development
bun run dev                         # Run CLI without building
bun run registry                    # Regenerate registry.json from packages/
bun run build                       # Build dist/index.js
```

Installed versions are tracked in `~/.gobot-tools/config.json` under `installedVersions`.

## Adding a New Tool

1. Create `packages/<tool-name>/` with these required files:
   - `prompt.md` — conversational setup guide for Claude Code
   - `README.md` — public docs (see README Requirements below)
   - `.env.example` — all required env vars with comments
   - `src/<tool-name>.ts` (or `.py`) — the tool source

2. Add an entry to `registry.json` (or run `bun run registry` to regenerate):
   ```json
   {
     "name": "tool-name",
     "displayName": "Human-Readable Name",
     "description": "One-sentence description.",
     "version": "1.0.0",
     "author": "tk-47",
     "category": "health|integrations|security|productivity",
     "files": ["prompt.md", "README.md", ".env.example", "src/tool-name.ts"],
     "envVars": ["MY_API_KEY"],
     "postInstall": "Open prompt.md in Claude Code and say: \"Set up X\""
   }
   ```

3. Add matching `package.json` inside `packages/<tool-name>/` with the same `"version"`.

4. Publish (see Publishing below).

## Versioning Rules

**Every bug fix or feature change to any tool requires**:
1. Bump `version` in `packages/<tool-name>/package.json`
2. Bump the same `version` in `registry.json` for that tool
3. Rebuild and publish (see below)

Existing users run `gobot-tools update <tool>` to get the new version. The CLI compares `registry.json` version against `~/.gobot-tools/config.json` installedVersions.

**CLI changes** (anything in `cli/src/`): bump version in root `package.json` AND in `cli/src/index.ts` (the version constant used in `--version` output).

## Publishing

```bash
bun run build           # Rebuilds dist/index.js
npm publish --access public
```

`prepublishOnly` runs `build` automatically. Only `dist/index.js`, `README.md`, and `LICENSE` are published (see `"files"` in root `package.json`).

**ALWAYS publish to npm after pushing to GitHub.** Every push that changes `registry.json`, a tool's files, or the CLI must be followed by a version bump and `npm publish`. GitHub is the source of truth for code; npm is what users actually install. A push without a publish leaves users on a stale version.

Checklist for every change:
1. Bump version in root `package.json` + `cli/src/index.ts`
2. `git push`
3. `npm publish --access public`

## README Requirements (Every Tool)

Every tool README **must** include these two sections — this is non-negotiable:

### 1. "How the Data Flows"
ASCII diagram + prose showing exactly where data goes end-to-end. Explicitly state what never happens (no third-party servers, no data at rest with AI providers, etc.).

### 2. "Privacy"
Named subsections covering:
- Endpoint security
- Local-only storage
- Minimal data collection
- Credential model (no OAuth, no API accounts — just env vars)
- Any relevant third-party privacy policies

Model: `packages/apple-health/README.md` (commit b89afe8).

### Also Required
Every tool README must include an **"Updating"** section:
```markdown
## Updating
gobot-tools update <tool-name>
```

## Existing Tools (14)

| Tool | Category | Key Env Vars |
|------|----------|-------------|
| apple-health | health | `APPLE_HEALTH_WEBHOOK_SECRET` |
| garmin | health | `GARMIN_EMAIL`, `GARMIN_PASSWORD` |
| oura-ring | health | `OURA_ACCESS_TOKEN` |
| fireflies | integrations | `FIREFLIES_API_KEY` |
| flightaware | integrations | `FLIGHTAWARE_API_KEY` |
| google-api | integrations | Google OAuth credentials |
| ms365 | integrations | MS365 OAuth credentials |
| tempest-weather | integrations | `TEMPEST_TOKEN`, `TEMPEST_STATION_ID` |
| teams | integrations | Teams webhook config |
| security-sentinel | security | `VPS_URL`, `ANTHROPIC_API_KEY` (optional) |
| security-audit | security | VPS SSH config |
| vps-hardening | security | VPS SSH config |
| supabase-to-convex | productivity | `SUPABASE_URL`, `CONVEX_URL` |
| voice-interface | integrations | `ELEVENLABS_API_KEY` |

## Secret Safety

**NEVER** include real API keys, tokens, passwords, or secrets in any file committed to this repo. Use only placeholders like `your_key_here` or `aBcDeFgHiJkLmNoPqRsTuV` in `.env.example` files and READMEs. This repo is public.
