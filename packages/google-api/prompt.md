# Google Calendar & Sheets Integration (Direct API)

> **For Claude Code:** Drop this file into your project root or paste it into a Claude Code session. Claude will walk you through each step interactively. When you're ready, say: **"Set up Google Calendar and Sheets integration"**

Connect your Telegram bot to Google Calendar and Google Sheets using lightweight Python CLI scripts and a TypeScript client. Once set up, the bot can:

- Read and create Google Calendar events
- Read, write, and append to Google Sheets
- Create new spreadsheets
- Search your Drive for spreadsheets by name
- Use calendar/sheets data in morning briefings and scheduled services

---

## Why Direct API Instead of MCP?

Google offers an MCP server ([workspace-mcp](https://github.com/mcp-mirror/ergut_workspace-mcp)), but it has a persistent auth bug: the MCP server demands re-authentication on every request even when the token file is valid and fresh. Direct Python/TypeScript scripts using the same token file work perfectly.

**Direct API advantages:**
- No MCP server startup overhead (60-180s saved per Claude subprocess)
- Works reliably — no session/context auth bugs
- Same credential file used by both Python scripts and the TypeScript bot
- Python scripts can be called from Claude Code, cron jobs, or shell scripts
- TypeScript client (`src/lib/sheets.ts`) works in the bot's runtime for programmatic access

---

## Architecture

```
┌──────────────────────────────────────────────────┐
│  Credential file                                  │
│  ~/.google_workspace_mcp/credentials/user.json    │
│  (client_id, client_secret, refresh_token)        │
└──────────┬──────────────────────┬─────────────────┘
           │                      │
    ┌──────▼──────┐       ┌──────▼──────┐
    │ Python CLI  │       │ TypeScript  │
    │ gcal.py     │       │ sheets.ts   │
    │ gsheet.py   │       │ (bot runtime)│
    └──────┬──────┘       └──────┬──────┘
           │                      │
    ┌──────▼──────────────────────▼──────┐
    │ Google APIs (OAuth2 refresh flow)  │
    │ calendar.googleapis.com            │
    │ sheets.googleapis.com              │
    │ drive.googleapis.com               │
    └────────────────────────────────────┘
```

Both layers read from the same credential file. Tokens auto-refresh when expired.

---

## Prerequisites

- A Google account
- Python 3.8+ with pip
- [Bun](https://bun.sh/) runtime installed

---

## Step 1: Create a Google Cloud Project

### What you need to do:

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Click **Select a project** > **New Project**
3. Name it (e.g., "Telegram Bot") and click **Create**
4. Make sure the new project is selected in the top dropdown

### Tell Claude Code:
"I've created a Google Cloud project"

---

## Step 2: Enable the APIs

### What you need to do:

1. Go to **APIs & Services** > **Library** (or [direct link](https://console.cloud.google.com/apis/library))
2. Search for and enable each of these:
   - **Google Calendar API**
   - **Google Sheets API**
   - **Google Drive API**

### Tell Claude Code:
"I've enabled the Calendar, Sheets, and Drive APIs"

---

## Step 3: Create OAuth Credentials

### What you need to do:

1. Go to **APIs & Services** > **Credentials** (or [direct link](https://console.cloud.google.com/apis/credentials))
2. Click **+ CREATE CREDENTIALS** > **OAuth client ID**
3. If prompted, configure the **OAuth consent screen** first:
   - Choose **External** (unless you have Google Workspace)
   - App name: anything (e.g., "Telegram Bot")
   - User support email: your email
   - Developer contact: your email
   - Click through the rest and **Save**
   - Under **Test users**, add your own Gmail address
4. Back in Credentials, click **+ CREATE CREDENTIALS** > **OAuth client ID**
5. Application type: **Desktop app**
6. Name: anything (e.g., "Desktop Client")
7. Click **Create**
8. **Download the JSON file** — this contains your `client_id` and `client_secret`

### Tell Claude Code:
"Here's my OAuth client ID: [CLIENT_ID] and client secret: [CLIENT_SECRET]"

---

## Step 4: Get a Refresh Token

### What Claude Code does:
- Runs a one-time Python script to perform the OAuth consent flow
- Opens your browser to authorize the app
- Saves the credential file with the refresh token

### Install Python dependencies:
```bash
pip install google-auth google-auth-oauthlib google-api-python-client
```

### Run the authorization flow:

Create and run this one-time script:

```python
#!/usr/bin/env python3
"""One-time OAuth2 authorization to get a refresh token."""
import json
from pathlib import Path
from google_auth_oauthlib.flow import InstalledAppFlow

SCOPES = [
    "https://www.googleapis.com/auth/calendar",
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/drive.readonly",
    "https://www.googleapis.com/auth/drive.file",
]

# Replace with your credentials from Step 3
CLIENT_CONFIG = {
    "installed": {
        "client_id": "YOUR_CLIENT_ID.apps.googleusercontent.com",
        "client_secret": "YOUR_CLIENT_SECRET",
        "auth_uri": "https://accounts.google.com/o/oauth2/auth",
        "token_uri": "https://oauth2.googleapis.com/token",
        "redirect_uris": ["http://localhost"],
    }
}

flow = InstalledAppFlow.from_client_config(CLIENT_CONFIG, SCOPES)
creds = flow.run_local_server(port=0)

# Save credentials
creds_dir = Path.home() / ".google_workspace_mcp" / "credentials"
creds_dir.mkdir(parents=True, exist_ok=True)
cred_path = creds_dir / "credentials.json"

cred_data = {
    "token": creds.token,
    "refresh_token": creds.refresh_token,
    "token_uri": creds.token_uri,
    "client_id": creds.client_id,
    "client_secret": creds.client_secret,
    "scopes": list(creds.scopes) if creds.scopes else SCOPES,
    "expiry": creds.expiry.isoformat() if creds.expiry else None,
}

with open(cred_path, "w") as f:
    json.dump(cred_data, f, indent=2)

print(f"Credentials saved to {cred_path}")
print("You can now use gcal.py and gsheet.py.")
```

This opens your browser. Sign in with your Google account, grant access, and the credentials are saved.

### Tell Claude Code:
"Run the Google OAuth authorization flow"

---

## Step 5: Install the Python Scripts

### What Claude Code does:
- Copies `gcal.py` and `gsheet.py` to a stable location (e.g., `~/.claude/scripts/`)

Both scripts share the same credential loading pattern:
1. Find the first `.json` file in `~/.google_workspace_mcp/credentials/`
2. Load the refresh token
3. Auto-refresh if expired (and save the updated token back)

### Tell Claude Code:
"Install the Google API scripts"

---

## Step 6: Verify the Connection

### Test Calendar:
```bash
python3 ~/.claude/scripts/gcal.py list
```

You should see your upcoming calendar events.

### Test Sheets:
```bash
# List your spreadsheets
python3 ~/.claude/scripts/gsheet.py list

# Read a specific sheet (use the spreadsheet ID from the URL)
python3 ~/.claude/scripts/gsheet.py read YOUR_SPREADSHEET_ID
```

### Tell Claude Code:
"Test the Google Calendar and Sheets connection"

---

## CLI Reference

### gcal.py — Google Calendar

```bash
# List upcoming events (default: 7 days)
python3 gcal.py list [DAYS]

# Create an event
python3 gcal.py create "Meeting" "2026-03-01T10:00:00" "2026-03-01T11:00:00" "Optional description"

# Delete an event by ID
python3 gcal.py delete EVENT_ID

# Search events by text (default: next 30 days)
python3 gcal.py search "dentist" [DAYS]
```

### gsheet.py — Google Sheets

```bash
# Read a sheet (default range: A1:Z1000)
python3 gsheet.py read SPREADSHEET_ID [RANGE]

# Overwrite a range
python3 gsheet.py write SPREADSHEET_ID "Sheet1!A1:B2" '[["Name","Score"],["Alice","95"]]'

# Append rows after existing data
python3 gsheet.py append SPREADSHEET_ID "Sheet1!A:B" '[["Bob","88"]]'

# Create a new spreadsheet (with optional tab names)
python3 gsheet.py create "My Spreadsheet" "Tab1,Tab2,Tab3"

# Get spreadsheet metadata
python3 gsheet.py info SPREADSHEET_ID

# Search Drive for spreadsheets by name
python3 gsheet.py list "budget"
```

---

## Bot Integration (TypeScript)

The bot also has a TypeScript client (`src/lib/sheets.ts`) for runtime access — used by scheduled services like morning briefings that need to read spreadsheet data without spawning a Python process.

It reads the same credential file (`~/.google_workspace_mcp/credentials/*.json`) or env vars for VPS mode.

### Available functions:

```typescript
import { readRange, appendRows, updateRange, createSpreadsheet, isSheetsEnabled } from "./lib/sheets";

// Check if configured
if (isSheetsEnabled()) {
  // Read
  const data = await readRange("SPREADSHEET_ID", "Sheet1!A1:B10");

  // Append rows
  await appendRows("SPREADSHEET_ID", "Sheet1!A:B", [["Alice", "95"]]);

  // Overwrite range
  await updateRange("SPREADSHEET_ID", "Sheet1!A2:B2", [["Bob", "88"]]);

  // Create new spreadsheet
  const sheet = await createSpreadsheet("My Sheet", ["Tab1", "Tab2"]);
}
```

---

## VPS / Remote Server Setup

On a VPS, you can't do the browser-based OAuth flow. Extract credentials from your local machine:

### Extract from local credential file:

```bash
python3 -c "
import json
from pathlib import Path

creds_dir = Path.home() / '.google_workspace_mcp' / 'credentials'
cred_file = sorted(creds_dir.glob('*.json'))[0]
data = json.load(open(cred_file))

print(f\"GOOGLE_SHEETS_CLIENT_ID={data['client_id']}\")
print(f\"GOOGLE_SHEETS_CLIENT_SECRET={data['client_secret']}\")
print(f\"GOOGLE_SHEETS_REFRESH_TOKEN={data['refresh_token']}\")
"
```

### Add to VPS `.env`:

```env
GOOGLE_SHEETS_CLIENT_ID=your-client-id.apps.googleusercontent.com
GOOGLE_SHEETS_CLIENT_SECRET=your-client-secret
GOOGLE_SHEETS_REFRESH_TOKEN=your-refresh-token
```

The TypeScript client (`sheets.ts`) checks env vars first, then falls back to the credential file. The Python scripts only read the credential file — for VPS use with Python, copy the credential file instead.

---

## Scopes Reference

| Scope | What It Enables |
|-------|----------------|
| `calendar` | Full read/write access to Google Calendar |
| `spreadsheets` | Full read/write access to Google Sheets |
| `drive.readonly` | Read-only access to Drive (for listing spreadsheets) |
| `drive.file` | Access to files created by the app |

You can add or remove scopes in the authorization script. If you change scopes, delete the credential file and re-run the auth flow.

---

## Troubleshooting

| Problem | Solution |
|---------|----------|
| "No credential files found" | Run the OAuth authorization flow (Step 4) |
| "Credentials invalid and cannot refresh" | Refresh token expired or revoked. Delete the credential file and re-authorize |
| "Access Not Configured" or 403 | The API isn't enabled. Go to Google Cloud Console > APIs & Services > Library and enable it |
| "This app isn't verified" warning | Expected for personal projects. Click **Advanced** > **Go to [app name]** to proceed |
| "Error 403: access_denied" | You need to add your email as a test user in the OAuth consent screen |
| Python `ModuleNotFoundError` | Run `pip install google-auth google-auth-oauthlib google-api-python-client` |
| Sheets works but Calendar doesn't | You may need to add the `calendar` scope. Delete credentials and re-authorize with all scopes |
| Token file exists but still fails | The token may have been revoked in Google Account settings. Re-authorize |

---

## Security Notes

- The credential file (`~/.google_workspace_mcp/credentials/*.json`) contains your OAuth tokens. Keep it private.
- Never commit credential files to git. Add the path to `.gitignore`.
- The refresh token is long-lived but can be revoked at [myaccount.google.com/permissions](https://myaccount.google.com/permissions).
- For VPS deployment, use env vars rather than copying the credential file — env vars are easier to rotate and don't persist on disk.

---

## References

- [Google Calendar API](https://developers.google.com/calendar/api/v3/reference)
- [Google Sheets API](https://developers.google.com/sheets/api/reference/rest)
- [Google Drive API](https://developers.google.com/drive/api/reference/rest/v3)
- [OAuth 2.0 for Desktop Apps](https://developers.google.com/identity/protocols/oauth2/native-app)
- [Google Cloud Console](https://console.cloud.google.com/)
