# E2B Code Sandbox — Setup Guide

You are helping the user add Python code execution to their Claudebot via E2B sandboxes.

## What this adds

- `/run <python code>` — execute code directly, get stdout/stderr back in chat
- Claude-initiated execution — Claude can propose running code via `[ACTION:run_code]` tags; user confirms with a button tap
- Daily limit on Claude-proposed runs (configurable, default 20/day)
- Full isolation: Firecracker microVM, no network access from code, ephemeral filesystem

## Step 1 — Check prerequisites

Verify the user has:
1. An E2B API key in their `.env` as `E2B_API_KEY`
2. `SANDBOX_ENABLED=true` in their `.env`
3. `@e2b/code-interpreter` installed (`bun add @e2b/code-interpreter`)

If any are missing, help them set those up first.

## Step 2 — Install sandbox.ts

Copy `src/sandbox.ts` from this package into the bot's `src/lib/sandbox.ts`.

Verify the file exports:
- `isSandboxEnabled(): boolean`
- `runInSandbox(code: string): Promise<SandboxResult>`
- `extractCode(input: string): string`

## Step 3 — Add the /run command to bot.ts

In `bot.ts`, add an import at the top:
```typescript
import { runInSandbox, extractCode, isSandboxEnabled } from "./lib/sandbox";
```

Add this command handler (before the default message handler):
```typescript
bot.command("run", async (ctx) => {
  if (!isSandboxEnabled()) {
    await ctx.reply("Code sandbox is not enabled. Set SANDBOX_ENABLED=true and E2B_API_KEY in .env.");
    return;
  }
  const input = ctx.message?.text?.replace(/^\/run\s*/i, "").trim();
  if (!input) {
    await ctx.reply("Usage: /run <python code>\n\nExample:\n/run print(2 ** 32)");
    return;
  }
  const code = extractCode(input);
  const statusMsg = await ctx.reply("_Running…_", { parse_mode: "Markdown" });
  const result = await runInSandbox(code);
  const icon = result.exitCode === 0 ? "✅" : "❌";
  const lines = [
    `${icon} Exit ${result.exitCode} · ${result.durationMs}ms`,
    result.stdout ? `\`\`\`\n${result.stdout}\n\`\`\`` : "",
    result.stderr ? `⚠️ stderr:\n\`\`\`\n${result.stderr}\n\`\`\`` : "",
  ].filter(Boolean).join("\n");
  await ctx.api.editMessageText(ctx.chat.id, statusMsg.message_id, lines, { parse_mode: "Markdown" });
});
```

## Step 4 — Add run_code action tag (optional — for Claude-initiated execution)

In `src/lib/action-tags.ts`, add this import near the top:
```typescript
import { runInSandbox, isSandboxEnabled } from "./sandbox";
```

Add a pending run state section:
```typescript
const STALE_RUN_MS = 5 * 60 * 1000;

export interface PendingRun {
  code: string;
  description: string;
  timestamp: number;
}

const pendingRuns = new Map<number, PendingRun>();

function getDailyRunLimit(): number {
  return parseInt(process.env.SANDBOX_AUTO_RUN_DAILY_LIMIT || "20", 10);
}

const dailyRunCounts = new Map<string, number>();

function checkDailyBudget(chatId: number): { allowed: boolean; limit: number } {
  const today = new Date().toISOString().slice(0, 10);
  const key = `${chatId}:${today}`;
  const count = dailyRunCounts.get(key) ?? 0;
  const limit = getDailyRunLimit();
  return { allowed: count < limit, limit };
}

function incrementDailyCount(chatId: number): void {
  const today = new Date().toISOString().slice(0, 10);
  const key = `${chatId}:${today}`;
  dailyRunCounts.set(key, (dailyRunCounts.get(key) ?? 0) + 1);
}
```

Add `run_code` to the action handlers map:
```typescript
run_code: async (p, chatId) => {
  if (!isSandboxEnabled()) return "_(sandbox not available)_";
  const budget = checkDailyBudget(chatId);
  if (!budget.allowed)
    return `_(daily code-run limit reached — ${budget.limit}/day. Use /run to execute manually.)_`;
  const code = p.code as string;
  const description = (p.description as string) ?? "Run code";
  pendingRuns.set(chatId, { code, description, timestamp: Date.now() });
  return `_Proposed: ${description}_ — tap **Run Code** to execute.`;
},
```

In `bot.ts`, handle the confirmation button callback:
```typescript
bot.callbackQuery("confirm_run", async (ctx) => {
  const chatId = ctx.chat?.id;
  if (!chatId) return;
  const pending = pendingRuns.get(chatId);
  if (!pending || Date.now() - pending.timestamp > STALE_RUN_MS) {
    await ctx.answerCallbackQuery("Expired — use /run to execute manually.");
    return;
  }
  pendingRuns.delete(chatId);
  incrementDailyCount(chatId);
  await ctx.answerCallbackQuery("Running…");
  const result = await runInSandbox(pending.code);
  const icon = result.exitCode === 0 ? "✅" : "❌";
  const lines = [
    `${icon} Exit ${result.exitCode} · ${result.durationMs}ms`,
    result.stdout ? `\`\`\`\n${result.stdout}\n\`\`\`` : "",
    result.stderr ? `⚠️\n\`\`\`\n${result.stderr}\n\`\`\`` : "",
  ].filter(Boolean).join("\n");
  await ctx.reply(lines, { parse_mode: "Markdown" });
});
```

## Step 5 — Test it

Restart your bot and try:

```
/run print("Hello from E2B!")
```

Expected response:
```
✅ Exit 0 · 1842ms
Hello from E2B!
```

Then try an error case:
```
/run 1/0
```

Expected:
```
❌ Exit 1 · 1203ms
ZeroDivisionError: division by zero
```

## Done

The sandbox is live. Claude can now propose code runs via `[ACTION:run_code]`, and you can execute Python directly with `/run`. The `$100` E2B free credit covers a very large number of executions — typical personal use won't exhaust it for months.
