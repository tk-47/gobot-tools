# E2B Code Sandbox

Give your Claudebot the ability to execute Python code in a secure, isolated cloud sandbox. Claude can write code, run it, and report back real results — for calculations, data analysis, text processing, and exploratory scripts.

Powered by **[E2B](https://e2b.dev)** — each execution runs in an ephemeral Firecracker microVM that spins up, runs your code, and is destroyed. No local Docker required.

---

## Requirements

- An E2B account — sign up at [e2b.dev](https://e2b.dev) (free $100 credit on signup)
- Your bot running (local Mac or VPS)
- Node.js/Bun with `@e2b/code-interpreter` installed

---

## Setup (5 minutes)

### Step 1 — Create an E2B account

Sign up at **[e2b.dev](https://e2b.dev)**. New accounts receive a **$100 free credit** automatically — no payment method required to start.

### Step 2 — Get your API key

In the E2B dashboard, go to **API Keys** and copy your key.

### Step 3 — Add to your bot's `.env`

```
E2B_API_KEY=your_e2b_api_key_here
SANDBOX_ENABLED=true
SANDBOX_AUTO_RUN_DAILY_LIMIT=20
```

`SANDBOX_ENABLED` defaults to `false` — you must explicitly opt in. `SANDBOX_AUTO_RUN_DAILY_LIMIT` caps the number of Claude-initiated executions per day per chat (default: 20).

### Step 4 — Install the dependency

```bash
bun add @e2b/code-interpreter
```

### Step 5 — Install the bot integration

Open `prompt.md` in Claude Code and say: **"Set up E2B code sandbox"**

---

## How It Works

### `/run` — Direct execution

Type `/run` followed by Python code (with or without markdown fences). The bot executes it immediately and returns stdout, stderr, exit code, and duration.

```
/run
import math
print(math.factorial(20))
```

### Claude-initiated execution

When Claude determines that running code would give a better answer, it generates an `[ACTION:run_code]` tag. The bot shows a **"Run Code"** confirmation button — tap it to execute. Claude never runs code without your approval.

The daily limit (`SANDBOX_AUTO_RUN_DAILY_LIMIT`) counts these Claude-proposed executions. `/run` commands are not counted against the limit.

---

## What You Can Run

The E2B default sandbox comes with Python 3 and the standard library pre-installed. Common use cases:

| Task | Example |
|------|---------|
| Math & calculations | Compound interest, unit conversions, statistics |
| Data processing | Parse CSV, sort/filter, compute averages |
| Text manipulation | Regex, formatting, encoding/decoding |
| Algorithmic problems | Sorting, searching, combinatorics |
| Date/time logic | Schedule calculations, time zone conversions |
| Quick scripts | Anything you'd run in a REPL |

**Limits per execution:**
- Timeout: 10 seconds
- stdout: 3,000 characters (truncated)
- stderr: 1,000 characters (truncated)
- No outbound network access from executed code

---

## Estimated Usage & Cost

New accounts receive **$100 in free credits** from E2B. E2B charges by the second of sandbox runtime — see [e2b.dev/pricing](https://e2b.dev/pricing) for current rates.

At typical usage (most scripts finish in 1–3 seconds), the free credit covers a very large number of executions before any charges apply. For a personal bot running 10–20 code requests per day, the $100 credit typically lasts **months to years**.

After the free credit, costs remain low for personal use: a 10-second execution costs a fraction of a cent.

---

## How the Data Flows

Understanding exactly where your code goes is important. Here's the full picture:

```
You (Telegram message or /run command)
    ↓
Bot extracts Python code from message
    ↓  (HTTPS POST, API key authenticated)
E2B API  →  Firecracker microVM (ephemeral, isolated)
    ↓  (executes code, captures stdout/stderr)
microVM destroyed immediately after execution
    ↓
Bot receives result (stdout, exitCode, durationMs)
    ↓  (formatted response)
Your Telegram chat
```

**For Claude-initiated runs:**

```
Your message
    ↓
Claude subprocess  →  generates [ACTION:run_code] tag
    ↓
Bot stores as pending (5-minute expiry)
    ↓  (you tap "Run Code" confirmation button)
E2B API  →  microVM  →  result  →  Telegram
```

**What this means in practice:**

- Your code is sent over HTTPS to E2B's API, executed in a fresh microVM, and the VM is destroyed
- No filesystem state persists between runs — each execution starts clean
- The executed code cannot make outbound network requests
- Results are returned to your bot and sent back to you in Telegram
- Claude receives the result as part of its response context — processed transiently, not stored by Anthropic beyond their standard retention policy

**What never happens:**

- Code results are never stored on E2B's servers after the sandbox is destroyed
- The executed code cannot access your local filesystem, environment variables, or bot secrets
- Claude never runs code without your explicit confirmation (confirmation button or `/run` command)
- E2B does not have access to your Telegram messages — only the code snippet sent to the API

---

## Privacy

**API key security:** Your `E2B_API_KEY` lives in your bot's `.env` file, loaded at startup. It is never sent to users, never logged to chat, and never included in Claude's context.

**Ephemeral execution:** Each sandbox is a fresh Firecracker microVM. It is destroyed immediately after the execution completes. No data persists between runs. E2B cannot access code output after the response is returned.

**Network isolation:** By default, sandboxes do not have outbound network access. Code you run cannot reach external services, exfiltrate data, or call APIs.

**No local execution:** Code runs on E2B's infrastructure, not on your Mac or VPS. A malformed or malicious script cannot affect your bot's filesystem or processes.

**Opt-in by default:** `SANDBOX_ENABLED=false` is the default. The feature is inert until you explicitly enable it and add your API key.

**Daily limits:** `SANDBOX_AUTO_RUN_DAILY_LIMIT` (default 20) prevents runaway costs if Claude proposes many executions in a day. You can adjust or remove this limit.

**E2B's privacy policy:** E2B processes code in isolated VMs and does not retain execution data. Review [e2b.dev/privacy](https://e2b.dev/privacy) for their full policy.

---

## Updating

```bash
gobot-tools update e2b-sandbox
```
