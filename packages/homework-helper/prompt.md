# Homework Helper — Setup Guide

I need you to set up the Homework Helper web app in my project.

## What this is

A standalone Bun web server that gives a child (grades 5–8) an AI homework helper accessible from any device on the same WiFi network. Math answers are verified by running Python code in an E2B cloud sandbox — Claude never guesses the answer. Science and history use a single Claude vision call.

## Files to install

The following files should already be present in your project under `homework-helper/` after running `gobot-tools install homework-helper`. If not, they are in the tool package:

```
homework-helper/
  server.ts
  package.json
  .env.example
  src/
    types.ts
    solver.ts
    prompts.ts
  public/
    index.html
    app.js
    styles.css
```

## Setup steps

### 1. Dependencies

Install the homework-helper's own dependencies (separate from the main bot):

```bash
cd homework-helper
bun install
```

### 2. Environment

The app needs two keys: `ANTHROPIC_API_KEY` and `E2B_API_KEY`.

Option A — symlink the bot's `.env` (if the keys are already there):
```bash
# Mac/Linux — run from inside homework-helper/
ln -sf ../.env .env
```

Option B — create a separate `.env`:
```bash
cp .env.example .env
# Edit .env and fill in:
# ANTHROPIC_API_KEY=...
# E2B_API_KEY=...
# PORT=3001  (use 3001 if your bot is already on 3000)
```

### 3. E2B account

If you don't have an E2B API key yet:
1. Sign up at https://e2b.dev (free — $100 credit on signup)
2. Go to Dashboard → API Keys → copy your key
3. Add `E2B_API_KEY=your_key` to `.env`

### 4. Add a start script (optional)

To launch from the main project root, add to the root `package.json` scripts:

```json
"homework": "cd homework-helper && bun run server.ts"
```

Then start with `bun run homework`.

### 5. Start the server

```bash
# From inside homework-helper/
bun run start

# Or from project root (if you added the script above)
bun run homework
```

You should see:
```
Homework Helper running at http://localhost:3000
```

### 6. Find the local IP

Run this to get the WiFi IP your child's device will use:

```bash
# Mac
ipconfig getifaddr en1

# Linux
ip addr show | grep "inet " | grep -v 127

# Windows
ipconfig
```

Give your child: `http://<IP>:<PORT>` — open in any browser, no install required.

### 7. Verify it works

Test these in order:
- [ ] `http://localhost:3000` renders the input card in your browser
- [ ] Type "What is 3/4 + 1/2?" → answer should be `5/4` (computed by E2B, not guessed)
- [ ] Ask a history question → explanation only, no Python/E2B step
- [ ] Upload a photo of a math problem → problem extracted, answer computed
- [ ] Ask an off-topic question (e.g., "write me a poem") → polite redirect
- [ ] Open `http://<local-IP>:3000` on your child's tablet → layout looks correct

## Port conflict

If port 3000 is already in use by your bot:

```bash
PORT=3001 bun run server.ts
```

Or add `PORT=3001` to the `.env` file.

## Troubleshooting

**"Failed to parse problem extraction JSON"** — Claude returned malformed JSON. Usually recovers on retry. If persistent, check that your `ANTHROPIC_API_KEY` is valid.

**"Sandbox execution failed"** — Check that `E2B_API_KEY` is set and your account has credits.

**Child's device can't connect** — Make sure both devices are on the same WiFi network. Some routers have "AP isolation" that blocks device-to-device traffic — disable it in your router settings.

**Math answer wrong** — The answer comes from Python execution, so it is correct by definition. If it looks wrong, the issue is in the problem text extraction (Step 1). Try typing the problem more explicitly, or check the "Problem:" line in the answer card to see what Claude extracted.
