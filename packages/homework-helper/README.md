# Homework Helper

A standalone web app that turns your existing bot's API keys into a grades 5–8 homework helper. Your child opens it on any device — iPad, tablet, laptop, phone — on the same WiFi as the computer running the server.

The critical design decision: **math answers are never guessed**. Claude writes Python code, E2B runs it in an isolated cloud VM, and the verified output becomes the answer. Claude only explains how to get there. For science, history, and English, a single vision call reads the question (or a photo of the worksheet), grounds the answer in any reference material provided, and explains at grade level.

No database. No login. No framework. Stateless per request.

---

## What Your Child Can Do

| Input | What Happens |
|-------|-------------|
| Type "What is 3/4 + 1/2?" | E2B computes `5/4`, Claude explains the steps |
| Photo of a math worksheet | Claude reads the problem, E2B computes, Claude explains |
| Type a science question | Claude explains at grade 5–8 level |
| Photo of textbook + question | Claude answers grounded in the page shown |
| History question | Claude explains, explicitly flags anything uncertain |
| "Correct this sentence: the dog runned fast" | Shows corrected version + explains each grammar rule |
| "Define photosynthesis" or vocabulary question | Definition, part of speech, synonyms, example sentence |
| Off-topic question | Politely redirected back to homework |

---

## How It Works

### Math pipeline (3 steps)

```
Question or photo
  → POST /ask
    → [Step 1] claude-sonnet-4-6 (vision if image provided)
        reads the problem, returns JSON:
        { problem, subject: "math", python_code }
        python_code uses fractions/sympy/math and always print()s the answer
    → [Step 2] E2B cloud sandbox executes python_code
        captures stdout as the verified answer
    → [Step 3] claude-haiku-4-5 (text only — low cost)
        given { problem, python_code, computed_answer }
        writes a step-by-step explanation at middle-school level
  → Response: { subject, problem, answer, explanation, steps[] }
```

**Claude never states the numeric answer in step 1 or step 3 — it comes only from E2B stdout.**

### Science / History pipeline (1 step)

```
Question + optional reference image
  → POST /ask
    → claude-sonnet-4-6 (vision, with reference image if provided)
        answers grounded in the uploaded material
        explains at grade 5–8 level
        flags uncertainty explicitly
  → Response: { subject, problem, explanation }
```

---

## Architecture

```
homework-helper/
  server.ts          ← Bun HTTP server (Windows / Mac / Linux)
  package.json       ← standalone deps only
  .env.example
  src/
    solver.ts        ← full pipeline (subject detect → E2B → explain)
    prompts.ts       ← system prompts, age-calibrated for grades 5–8
    types.ts         ← shared TypeScript interfaces
  public/
    index.html       ← SPA shell (KaTeX CDN)
    app.js           ← frontend: image capture, upload, fetch, UI
    styles.css       ← mobile-first, 44px touch targets, dark mode
```

This is **completely standalone** — it has no dependency on the Telegram bot, Grammy, Convex, or any other part of your bot stack. The only things it shares are the same API keys you already have in your `.env`.

---

## Running Alongside Your Bot

The homework helper runs on its own port (default `3000` or `PORT` env var). If your bot is already on port 3000, set `PORT=3001` or any free port.

Your child's device connects over WiFi to your computer's local IP:

```
[Your Mac / PC]
  running: bun run start (homework-helper)
  on port: 3001

[Child's iPad / tablet / laptop / phone]
  opens: http://192.168.x.x:3001
  (same WiFi network)
```

Find your local IP:
- **Mac:** `ipconfig getifaddr en0` (or `en1` for WiFi)
- **Windows:** `ipconfig` → IPv4 Address
- **Linux:** `ip addr show`

No public URL needed. No Cloudflare tunnel needed. Works entirely over your local network.

---

## Requirements

