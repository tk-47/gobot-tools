# Migrating from Supabase to Convex

> **For Claude Code:** Drop this file into your project root or paste it into a Claude Code session. Claude will walk you through each phase interactively. When you're ready, say: **"Start the Convex migration"**

A step-by-step guide for migrating a Bun/TypeScript Telegram bot from Supabase (PostgreSQL + REST API) to [Convex](https://convex.dev) (all-TypeScript reactive database). Uses a backend adapter pattern with zero downtime and instant rollback at every phase.

---

## Why Migrate?

**The problem with Supabase REST API:** Silent failures. A `NOT NULL` constraint violation returns HTTP 200 with an empty body — no error, no row inserted. If you're not checking response payloads carefully, data vanishes without a trace. We lost a month of messages before noticing.

**What Convex gives you:**
- Compile-time schema validation — TypeScript errors before deployment, not silent production failures
- All server functions are TypeScript — no SQL, no RPC functions, no pgvector extensions to manage
- Built-in vector search (replaces pgvector + custom SQL functions)
- Auto-generated `_id` (string) and `_creationTime` (ms epoch) on every document
- Transactional mutations — upserts are query-then-patch-or-insert inside a single mutation, no race conditions
- Free tier: 0.5GB database + 0.5GB vector storage + 1M function calls/month

**What this migration preserves:**
- All existing data (messages, memory, goals, tasks, logs)
- All existing embeddings (no re-embedding cost)
- Every function signature — consumers don't change behavior, just import paths

---

## Prerequisites

- A Bun/TypeScript project currently using Supabase
- [Bun](https://bun.sh/) runtime installed
- A Convex account (free at [convex.dev](https://convex.dev))

---

## The Approach: Backend Adapter Pattern

Instead of a risky big-bang cutover, a single env var switches between backends instantly:

```
DB_BACKEND=supabase  →  original behavior (default)
DB_BACKEND=dual      →  writes to both, reads from Convex
DB_BACKEND=convex    →  Convex only
```

**Zero downtime.** Instant rollback at every phase — just change one env var and restart.

```
Phase 0: Install Convex              ← rollback: delete convex/ dir
Phase 1: Schema + server functions   ← rollback: delete convex/ dir
Phase 2: Client adapter + imports    ← rollback: DB_BACKEND=supabase
Phase 3: Data migration              ← rollback: Supabase data untouched
Phase 4: Dual-write verification     ← rollback: DB_BACKEND=supabase
Phase 5: Convex-only cutover         ← rollback: DB_BACKEND=supabase
Phase 6: Cleanup                     ← rollback: restore from git
```

---

## Phase 0: Convex Project Setup (~5 min)

### What Claude Code does:
- Installs the Convex package
- Initializes a Convex project
- Adds env vars to `.env`

### Steps:

```bash
# Install Convex
bun add convex

# Initialize project (creates convex/ directory, authenticates, generates types)
npx convex dev --once
```

This will prompt you to:
1. Log in to Convex (browser-based)
2. Name your project
3. Choose a team

Then add to your `.env`:
```env
CONVEX_URL=https://your-project-123.convex.cloud
DB_BACKEND=supabase
```

`DB_BACKEND=supabase` keeps the original database active while you build out Convex.

### Tell Claude Code:
"Install Convex and initialize the project"

---

## Phase 1: Schema + Server Functions (~1-2 hours)

### What Claude Code does:
- Translates your Supabase SQL schema to a Convex TypeScript schema
- Creates server function files (mutations, queries, actions) for each table

### Schema Translation Reference

| Supabase | Convex |
|----------|--------|
| `BIGSERIAL PRIMARY KEY` / `UUID` | Auto-generated `_id` (string) |
| `TIMESTAMPTZ DEFAULT NOW()` | Auto-generated `_creationTime` (ms epoch) |
| `JSONB` | `v.any()` |
| `TEXT NOT NULL` | `v.string()` |
| `TEXT` (nullable) | `v.optional(v.string())` |
| `INTEGER` | `v.number()` |
| `BOOLEAN DEFAULT FALSE` | `v.optional(v.boolean())` |
| `VECTOR(1536)` | `v.optional(v.array(v.float64()))` |
| `CHECK (col IN ('a','b'))` | `v.union(v.literal("a"), v.literal("b"))` |
| `CREATE INDEX` | `.index("name", ["field1", "field2"])` |
| pgvector index | `.vectorIndex("name", { vectorField, dimensions, filterFields })` |
| SQL RPC function (`match_messages`) | Convex action with `ctx.vectorSearch()` |

### Example: Messages Table

**Supabase SQL:**
```sql
CREATE TABLE messages (
  id BIGSERIAL PRIMARY KEY,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  chat_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  metadata JSONB DEFAULT '{}'::jsonb,
  embedding VECTOR(1536)
);
CREATE INDEX idx_messages_chat_id ON messages (chat_id);
```

**Convex schema (`convex/schema.ts`):**
```typescript
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  messages: defineTable({
    chat_id: v.string(),
    role: v.union(v.literal("user"), v.literal("assistant")),
    content: v.string(),
    metadata: v.optional(v.any()),
    embedding: v.optional(v.array(v.float64())),
  })
    .index("by_chat_id", ["chat_id"])
    .vectorIndex("by_embedding", {
      vectorField: "embedding",
      dimensions: 1536,
      filterFields: ["chat_id"],
    }),
});
```

### Server Functions

Create one `.ts` file per table in the `convex/` directory. Each file contains mutations (writes), queries (reads), and actions (side effects like vector search).

**Example: `convex/messages.ts`:**
```typescript
import { v } from "convex/values";
import { mutation, query, action } from "./_generated/server";
import { api } from "./_generated/api";

export const insert = mutation({
  args: {
    chat_id: v.string(),
    role: v.union(v.literal("user"), v.literal("assistant")),
    content: v.string(),
    metadata: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("messages", {
      chat_id: args.chat_id,
      role: args.role,
      content: args.content,
      metadata: args.metadata ?? {},
    });
  },
});

export const getRecent = query({
  args: { chat_id: v.string(), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("messages")
      .withIndex("by_chat_id", (q) => q.eq("chat_id", args.chat_id))
      .order("desc")
      .take(args.limit ?? 20);
  },
});

export const backfillEmbedding = mutation({
  args: { id: v.id("messages"), embedding: v.array(v.float64()) },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, { embedding: args.embedding });
  },
});

// Vector search replaces Supabase's match_messages SQL RPC function
export const searchByVector = action({
  args: {
    chat_id: v.string(),
    embedding: v.array(v.float64()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<any[]> => {
    const results = await ctx.vectorSearch("messages", "by_embedding", {
      vector: args.embedding,
      limit: args.limit ?? 10,
      filter: (q) => q.eq("chat_id", args.chat_id),
    });
    const docs: any[] = [];
    for (const r of results) {
      const doc = await ctx.runQuery(api.messages.getById, { id: r._id });
      if (doc) docs.push({ ...doc, _score: r._score });
    }
    return docs;
  },
});
```

### Deploy:
```bash
npx convex dev --once
```

Verify all tables and indexes appear in the [Convex dashboard](https://dashboard.convex.dev).

### Tell Claude Code:
"Create the Convex schema and server functions based on my Supabase schema"

---

## Phase 2: Client Adapter (~2-3 hours)

### What Claude Code does:
- Creates `convex-client.ts` — a drop-in replacement for your Supabase client
- Creates `db.ts` — the backend adapter that switches on `DB_BACKEND`
- Updates all import paths

### The Adapter Layer

**`src/lib/db.ts`** — Routes to the active backend:

```typescript
import * as supabaseModule from "./supabase";

const backend = process.env.DB_BACKEND || "supabase";

// Lazy load — only resolves if convex package is installed
let _convexModule: typeof supabaseModule | null = null;
function getConvexModule(): typeof supabaseModule {
  if (!_convexModule) {
    _convexModule = require("./convex-client") as typeof supabaseModule;
  }
  return _convexModule;
}

const activeModule =
  backend === "convex"
    ? getConvexModule()
    : backend === "dual"
      ? buildDualModule()  // writes to both, reads from Convex
      : supabaseModule;

// Re-export every function consumers use
export const saveMessage = activeModule.saveMessage;
export const getRecentMessages = activeModule.getRecentMessages;
// ... etc
```

The lazy `require()` is critical — it prevents environments without the `convex` npm package (like a VPS that hasn't installed it yet) from crashing on import.

**`src/lib/convex-client.ts`** — Same function signatures as your Supabase client:

```typescript
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../convex/_generated/api";

// Same interface as supabase.ts
export async function saveMessage(message: Message): Promise<boolean> {
  const cx = getConvex();
  if (!cx) return false;
  const id = await cx.mutation(api.messages.insert, {
    chat_id: message.chat_id,
    role: message.role,
    content: message.content,
    metadata: message.metadata || {},
  });
  // Fire-and-forget embedding backfill (same pattern as supabase.ts)
  if (id) {
    generateEmbedding(message.content).then((embedding) => {
      if (embedding.length > 0) {
        cx.mutation(api.messages.backfillEmbedding, { id, embedding }).catch(() => {});
      }
    }).catch(() => {});
  }
  return true;
}
```

Key: convert Convex `_id` / `_creationTime` to the `id` / `created_at` strings your consumers expect.

### Import Path Changes

Every file that imports from your Supabase client changes one line:

```diff
- import { saveMessage, getFacts } from "./lib/supabase"
+ import { saveMessage, getFacts } from "./lib/db"
```

If any files bypass your Supabase client with raw `fetch()` calls to the REST API, refactor them to use the adapter instead.

### Tell Claude Code:
"Create the Convex client adapter and update all import paths"

---

## Phase 3: Data Migration (~15-30 min)

### What Claude Code does:
- Creates a one-time migration script
- Reads all rows from Supabase REST API
- Batch-inserts into Convex (preserving existing embeddings)

### Migration Script Pattern

```typescript
// Read from Supabase REST API (paginated)
async function fetchSupabase(table: string): Promise<any[]> {
  const allRows: any[] = [];
  let offset = 0;
  while (true) {
    const url = `${SUPABASE_URL}/rest/v1/${table}?limit=1000&offset=${offset}`;
    const res = await fetch(url, {
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
    });
    const rows = await res.json();
    allRows.push(...rows);
    if (rows.length < 1000) break;
    offset += 1000;
  }
  return allRows;
}

// Batch insert into Convex
for (const row of rows) {
  await convex.mutation(api.messages.insert, {
    chat_id: row.chat_id,
    role: row.role,
    content: row.content,
    metadata: row.metadata,
  });
  // Backfill embedding if present (saves OpenAI re-embedding costs)
  if (row.embedding) {
    await convex.mutation(api.messages.backfillEmbedding, {
      id, embedding: row.embedding,
    });
  }
}
```

### Run it:
```bash
bun run scripts/migrate-to-convex.ts
```

### Verify:
- Compare row counts in Supabase vs Convex dashboard
- Spot-check 5 records per table
- Test vector search on migrated data

### Tell Claude Code:
"Create and run the migration script"

---

## Phase 4: Dual-Write Verification (~24-48 hours)

### What Claude Code does:
- Sets `DB_BACKEND=dual`
- Restarts the bot
- Both databases receive writes, reads come from Convex

```env
DB_BACKEND=dual
```

### How dual mode works:

```typescript
// Writes go to both — either failing doesn't block the other
async saveMessage(...args) {
  const [a, b] = await Promise.allSettled([
    supabaseModule.saveMessage(...args),
    convexModule.saveMessage(...args),
  ]);
  return (a.status === "fulfilled" && a.value) ||
         (b.status === "fulfilled" && b.value);
}

// Reads come from Convex only
getRecentMessages = convexModule.getRecentMessages;
```

### Test everything:
- Send 10+ messages via Telegram
- Create and complete a goal
- Trigger an async task with inline buttons
- Run morning briefing
- Check both databases have matching data

### Tell Claude Code:
"Switch to dual mode and restart"

---

## Phase 5: Convex-Only Cutover (~5 min)

### What Claude Code does:
- Sets `DB_BACKEND=convex` on all nodes (local + VPS)
- Restarts all services

```env
DB_BACKEND=convex
```

Monitor for 48 hours. If anything breaks, instant rollback:

```env
DB_BACKEND=supabase
```

### Tell Claude Code:
"Switch to Convex-only mode"

---

## Phase 6: Cleanup (~1 hour)

After 48 hours of stable Convex-only operation:

### What Claude Code does:
- Removes the adapter layer — `convex-client.ts` becomes the only `db.ts`
- Deletes `supabase.ts`
- Removes `@supabase/supabase-js` from package.json
- Removes Supabase env vars from `.env.example`
- Removes `DB_BACKEND` env var (no longer needed)

Keep your Supabase project alive as a cold backup for 30 days, then delete it.

### Tell Claude Code:
"Clean up the Supabase adapter layer"

---

## Gotchas

| Issue | Solution |
|-------|----------|
| **Convex rejects `null` for optional fields** | Convert `null` to `undefined` in migration script and client code. Supabase returns `null`, Convex wants `undefined` |
| **`_creationTime` auto-appended to indexes** | Don't include it explicitly in `.index()` definitions — Convex adds it automatically |
| **Circular type inference in actions** | Actions that call `ctx.runQuery(api.X.getById)` referencing the same module need explicit `Promise<any[]>` return type annotations |
| **Lazy loading for multi-environment deploys** | Use `require()` not `import` in `db.ts` so environments without the `convex` package don't crash |
| **Vector search threshold differences** | pgvector cosine similarity and Convex use different scales. Your existing `match_threshold: 0.5` may need tuning |
| **ID format changes** | Supabase IDs (BIGSERIAL/UUID) are not preserved. Convex generates new string IDs. Clear any pending tasks with old IDs before cutover |
| **Supabase REST API returns `null`** | Convex `v.optional()` fields must be `undefined`, not `null`. Use `row.field ?? undefined` in migration |

---

## Cost Comparison

| | Supabase Free Tier | Convex Free Tier |
|---|---|---|
| Database | 500MB | 512MB |
| Vector storage | Included in DB | 512MB (separate) |
| API calls | Unlimited | 1M function calls/month |
| Realtime | 200 concurrent | Included |
| Bandwidth | 5GB | Included |
| Auth | Unlimited | N/A (bring your own) |

A personal bot with ~1K messages/day fits comfortably on either free tier. Our entire dataset (6 tables, ~1K rows with embeddings) was 459KB.

---

## References

- [Convex Documentation](https://docs.convex.dev/)
- [Convex Schema Reference](https://docs.convex.dev/database/schemas)
- [Convex Vector Search](https://docs.convex.dev/vector-search)
- [ConvexHttpClient (server-side)](https://docs.convex.dev/api/classes/browser.ConvexHttpClient)
- [Supabase REST API](https://supabase.com/docs/guides/api)
