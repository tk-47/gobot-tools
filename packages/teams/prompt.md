# Microsoft Teams Integration

> **For Claude Code:** Drop this file into your project root or paste it into a Claude Code session. Claude will walk you through each step interactively. When you're ready, say: **"Set up Teams integration"**

Add Microsoft Teams as a second messaging platform for your bot. Once set up:

- Send messages to your bot from Teams (desktop, web, or mobile)
- Conversations are synchronized — messages from Telegram and Teams share the same history
- Claude sees full context regardless of which platform you sent from
- Human-in-the-loop via Adaptive Cards with clickable buttons
- Same hybrid routing: VPS always on, forwards to local Mac when awake

---

## How It Works

The bot registers as an Azure Bot and receives messages via the Bot Framework webhook. No `botbuilder` SDK — just direct REST API calls with lightweight JWT verification.

```
Teams Desktop/Web/Mobile
  │
  ├── User sends message
  │     └── Microsoft Bot Framework
  │           └── POST https://vps.claudebot.uk/api/messages
  │                 └── JWT verified against Microsoft's JWKS
  │                 └── User authorized via AAD Object ID
  │
  ├── VPS processes message (hybrid routing):
  │     ├── Mac online  → forward to local /process-teams
  │     └── Mac offline → process with Anthropic API
  │
  └── Reply sent via Bot Framework REST API
        └── POST {serviceUrl}/v3/conversations/{id}/activities
```

Messages are saved to the same conversation database as Telegram, using the same canonical `chatId`. Each message has `metadata.source: "teams"` or `"telegram"` for traceability.

### Human-in-the-Loop

When Claude needs confirmation (tool calls, decisions), it sends an **Adaptive Card** with clickable buttons instead of Telegram's inline keyboard. Button clicks map to the same `handleTaskCallback()` flow — the task queue is platform-agnostic.

---

## Prerequisites