- [Bun](https://bun.sh) installed on the host machine
- `ANTHROPIC_API_KEY` — same one your bot uses
- `E2B_API_KEY` — free tier covers ~100 executions/day (plenty for homework)
- Child's device on the same WiFi network

---

## Setup (5 minutes)

### Step 1 — Install the tool

```bash
gobot-tools install homework-helper
```

Or clone manually from `packages/homework-helper/` in this repo.

### Step 2 — Set up your `.env`

```bash
cp .env.example .env
```

Edit `.env` with your keys. If your bot's `.env` already has `ANTHROPIC_API_KEY` and `E2B_API_KEY`, you can symlink instead:

```bash
# Mac/Linux
ln -sf /path/to/your/bot/.env .env

# Windows — run in the homework-helper folder
mklink .env ..\..\.env
```

### Step 3 — Install dependencies

```bash
bun install
```

### Step 4 — Start the server

```bash
bun run start
```

You should see:
```
Homework Helper running at http://localhost:3000
```

### Step 5 — Connect your child's device

Find your computer's local IP and open `http://<IP>:<PORT>` in any browser. No app install needed — it's a web page.

---

## Cost Estimate

| Component | Cost per question |
|-----------|------------------|
| claude-sonnet-4-6 (vision, step 1) | ~$0.002–0.004 |
| E2B sandbox (math only) | ~$0.001 |
| claude-haiku-4-5 (explanation) | ~$0.0005 |
| **Total per math question** | **~$0.003–0.005** |
| Science/history (one vision call) | ~$0.002–0.003 |

A typical homework session (5–10 questions): **$0.02–0.05**.

E2B new accounts receive a **$100 free credit** — at this rate it covers tens of thousands of homework questions.

---

## How the Data Flows

```
Child types question or snaps photo on their device
    ↓  (HTTPS POST over local WiFi)
Your computer running homework-helper/server.ts
    ↓  (HTTPS, API key authenticated)
Anthropic API  →  claude-sonnet-4-6
    returns: { problem, python_code }  (math)
    or: { subject, explanation }       (science/history)
    ↓  (math only — HTTPS, API key authenticated)
E2B API  →  Firecracker microVM (ephemeral, isolated)
    executes python_code, captures stdout
    microVM destroyed immediately after execution
    ↓
Your computer assembles { answer, explanation, steps }
    ↓  (HTTPS response over local WiFi)
Child's browser renders the answer with KaTeX math rendering
```

**What never happens:**

- No data is stored anywhere — every request is fully stateless
- Your child's questions are never retained by Anthropic beyond standard inference (same as any Claude API call)
- E2B destroys the sandbox immediately after code runs — no data persists
- The app has no login, no session tracking, no analytics
- Nothing is sent to any server except Anthropic API (question text) and E2B API (Python code, math only)
- The reference image your child uploads stays on their device until POST — it is not stored on your server

---

## Privacy

**Local network only:** The server binds to all interfaces on your local machine. Your child's device connects over WiFi. No public URL is required and none is recommended — this app is intentionally not internet-facing.

**Stateless by design:** No database, no session storage, no log files. Each request is independent. If you restart the server, nothing is lost because nothing was saved.

**No credentials on the child's device:** API keys live in `.env` on your computer. The browser never sees them. The child's device only makes requests to your local server, which makes upstream API calls on their behalf.

**Minimal data to Anthropic:** The question text and any uploaded images are sent to Anthropic's API for inference. Anthropic's standard API data handling applies — see [anthropic.com/privacy](https://anthropic.com/privacy). Image data is not stored beyond inference.

**Minimal data to E2B:** For math problems only, the Python code generated by Claude (not your child's original question) is sent to E2B for execution. The sandbox is destroyed immediately after. E2B does not receive question text, images, or personally identifiable information. See [e2b.dev/privacy](https://e2b.dev/privacy).

**No OAuth, no accounts:** The only credentials are two API keys in a `.env` file on your machine. There is no account creation, no sign-in flow, and no third-party auth.

---

## Updating

```bash
gobot-tools update homework-helper
```
