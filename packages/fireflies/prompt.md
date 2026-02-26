# Fireflies.ai Meeting Transcript Integration

> **For Claude Code:** Drop this file into your project root or paste it into a Claude Code session. Claude will walk you through each step interactively. When you're ready, say: **"Set up Fireflies.ai integration"**

Connect your Telegram bot to [Fireflies.ai](https://fireflies.ai) so that when a meeting is transcribed, the bot automatically:

- Stores the meeting summary as a **fact** in memory
- Saves each action item as a **goal** you can track
- Sends you a Telegram notification with what was captured

No manual note-taking. Your bot remembers every meeting.

---

## How It Works

Fireflies.ai records and transcribes your meetings (Zoom, Google Meet, Teams, etc.). When a transcript is ready, Fireflies sends a webhook to your bot. The bot fetches the full transcript via Fireflies' GraphQL API, extracts the summary and action items, and stores them in your database.

```
Meeting ends → Fireflies transcribes
  │
  └── Webhook POST to your bot: /webhook/fireflies
        │
        ├── Fetch full transcript via GraphQL API
        │     └── summary, action items, participants, duration
        │
        ├── Store meeting summary as a fact in memory
        │     "Meeting: 'Q1 Planning' on Feb 18. Duration: 45m.
        │      Participants: Alice, Bob. Summary: Discussed roadmap..."
        │
        ├── Store each action item as a goal
        │     - "Follow up with design team on mockups"
        │     - "Send revised budget to finance by Friday"
        │
        └── Send Telegram notification:
              "Meeting transcript processed: 'Q1 Planning'
               Summary saved to memory.
               2 action item(s) added as goals:
                 - Follow up with design team on mockups
                 - Send revised budget to finance by Friday"
```

---

## Prerequisites

- A [Fireflies.ai](https://fireflies.ai) account (**Business tier** or higher — API access required)
- Your bot running with a publicly accessible URL (VPS with domain, or Cloudflare tunnel)

---

## Step 1: Get Your Fireflies API Key

### What you need to do:

1. Go to [app.fireflies.ai/integrate](https://app.fireflies.ai/integrate)
2. Find the **API & Webhooks** section
3. Copy your **API Key**

### Tell Claude Code:
"Here's my Fireflies API key: [KEY]"

---

## Step 2: Add to Environment

### What Claude Code does:
- Adds `FIREFLIES_API_KEY` to your `.env` file

```env
# Fireflies.ai Meeting Transcripts
FIREFLIES_API_KEY=your-api-key-here
```

**Required:** Add a webhook signing secret for signature verification:

```env
FIREFLIES_WEBHOOK_SECRET=your-webhook-signing-secret
```

The bot **rejects all webhooks** if no secret is configured. This prevents attackers from injecting fake transcripts (which would be stored as facts and goals in your memory). The secret is used to verify the `x-ff-signature` header using HMAC SHA-256.

> **Security note (2026-02-24):** Prior versions accepted unsigned webhooks when no secret was set. This was a security vulnerability — any POST to `/webhook/fireflies` with a valid-looking payload would be processed and stored. The default was flipped to reject-by-default. Always configure `FIREFLIES_WEBHOOK_SECRET`.

### Tell Claude Code:
"Add the Fireflies credentials to .env"

---

## Step 3: Configure the Webhook in Fireflies

### What you need to do:

1. Go to [app.fireflies.ai/integrate](https://app.fireflies.ai/integrate) > **Webhooks**
2. Click **Add Webhook**
3. Set the URL to your bot's Fireflies webhook endpoint:

   **If using a VPS with a domain:**
   ```
   https://your-domain.com/webhook/fireflies
   ```

   **If using a Cloudflare tunnel to your local machine:**
   ```
   https://your-tunnel.example.com/webhook/fireflies
   ```

4. Set the event type to **Transcription completed** (or equivalent)
5. Configure the same webhook signing secret you added in Step 2 (required — the bot rejects unsigned webhooks)
6. Save the webhook

### Tell Claude Code:
"I've configured the Fireflies webhook"

---

## Step 4: Verify the Integration

### What Claude Code does:
- Restarts the bot
- Confirms `isFirefliesEnabled()` returns true

### How to test:

The easiest way is to have a real meeting transcribed. If you want to test without a meeting:

1. Check that the webhook endpoint is accessible:
   ```bash
   curl -X POST https://your-domain.com/webhook/fireflies \
     -H "Content-Type: application/json" \
     -d '{"meetingId": "test-123", "eventType": "Transcription completed"}'
   ```
   You should get a `200 OK` response (the bot will try to fetch the transcript and fail gracefully since "test-123" isn't real).

2. For a real test, start a short meeting with Fireflies recording, end it, wait for transcription (~5 min), and check for the Telegram notification.

### Tell Claude Code:
"Restart the bot and verify Fireflies is enabled"

---

## What Gets Stored

### Facts (Meeting Summaries)

Each meeting creates one fact in your bot's memory:

```
Meeting: "Q1 Planning" on Feb 18, 2026.
Duration: 45m | Participants: Alice, Bob, Charlie.
Summary: Discussed product roadmap for Q1, agreed on three key initiatives...
```

Facts are searchable via the bot's semantic search — ask "What did we discuss in the Q1 planning meeting?" and it will find it.

### Goals (Action Items)

Each action item from Fireflies' AI summary becomes a trackable goal:

```
- Follow up with design team on mockups
- Send revised budget to finance by Friday
- Schedule follow-up meeting for next Tuesday
```

Goals appear in your morning briefings and can be completed via chat ("mark the mockups follow-up as done").

---

## Architecture

The webhook handler lives in `bot.ts` (local mode) and listens at `/webhook/fireflies`:

```
POST /webhook/fireflies
  │
  ├── Verify signature (REQUIRED — rejects if FIREFLIES_WEBHOOK_SECRET not set)
  │     └── HMAC SHA-256 of raw body vs x-ff-signature header
  │
  ├── Extract meetingId from webhook payload
  │
  ├── Return 200 immediately (processing happens async)
  │
  └── Background:
        ├── fetchTranscript(meetingId) — GraphQL query to Fireflies API
        ├── processTranscript(transcript) — extract summary + action items
        │     ├── addFact(summary) — store in memory
        │     └── addGoal(item) — for each action item
        └── sendMessage(notification) — notify user via Telegram
```

All processing happens in the background after returning 200 to Fireflies, so webhooks never time out.

---

## Fireflies API Details

The bot uses the [Fireflies GraphQL API](https://docs.fireflies.ai/graphql-api/query/transcript) to fetch transcripts:

```graphql
query Transcript($transcriptId: String!) {
  transcript(id: $transcriptId) {
    id
    title
    date
    duration
    participants
    summary {
      action_items
      keywords
      overview
      short_summary
    }
  }
}
```

The API endpoint is `https://api.fireflies.ai/graphql`, authenticated with `Bearer <API_KEY>`.

---

## Troubleshooting

| Problem | Solution |
|---------|----------|
| No notification after meeting | Check that the webhook URL is correct and publicly accessible. Fireflies must be able to reach your server |
| "Fireflies integration not configured" | `FIREFLIES_API_KEY` is missing from `.env`. Add it and restart |
| Webhook returns 401 | `FIREFLIES_WEBHOOK_SECRET` is missing or doesn't match what Fireflies sends. The secret is required — set it in `.env` and configure the same value in your Fireflies webhook settings |
| Transcript fetched but no action items | Fireflies' AI didn't detect any action items. This depends on the meeting content |
| Bot not reachable from internet | You need a public URL. Use a VPS with a domain, or a Cloudflare tunnel / ngrok for local development |
| "Fireflies API error: 401" | API key is invalid or expired. Get a new one from app.fireflies.ai/integrate |
| Facts/goals not appearing | Check your database connection. The bot stores data via `addFact()` and `addGoal()` from your database adapter |

---

## References

- [Fireflies.ai](https://fireflies.ai) — Meeting transcription service
- [Fireflies API Documentation](https://docs.fireflies.ai/) — GraphQL API reference
- [Fireflies Webhooks](https://docs.fireflies.ai/webhooks) — Webhook configuration
- [Fireflies Pricing](https://fireflies.ai/pricing) — Business tier required for API access
