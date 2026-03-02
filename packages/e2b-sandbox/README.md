# E2B Code Sandbox

Without a sandbox, Claude writes code and hopes it works. With one, Claude writes code, runs it, reads the output, and gives you the real answer.

That's the difference this tool makes. Instead of "here's a script that should calculate that" you get the actual result. Instead of "try this regex" you get confirmation that it matches. Instead of a best-guess answer to a math problem, you get the number — verified by execution.

This is one of the most direct upgrades you can give an AI assistant: close the loop between writing code and knowing whether it worked.

---

## What You Can Do With It

The E2B sandbox runs Python 3 with the standard library. Common uses:

| Ask your bot... | What happens |
|-----------------|--------------|
| "If I invest $2,000/month at 7% for 25 years, what do I end up with?" | Claude writes and runs the calculation, returns the exact figure |
| "Parse this CSV and tell me which category had the highest total" | Claude processes the data, returns the answer |
| "Does this regex match my input?" | Claude runs it against your string, tells you what it captures |
| "What day of the week is Easter 2031?" | Claude computes it, doesn't guess |
| "Sort these names and remove duplicates" | Returns the actual cleaned list |
| `/run <your own script>` | Runs whatever you send, returns stdout/stderr |

---

## Why This Matters

Most AI tools can write code. Very few can run it. The gap between those two things is larger than it sounds.

When Claude can only write code, it reasons about what *should* happen. It applies pattern-matching from training. It's usually right, but "usually right" is not the same as "ran it and confirmed." For anything where the exact answer matters — a financial calculation, a data transformation, a parsing problem — there's a meaningful difference between a confident guess and a verified result.

When Claude can run code, the dynamic changes:

- **It can verify its own work.** If the first attempt fails, Claude sees the error and tries again — in the same conversation, before it replies to you.
- **You get actual output, not predicted output.** The answer to "what's the compound interest on $50,000 at 4.2% over 18 years?" is a number, not a formula.
- **It handles the edge cases you didn't think to ask about.** An off-by-one error surfaces in the output. A type mismatch throws a real exception. You find out now, not later.
- **Complex tasks become tractable.** Multi-step data processing, text transformations, schedule calculations — Claude can work through them iteratively with real feedback instead of writing a wall of code and hoping.

The sandbox also means none of this touches your machine. Code runs in an isolated cloud VM that is destroyed the moment it finishes. Nothing can reach your filesystem, your environment variables, or your bot's processes.

---

## Estimated Usage & Cost

New accounts receive **$100 in free credits** from E2B — no payment method required to start. E2B charges by the second of sandbox runtime (see [e2b.dev/pricing](https://e2b.dev/pricing) for current rates). Most executions finish in 1–3 seconds.

For a personal bot at 10–20 code requests per day, the $100 credit typically lasts **months to years**. After that, a 10-second execution costs a fraction of a cent.

---

## Requirements

- An E2B account — sign up at [e2b.dev](https://e2b.dev)
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

The daily limit (`SANDBOX_AUTO_RUN_DAILY_LIMIT`) counts Claude-proposed executions. `/run` commands are not counted against the limit.

**Execution limits:**
- Timeout: 10 seconds
- stdout: 3,000 characters (truncated)
- stderr: 1,000 characters (truncated)
- No outbound network access from executed code

---

## How the Data Flows

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

**What never happens:**

- Code results are never stored on E2B's servers after the sandbox is destroyed
- The executed code cannot access your local filesystem, environment variables, or bot secrets
- Claude never runs code without your explicit confirmation (confirmation button or `/run` command)
- E2B does not have access to your Telegram messages — only the code snippet sent to the API

---

## Privacy

**API key security:** Your `E2B_API_KEY` lives in your bot's `.env` file, loaded at startup. It is never sent to users, never logged to chat, and never included in Claude's context.

**Ephemeral execution:** Each sandbox is a fresh Firecracker microVM. It is destroyed immediately after the execution completes. No data persists between runs.

**Network isolation:** Sandboxes do not have outbound network access by default. Code you run cannot reach external services, exfiltrate data, or call APIs.

**No local execution:** Code runs on E2B's infrastructure, not on your Mac or VPS. A malformed or malicious script cannot affect your bot's filesystem or processes.

**Opt-in by default:** `SANDBOX_ENABLED=false` is the default. The feature is inert until you explicitly enable it and add your API key.

**Daily limits:** `SANDBOX_AUTO_RUN_DAILY_LIMIT` (default 20) prevents runaway costs if Claude proposes many executions in a day. You can adjust or remove this limit.

**E2B's privacy policy:** E2B processes code in isolated VMs and does not retain execution data. Review [e2b.dev/privacy](https://e2b.dev/privacy) for their full policy.

---

## Updating

```bash
gobot-tools update e2b-sandbox
```
