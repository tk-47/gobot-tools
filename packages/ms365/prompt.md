# Microsoft 365 Integration Setup

Connect your Telegram bot to Outlook Calendar, Email, and Microsoft To Do via the Microsoft Graph API. Once set up, the bot can:

- Read your calendar and answer "What's on my schedule today?"
- Check your inbox and summarize unread emails
- List pending tasks from Microsoft To Do
- Create, update, and delete calendar events
- Send emails on your behalf
- Include calendar/email/task context in morning briefings

## How It Works

The bot calls the [Microsoft Graph API](https://learn.microsoft.com/en-us/graph/overview) directly using OAuth2 refresh tokens. No MCP server is required at runtime — the bot stores a refresh token and exchanges it for short-lived access tokens automatically.

There are two ways to get your initial refresh token:

- **Option A** (recommended): Use the `@softeria/ms-365-mcp-server` MCP server for interactive login, then the bot reads the cached token
- **Option B**: Register your own Azure AD app and use the device code flow manually

Both options result in the same thing: a refresh token the bot uses to call the Graph API.

---

## Prerequisites

- A Microsoft 365 account (personal or work/school)
- [Node.js](https://nodejs.org/) or [Bun](https://bun.sh/) installed
- [Claude Code](https://claude.ai/claude-code) CLI installed (for Option A)

---

## Option A: MCP Server Login (Recommended)

This is the fastest path. The [`@softeria/ms-365-mcp-server`](https://github.com/Softeria/ms-365-mcp-server) package handles Azure AD app registration for you using its built-in client ID.

### Step 1: Add the MCP Server to Claude Code

```bash
# Personal Microsoft account (Outlook.com, Hotmail, etc.)
claude mcp add ms365 -- npx -y @softeria/ms-365-mcp-server

# Work/school account (Office 365, Teams, SharePoint access)
claude mcp add ms365 -- npx -y @softeria/ms-365-mcp-server --org-mode
```

> **Windows users:** Wrap the command:
> ```bash
> claude mcp add ms365 -s user -- cmd /c "npx -y @softeria/ms-365-mcp-server --org-mode"
> ```

### Step 2: Authenticate

1. Start a new Claude Code session
2. Ask Claude to "log in to Microsoft 365" — it will call the `login` MCP tool
3. You'll get a URL and a device code. Open the URL in your browser, enter the code, and sign in
4. Grant the requested permissions (Calendar, Mail, Tasks, etc.)
5. Ask Claude to "verify login" — it calls `verify-login` to confirm

The MCP server caches your tokens at `~/.ms365-mcp/token-cache.json`. The bot reads this file directly.

### Step 3: Verify It Works

```bash
# From your bot's project directory
bun run src/tools/ms365-cli.ts events
```

You should see your upcoming calendar events. If you get an error, re-run the login step.

---

## Option B: Custom Azure AD App

Use this if you don't want to depend on the MCP server's built-in client ID, or if you need fine-grained control over permissions.

### Step 1: Register an App in Azure Portal

1. Go to [Azure Portal](https://portal.azure.com/) > **Microsoft Entra ID** > **App registrations** > **New registration**
2. Name it something like "Telegram Bot"
3. Under **Supported account types**, choose:
   - "Personal Microsoft accounts only" — for Outlook.com/Hotmail
   - "Accounts in any organizational directory and personal Microsoft accounts" — for work + personal
4. Under **Redirect URI**, select **Public client/native** and add: `https://login.microsoftonline.com/common/oauth2/nativeclient`
5. Click **Register**

### Step 2: Note Your App Details

From the app's **Overview** page, copy:
- **Application (client) ID** — this is your `MS365_CLIENT_ID`
- **Directory (tenant) ID** — this is your `MS365_TENANT_ID` (use `common` for multi-tenant)

### Step 3: Configure API Permissions

Go to **API permissions** > **Add a permission** > **Microsoft Graph** > **Delegated permissions** and add:

| Permission | What It Enables |
|------------|----------------|
| `Calendars.ReadWrite` | Read/write calendar events |
| `Mail.ReadWrite` | Read emails, send emails |
| `Mail.Send` | Send emails |
| `Tasks.ReadWrite` | Read/write Microsoft To Do tasks |
| `User.Read` | Basic profile info (required) |

Click **Grant admin consent** if you have admin rights (otherwise ask your admin).

### Step 4: Get a Refresh Token

Use the [device code flow](https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-device-code) to get your initial tokens:

```bash
# Request a device code
curl -X POST "https://login.microsoftonline.com/common/oauth2/v2.0/devicecode" \
  -d "client_id=YOUR_CLIENT_ID" \
  -d "scope=Calendars.ReadWrite Mail.ReadWrite Mail.Send Tasks.ReadWrite User.Read offline_access"
```

This returns a `user_code` and a `verification_uri`. Open the URI in your browser, enter the code, and sign in.

Then exchange the device code for tokens:

```bash
# Poll until the user completes sign-in
curl -X POST "https://login.microsoftonline.com/common/oauth2/v2.0/token" \
  -d "client_id=YOUR_CLIENT_ID" \
  -d "grant_type=urn:ietf:params:oauth:grant-type:device_code" \
  -d "device_code=THE_DEVICE_CODE_FROM_ABOVE"
```

The response includes a `refresh_token`. Save it — this is your `MS365_REFRESH_TOKEN`.

### Step 5: Add to Your `.env`

```env
MS365_CLIENT_ID=your-application-client-id
MS365_TENANT_ID=common
MS365_REFRESH_TOKEN=your-refresh-token
```

---

## Bot Configuration

### Environment Variables

Add these to your `.env` file. **You only need env vars if you're NOT using the MCP token cache** (e.g., on a VPS):

```env
# Microsoft 365 (direct Graph API)
MS365_CLIENT_ID=your-application-client-id
MS365_TENANT_ID=common
MS365_REFRESH_TOKEN=your-refresh-token
```

The bot checks for credentials in this order:
1. Environment variables (`MS365_CLIENT_ID`, `MS365_TENANT_ID`, `MS365_REFRESH_TOKEN`)
2. MCP token cache file (`~/.ms365-mcp/token-cache.json`)

If either source has valid credentials, MS365 features are automatically enabled.

### How the Bot Uses MS365 Data

The integration works through keyword detection. When a user message contains relevant keywords, the bot fetches live data from Microsoft 365 and injects it into the AI's context:

| Keywords | Data Fetched |
|----------|-------------|
| calendar, schedule, meeting, event, appointment, agenda | Calendar events for the relevant date range |
| email, mail, inbox, outlook, unread | Unread emails (last 10) |
| task, todo, deadline, overdue, planner | Pending Microsoft To Do tasks |

The bot also understands natural language dates: "What's on my calendar tomorrow?", "Show me this week's meetings", "Any events next Monday?"

### Morning Briefing

If you have scheduled morning briefings enabled, today's calendar events, unread emails, and pending tasks are automatically included in the daily summary.

---

## CLI Tool

The bot includes a standalone CLI for testing and manual operations:

```bash
# List upcoming events (default: 7 days)
bun run src/tools/ms365-cli.ts events [DAYS]

# Search events by subject
bun run src/tools/ms365-cli.ts search-events "team meeting"

# Create an event
bun run src/tools/ms365-cli.ts create-event "Lunch" "2026-03-01T12:00:00" "2026-03-01T13:00:00"

# Update an event (reschedule)
bun run src/tools/ms365-cli.ts update-event EVENT_ID "2026-03-01T14:00:00" "2026-03-01T15:00:00"

# Delete an event
bun run src/tools/ms365-cli.ts delete-event EVENT_ID

# List unread emails
bun run src/tools/ms365-cli.ts emails [COUNT]

# List pending tasks
bun run src/tools/ms365-cli.ts tasks

# Send an email
bun run src/tools/ms365-cli.ts send-email recipient@example.com "Subject" "Body text"
```

---

## VPS / Remote Server Setup

On a VPS or headless server, you can't do an interactive browser login. Instead:

1. Complete the authentication on your local machine first (Option A or B)
2. Extract the credentials you need:

   **If using Option A (MCP token cache):**
   ```bash
   # On your local machine, extract the refresh token from the cache
   cat ~/.ms365-mcp/token-cache.json | python3 -c "
   import json, sys
   cache = json.load(sys.stdin)
   rt = list(cache.get('RefreshToken', {}).values())[0]
   acct = list(cache.get('Account', {}).values())[0]
   print(f\"MS365_CLIENT_ID={rt['client_id']}\")
   print(f\"MS365_TENANT_ID={acct['realm']}\")
   print(f\"MS365_REFRESH_TOKEN={rt['secret']}\")
   "
   ```

   **If using Option B (custom app):** You already have the values from Step 5.

3. Add the three env vars to your VPS `.env` file
4. Restart the bot — it will use the env vars for authentication

> **Token refresh:** The refresh token is long-lived but can expire if unused for 90+ days. If the bot starts getting 401 errors, re-authenticate on your local machine and update the VPS env vars.

---

## Troubleshooting

**"MS365 token refresh failed: 400"**
- The refresh token has expired. Re-authenticate using Option A or B and update your credentials.

**Calendar events show wrong times**
- Set `USER_TIMEZONE` in your `.env` to your IANA timezone (e.g., `America/New_York`, `Europe/London`). The bot uses this for all time formatting.

**No data returned but no errors**
- Check that the Azure AD app has the correct API permissions and that admin consent was granted.
- For work accounts, your IT admin may need to approve the app.

**"isMs365Enabled() returns false"**
- Verify that either the env vars are set OR the token cache file exists at `~/.ms365-mcp/token-cache.json`.

**MCP login tool not appearing in Claude Code**
- Run `claude mcp list` to verify the ms365 server is connected.
- If it shows an error, try: `claude mcp remove ms365` then re-add it.

---

## Architecture

```
User message: "What's on my calendar today?"
  │
  ├── bot.ts detects "calendar" keyword
  │     └── calls getCalendarEvents() from src/lib/ms365.ts
  │           └── exchanges refresh token for access token
  │           └── GET https://graph.microsoft.com/v1.0/me/calendarView
  │           └── returns formatted event list
  │
  └── Event data injected into Claude's context as:
        "## OUTLOOK CALENDAR (today — use this data)
         - 9:00 AM-10:00 AM: Team Standup (Zoom)
         - 12:00 PM-1:00 PM: Lunch with Sarah (Downtown Cafe)"
```

The bot makes direct HTTP calls to the Graph API — no MCP server, no SDK dependency, no subprocess overhead. Token refresh is automatic with retry on 401.

---

## References

- [Microsoft Graph API Documentation](https://learn.microsoft.com/en-us/graph/overview)
- [Azure AD App Registration Guide](https://learn.microsoft.com/en-us/entra/identity-platform/quickstart-register-app)
- [@softeria/ms-365-mcp-server](https://github.com/Softeria/ms-365-mcp-server) — MCP server used for initial authentication
- [Device Code Flow](https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-device-code) — Manual OAuth method