- An **Azure account** with access to create resources (free tier works)
- A **Microsoft 365 tenant** (work/school account, or a developer tenant)
- Your bot already running with VPS deployment
- [Bun](https://bun.sh/) runtime installed

---

## Step 1: Create an Azure Bot Resource

### What you need to do:

1. Go to [portal.azure.com](https://portal.azure.com)
2. Search for **"Azure Bot"** and click **Create**
3. Fill in the form:
   - **Bot handle**: your bot's name (e.g., `claudebot`)
   - **Subscription**: your Azure subscription
   - **Resource group**: create new or use existing
   - **Pricing tier**: F0 (free)
   - **Type of App**: **Single Tenant**
   - **Creation type**: **Create new Microsoft App ID**
4. Click **Review + Create** → **Create**
5. Wait for deployment to complete, then go to the resource

### What you need from this step:
- **App ID** (also called Microsoft App ID) — shown on the Bot resource's Configuration page
- **Tenant ID** — shown on the Bot resource's Configuration page, or in Azure Active Directory > Overview

---

## Step 2: Create a Client Secret

### What you need to do:

1. From the Azure Bot resource, click **Configuration**
2. Next to "Microsoft App ID", click **Manage Password**
   - This opens the App Registration in Azure Active Directory
3. Go to **Certificates & secrets** → **Client secrets**
4. Click **New client secret**
5. Give it a description (e.g., "Bot Framework") and set expiry
6. Copy the **Value** immediately — you won't see it again

### Tell Claude Code:
"Here are my Teams credentials: App ID=[APP_ID], Password=[SECRET], Tenant ID=[TENANT_ID]"

---

## Step 3: Set the Messaging Endpoint

### What you need to do:

1. In the Azure Bot resource, go to **Configuration**
2. Set **Messaging endpoint** to:
   ```
   https://your-vps-domain.example.com/api/messages
   ```
   Replace with your actual VPS domain (e.g., `https://vps.claudebot.uk/api/messages`)
3. Click **Apply**

---

## Step 4: Enable the Teams Channel

### What you need to do:

1. In the Azure Bot resource, go to **Channels**
2. Click **Microsoft Teams**
3. Accept the terms of service
4. Click **Apply**

### Tell Claude Code:
"Messaging endpoint and Teams channel are configured"

---

## Step 5: Get Your AAD Object ID

Your AAD Object ID is used to restrict the bot to only respond to you (same as `TELEGRAM_USER_ID` for Telegram).

### What you need to do:

**Option A — Azure Portal:**
1. Go to **Azure Active Directory** > **Users**
2. Find your user account
3. Copy the **Object ID** field

**Option B — Microsoft Graph Explorer:**
1. Go to [developer.microsoft.com/graph/graph-explorer](https://developer.microsoft.com/en-us/graph/graph-explorer)
2. Sign in and run: `GET https://graph.microsoft.com/v1.0/me`
3. Look for the `"id"` field in the response

### Tell Claude Code:
"My AAD Object ID is [ID]"

---

## Step 6: Add Environment Variables

### What Claude Code does:

Adds these to your `.env` file (both local and VPS):

```env
# Microsoft Teams
TEAMS_APP_ID=your-azure-bot-app-id
TEAMS_APP_PASSWORD=your-client-secret
TEAMS_ALLOWED_USER_ID=your-aad-object-id
TEAMS_TENANT_ID=your-azure-tenant-id
```

### Tell Claude Code:
"Add the Teams credentials to .env"

---

## Step 7: Install Dependencies

### What Claude Code does:

Installs the `jose` package for JWT verification:

```bash
bun add jose
```

This is a lightweight JWT/JWK library that uses Web Crypto (Bun-native). No Express, no botbuilder SDK.

---

## Step 8: Verify Connectivity

### What Claude Code does:

Runs the connectivity test:

```bash
bun run setup/test-teams.ts
```

This verifies:
1. Environment variables are set
2. OAuth token can be obtained from Azure AD
3. Reports the messaging endpoint for verification

### Tell Claude Code:
"Run the Teams connectivity test"

---

## Step 9: Deploy to VPS

### What you need to do:

Add the same four `TEAMS_*` env vars to your VPS `.env` file, then restart the bot.

### What Claude Code does:
- Deploys updated code to VPS (via git push or SCP)
- Installs `jose` on VPS (`bun install`)
- Restarts PM2
- Verifies the startup log shows: `Teams: /api/messages [configured]`

### Tell Claude Code:
"Deploy Teams to VPS"

---

## Step 10: Create the Teams App Package

### What Claude Code does:

The Teams app manifest is in `teams-manifest/`:

```
teams-manifest/
  manifest.json    # App manifest (bot ID, scopes, commands)
  color.png        # App icon (192x192)
  outline.png      # App outline icon (32x32)
```

Package it as a zip:

```bash
cd teams-manifest && zip -r ../go-teams.zip *
```

### What you need to do:

1. Open Microsoft Teams
2. Go to **Apps** → **Manage your apps** → **Upload an app**
3. Choose **Upload a custom app** (or **Upload an app to your org's app catalog**)
4. Select the `go-teams.zip` file
5. Click **Add** to install the bot in your personal scope

> **Note:** If custom app uploads are blocked, your Teams admin needs to enable them:
> - Teams Admin Center → **Setup policies** → Enable "Upload custom apps"
> - Teams Admin Center → **Permission policies** → Allow custom apps

### Tell Claude Code:
"The app is installed in Teams"

---

## Step 11: Test End-to-End

### How to test: (AFTER restarting the bot from Claude Code)

1. **Basic message:** Open the bot chat in Teams and send "Hello"
   - Bot should respond within a few seconds
2. **Weather:** Send "What's the weather?" (if Tempest is configured)
3. **Cross-platform:** Send a message on Telegram, then ask about it on Teams
   - Claude should have context from both platforms
4. **Human-in-the-loop:** Trigger a task that requires confirmation
   - An Adaptive Card with buttons should appear

### Tell Claude Code:
"Test the Teams integration"

---

## Architecture

### New Files

| File | Purpose |
|------|---------|
| `src/lib/platform.ts` | `PlatformContext` interface — abstracts Telegram/Teams |
| `src/lib/telegram-platform.ts` | Wraps Grammy `Context` into `PlatformContext` |
| `src/lib/teams-platform.ts` | Wraps Bot Framework Activity into `PlatformContext` |
| `src/lib/teams-auth.ts` | JWT verification (inbound) + OAuth tokens (outbound) |
| `src/lib/teams.ts` | Send messages, Adaptive Cards, typing indicators |
| `teams-manifest/` | Teams app package (manifest + icons) |
| `setup/test-teams.ts` | Connectivity test script |

### Modified Files

| File | Changes |
|------|---------|
| `src/bot.ts` | Added `/api/messages` and `/process-teams` endpoints |
| `src/vps-gateway.ts` | Added `/api/messages` endpoint with hybrid routing |
| `src/lib/anthropic-processor.ts` | Uses `PlatformContext` instead of Grammy `Context` |
| `src/lib/task-queue.ts` | Platform-agnostic task choices |

### PlatformContext Interface

The key abstraction that makes both platforms work:

```typescript
interface PlatformContext {
  platform: "telegram" | "teams";
  chatId: string;
  sendText(text: string): Promise<void>;
  sendFormatted(text: string): Promise<void>;
  sendTyping(): Promise<void>;
  sendChoices(question: string, options: {label, value}[], taskId: string): Promise<void>;
  editMessage?(messageId: string, text: string): Promise<void>;
}
```

All core processing functions (`callClaude`, `processWithAnthropic`, task queue) accept `PlatformContext`. Telegram gets a `TelegramPlatformContext` wrapper, Teams gets a `TeamsPlatformContext` wrapper.

### Security

| Layer | Protection |
|-------|-----------|
| **Inbound webhook** | JWT verified against Microsoft's published OpenID keys (JWKS) |
| **User authorization** | `TEAMS_ALLOWED_USER_ID` checked on every Activity |
| **VPS forwarding** | `/process-teams` uses `GATEWAY_SECRET` bearer token |
| **Outbound tokens** | OAuth2 client_credentials, cached in memory with expiry |

---

## VPS Endpoints

After setup, your VPS serves these Teams-related endpoints:

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/messages` | POST | Bot Framework webhook (receives all Teams messages) |
| `/process-teams` | POST | Local Mac endpoint for VPS hybrid forwarding |

These are in addition to existing endpoints (`/telegram`, `/health`, `/process`, etc.).

---

## Customization

### Bot Name and Commands

Edit `teams-manifest/manifest.json` to change the bot's display name, description, and command list:

```json
{
  "name": {
    "short": "Go",
    "full": "Go - Personal AI Assistant"
  },
  "bots": [{
    "commandLists": [{
      "commands": [
        { "title": "goals", "description": "Show active goals" },
        { "title": "weather", "description": "Current weather" }
      ]
    }]
  }]
}
```

After editing, re-package the zip and re-upload to Teams.

### Markdown Formatting

Teams supports a subset of markdown. The `sanitizeForTeams()` function in `src/lib/teams.ts` handles conversion:
- Bold (`**text**`) — works as-is
- Italic (`_text_` → `*text*`) — converted from Telegram style
- Image tags (`[IMAGE:...]`) — removed
- Excess newlines — collapsed

---

## Troubleshooting

| Problem | Solution |
|---------|----------|
| "Teams: /api/messages [not configured]" in startup log | `TEAMS_APP_ID` or `TEAMS_APP_PASSWORD` not set in `.env` |
| OAuth token error (AADSTS700016) | Wrong tenant endpoint — ensure `TEAMS_TENANT_ID` is set for single-tenant bots |
| OAuth token error (AADSTS500011) | Scope misconfiguration — must use `https://api.botframework.com/.default` |
| 400 "Activity.From field required" | Outbound activities must include `from: { id: appId }` |
| 401/403 on send | Clear cached token and retry — may be a stale token from a previous scope |
| "Bot is not installed in user's personal scope" | Sideload the Teams app package (Step 10) |
| App blocked in Teams Admin Center | Enable custom app uploads in Setup policies and Permission policies |
| "You do not have permission to use this app" | Check both Setup and Permission policies allow the app for your user |
| Bot receives messages but doesn't reply | Check VPS error logs: `pm2 logs go-bot --lines 50` |
| Messages not syncing across platforms | Verify both platforms use the same `TELEGRAM_USER_ID` as canonical `chatId` |

---

## How Single-Tenant Auth Works

Single-tenant Azure Bots use a specific authentication flow:

**Inbound (verifying Microsoft's webhook):**
1. Microsoft sends an `Authorization: Bearer <JWT>` header with each webhook request
2. The bot fetches Microsoft's public signing keys from their OpenID metadata endpoint
3. JWT is verified using the `jose` library against those keys
4. Token audience must match the bot's App ID
5. Issuer is checked against known Microsoft issuers + the tenant-specific issuer

**Outbound (sending replies):**
1. Bot requests a token from `https://login.microsoftonline.com/{tenantId}/oauth2/v2.0/token`
2. Uses `client_credentials` grant with App ID + App Password
3. Scope: `https://api.botframework.com/.default`
4. Token is cached in memory with 5-minute expiry buffer
5. Token is included as `Authorization: Bearer <token>` in Bot Framework REST API calls

---

## References

- [Azure Bot Service Documentation](https://learn.microsoft.com/en-us/azure/bot-service/) — Official docs
- [Bot Framework REST API](https://learn.microsoft.com/en-us/azure/bot-service/rest-api/bot-framework-rest-connector-api-reference) — Activity types, endpoints
- [Adaptive Cards](https://adaptivecards.io/) — Card schema and designer
- [jose (npm)](https://github.com/panva/jose) — JWT/JWK library used for token verification
- [Teams App Manifest Schema](https://learn.microsoft.com/en-us/microsoftteams/platform/resources/schema/manifest-schema) — Manifest reference


