# Voice Interface Setup — Telegram Voice Notes + Web Real-Time Voice

> **For Claude Code:** Drop this file into your project root or paste it into a Claude Code session. Claude will walk you through each step interactively. When you're ready, say: **"Set up voice interface"**

Add two voice interfaces to your Claudebot:

1. **Telegram Voice Notes** — Send a voice message, get a voice reply back. Uses Google Gemini for transcription and Speaktor for text-to-speech.
2. **Web Real-Time Voice** — A push-to-talk web interface accessible over Tailscale. Each board agent has a distinct voice. Uses the browser's built-in speech recognition and OpenAI TTS for audio output.

---

## How It Works

### Telegram Voice Notes

```
User sends voice message on Telegram
  │
  └── VPS Gateway (vps-gateway.ts)
        ├── Gemini 2.5 Flash — transcribes audio to text
        ├── Anthropic API — processes query with agent routing
        └── Speaktor — converts response to voice audio
              └── Voice reply sent back to user on Telegram
```

Voice messages are always processed on the VPS via the Anthropic API (not forwarded to the local Mac). This ensures the full transcription → processing → TTS pipeline stays in one place.

If transcription fails, the bot sends a short text-only reply — no Claude processing, no TTS. This prevents wasting TTS credits on error messages.

### Web Real-Time Voice

```
Browser (any Tailscale device)          Mac Mini (bot server, port 3000)
┌───────────────────────────┐          ┌──────────────────────────────┐
│ Microphone                │          │ Bun.serve                    │
│   └── Web Speech API      │──WebSocket──▶ /voice (WebSocket)       │
│       (local STT, free)   │          │     │                       │
│                           │          │     ├── Claude Code CLI      │
│ Speaker                   │          │     │   (agent routing)      │
│   └── AudioContext         │◀──WebSocket── │                       │
│       (plays PCM audio)   │          │     └── OpenAI TTS stream    │
│                           │          │        gpt-4o-mini-tts       │
│ Agent selector bar        │          │        (per-agent voice)     │
│ Conversation transcript   │          │                              │
└───────────────────────────┘          └──────────────────────────────┘
```

The web interface is served at `GET /voice` on the bot's existing HTTP server. WebSocket connections upgrade at `/voice?token=SECRET`. No additional ports, no additional servers.

Your spoken words are transcribed entirely on-device by the browser's Web Speech API (Chrome/Edge). Only the resulting text is sent to the server. Audio replies stream back as raw PCM and play through the browser's AudioContext.

---

## Per-Agent Voice Mapping

Each board agent has a distinct OpenAI voice and personality instruction for the web interface:

| Agent | OpenAI Voice | Personality | Speaktor (Telegram) |
|-------|-------------|-------------|---------------------|
| General | coral | Warm, conversational, and clear | Davis (default) |
| Research | echo | Measured, analytical, and thoughtful | (default) |
| Finance | onyx | Authoritative, precise, and no-nonsense | (default) |
| Strategy | fable | Confident, warm, and visionary | (default) |
| Content | nova | Energetic, enthusiastic, and creative | (default) |
| Legal | sage | Calm, formal, and deliberate | (default) |
| Health | shimmer | Caring, gentle, and reassuring | (default) |
| Critic | ash | Direct, sharp, and challenging | (default) |

The voice configuration lives in each agent's config file as a `voice` property on `AgentConfig`. The web interface uses the OpenAI voice + instructions. Telegram uses the Speaktor voice (currently one global voice for all agents; per-agent Speaktor voices are a future enhancement).

---

## Estimated Monthly Cost

**Assumptions:** 10 voice messages per day, average response length 250 characters, 30 days/month.

### Telegram Voice Notes

| Service | Per-Message Cost | Monthly (300 msgs) | Notes |
|---------|-----------------|---------------------|-------|
| Google Gemini (STT) | Free | $0.00 | Free tier handles typical personal use |
| Anthropic API (processing) | ~$0.01 | ~$3.00 | Sonnet-class model, ~2K input / 200 output tokens |
| Speaktor Pro (TTS) | ~$0.017 | $4.99 (fixed) | 90 min/month plan. At ~20s per reply, 300 msgs = ~100 min — close to the cap. Upgrade to the next tier if you regularly exceed 10 voice msgs/day |
| **Subtotal** | | **~$7.99/mo** | |

### Web Real-Time Voice

| Service | Per-Message Cost | Monthly (300 msgs) | Notes |
|---------|-----------------|---------------------|-------|
| Browser Web Speech API (STT) | Free | $0.00 | Runs entirely on-device in Chrome/Edge |
| Claude Code CLI (processing) | Free | $0.00 | Included in Claude subscription |
| OpenAI TTS (audio output) | ~$0.00015 | ~$0.05 | $0.60 per 1M characters × 250 chars |
| **Subtotal** | | **~$0.05/mo** | |

### Combined Total: ~$8.04/month

Speaktor Pro ($4.99/mo for 90 minutes) is the largest line item. At 10 Telegram voice messages per day with ~250-character responses (~20 seconds of audio each), you'll use roughly 100 minutes/month — close to the 90-minute cap. If you regularly exceed that, upgrade to the next Speaktor tier or shift more voice usage to the web interface, which uses OpenAI TTS at a fraction of the cost.

The web voice path is nearly free because it uses the Claude subscription (no per-token cost) and OpenAI TTS is extremely cheap at this volume. The Telegram path costs more because the VPS uses the Anthropic API directly (pay-per-token) plus the fixed Speaktor subscription.

---

## Data Sent to Each Vendor

| Vendor | What They Receive | When | Purpose |
|--------|------------------|------|---------|
| **Google (Gemini API)** | Your voice audio (the raw `.ogg` file from Telegram) | Telegram voice notes only | Transcribes speech to text. Audio is sent to `generativelanguage.googleapis.com`. Google's [API data usage policy](https://ai.google.dev/terms) applies. |
| **Anthropic** | Your transcribed text + conversation context + memory | Telegram voice notes (via API on VPS) | Processes your query and generates a response. Same data as any text message to the bot. |
| **Anthropic (via Claude Code CLI)** | Your transcribed text + conversation context + memory | Web voice only (via CLI on local Mac) | Same processing as above, but through the CLI subscription instead of direct API. |
| **OpenAI** | Claude's response text + a short voice personality instruction (e.g., "Caring, gentle, and reassuring") | Web voice only | Converts response text to spoken audio via `gpt-4o-mini-tts`. They see the reply text and the agent's voice instruction — not your original question. |
| **Speaktor** | Claude's response text | Telegram voice notes only | Converts response text to a voice audio file. They see the reply — not your original message. |
| **Telegram** | Voice audio files (your message) + voice/text replies (bot's response) | Telegram voice notes | Standard Telegram message delivery. |
| **Browser (Chrome/Edge)** | Your microphone audio | Web voice only | Processed entirely on-device by the Web Speech API. No audio data leaves your machine — only the resulting text is sent to your server over WebSocket. |
| **Tailscale** | Encrypted tunnel metadata (IP addresses, connection timestamps) | Web voice only | Routes traffic between your devices via WireGuard. Message content is end-to-end encrypted — Tailscale cannot read it. |

**Key privacy points:**
- On the web voice path, your spoken words never leave your device — Chrome transcribes locally
- OpenAI only sees the bot's response text, not your original question
- The WebSocket connection between your browser and bot server travels over Tailscale's encrypted WireGuard tunnel
- No vendor sees the complete round-trip (your question + the response) except Anthropic (which processes the query)

---

## Prerequisites

- [Bun](https://bun.sh/) runtime installed
- [Chrome](https://www.google.com/chrome/) or [Edge](https://www.microsoft.com/edge) browser (for Web Speech API)
- [Tailscale](https://tailscale.com/) installed on your Mac and at least one other device (for web voice access)
- A [Speaktor](https://speaktor.com/) account with API access (for Telegram voice replies)
- A [Google Cloud](https://console.cloud.google.com/) project with the Gemini API enabled (for Telegram voice transcription)

**Optional but recommended:**
- An [OpenAI](https://platform.openai.com/) API key (for web voice TTS — without this, the web interface works but replies are text-only)

---

## Step 1: Set Up Environment Variables

### What you need:

```env
# Telegram Voice Notes
GEMINI_API_KEY=your-gemini-api-key
SPEAKTOR_API_KEY=your-speaktor-api-key
SPEAKTOR_VOICE_NAME=Davis

# Web Voice Interface
OPENAI_API_KEY=sk-your-openai-api-key
VOICE_WEB_TOKEN=a-random-secret-string-for-ws-auth
```

**Generate the WebSocket auth token** — any random string works. This prevents unauthorized access to the voice endpoint even on your Tailscale network:

```bash
openssl rand -hex 24
```

### What Claude Code does:
- Adds these variables to your `.env` file
- Adds placeholders to `.env.example`

### Tell Claude Code:
"Here are my API keys: Gemini=[KEY], Speaktor=[KEY], OpenAI=[KEY]"

---

## Step 2: Add Voice Config to Agents

### What Claude Code does:
- Adds `VoiceConfig` interface to `src/agents/base.ts`
- Adds `voice` field to `AgentConfig` interface
- Adds voice configuration to each agent file (general, research, content, finance, strategy, legal, health, critic)

The `VoiceConfig` structure:

```typescript
export interface VoiceConfig {
  openai: string;                // OpenAI voice ID
  openaiInstructions?: string;   // Tone/personality for gpt-4o-mini-tts
  speaktor?: string;             // Speaktor voice name override
}
```

### Tell Claude Code:
"Add per-agent voice configurations"

---

## Step 3: Create the OpenAI TTS Client

### What Claude Code does:
- Creates `src/lib/openai-tts.ts` — streaming TTS client for the web interface

Exports:

| Function | Purpose |
|----------|---------|
| `isOpenAITTSEnabled()` | Check if `OPENAI_API_KEY` is set |
| `streamTTS(text, voice, instructions?)` | Stream PCM audio chunks from `gpt-4o-mini-tts` |
| `generateTTS(text, voice, instructions?)` | Generate complete audio buffer (non-streaming) |

Audio format: raw 24kHz 16-bit mono PCM (no headers, no encoding overhead).

### Tell Claude Code:
"Create the OpenAI TTS streaming client"

---

## Step 4: Create the WebSocket Voice Server

### What Claude Code does:
- Creates `src/voice-server.ts` — WebSocket handler for real-time voice communication

The server:
1. Authenticates connections via `?token=SECRET` query parameter
2. Receives JSON transcripts from the browser: `{ type: "transcript", text: "...", agent?: "health" }`
3. Saves the user message to conversation history
4. Routes through Claude Code CLI with the selected agent's system prompt
5. Fetches weather, calendar, and email context based on keyword detection (same as text messages)
6. Sends back JSON metadata: `{ type: "response", text: "...", agentName: "Health Agent" }`
7. Streams OpenAI TTS audio as binary WebSocket frames
8. Sends `{ type: "audio_start" }` and `{ type: "audio_end" }` to bracket the audio stream

### Tell Claude Code:
"Create the WebSocket voice server"

---

## Step 5: Create the Web Voice Interface

### What Claude Code does:
- Creates `src/web/voice.html` — single-page voice interface

Features:
- **Push-to-talk**: Hold spacebar (or tap/hold the mic button) to record
- **Cancel**: Press Escape to discard a bad transcription
- **Agent selector**: Auto-detect (default) or manually select any agent
- **Conversation log**: Scrolling transcript with agent labels
- **State indicators**: Listening, Thinking, Speaking status in the header
- **Audio playback**: PCM streaming via Web AudioContext at 24kHz

The speech recognition accumulates all finalized segments and captures interim text on release, so pauses mid-sentence don't lose earlier words.

### Tell Claude Code:
"Create the web voice interface HTML"

---

## Step 6: Wire Into the Bot Server

### What Claude Code does:
- Modifies `src/bot.ts` to:
  - Import voice-server WebSocket handlers
  - Serve `voice.html` at `GET /voice`
  - Upgrade `/voice` WebSocket connections with token authentication
  - Add `websocket:` config to `Bun.serve()` with open/message/close handlers
  - Add `voiceMode` parameter to `callClaude()` with brevity instructions for Telegram voice
  - Short-circuit failed transcriptions (no Claude, no TTS — just a brief text reply)
  - Cap TTS to responses under 2000 characters

### Tell Claude Code:
"Wire the voice server into bot.ts"

---

## Step 7: Update VPS Gateway for Voice

### What Claude Code does:
- Modifies `src/vps-gateway.ts` to:
  - Always process voice messages on VPS via Anthropic API (never forward to local `/process`)
  - Prepend voice responses with a brevity instruction
  - Short-circuit failed transcriptions
  - Only generate TTS for responses under 2000 characters
  - Send voice reply OR text — not both

### Tell Claude Code:
"Update the VPS gateway for Telegram voice messages"

---

## Step 8: Update Gemini Transcription

### What Claude Code does:
- Updates `src/lib/transcribe.ts`:
  - Upgrades model from `gemini-2.0-flash` (deprecated) to `gemini-2.5-flash`
  - Adds HTTP status checking before parsing response
  - Returns `[Transcription failed]` on API errors instead of crashing

### Tell Claude Code:
"Update the Gemini transcription model"

---

## Step 9: Update Speaktor TTS for Per-Agent Voices

### What Claude Code does:
- Modifies `src/lib/voice.ts`:
  - Adds optional `agentName` parameter to `textToSpeech()`
  - Looks up the agent's Speaktor voice override from `AgentConfig`
  - Falls back to the default voice from the `SPEAKTOR_VOICE_NAME` env var

This is a small enhancement for future use — initially all Telegram voice notes use the same Speaktor voice. The mapping is in place for when per-agent Speaktor voices are desired.

### Tell Claude Code:
"Update voice.ts for per-agent Speaktor voices"

---

## Step 10: Verify

### Telegram Voice Notes

1. Send a voice message to the bot on Telegram
2. You should receive a voice reply back
3. Check VPS logs for the pipeline: `Gemini transcription → Anthropic processing → Speaktor TTS → voice reply`

```bash
# Check VPS logs
pm2 logs go-bot --lines 20 --nostream
```

Test messages:
- Send a voice note saying "What's the weather like?" — should get a concise voice reply
- Send a voice note saying "How did I sleep?" — should route to Health Agent and reply with Oura data

### Web Real-Time Voice

1. Open Chrome on any Tailscale-connected device
2. If using HTTP (not HTTPS), enable the Chrome flag:
   - Go to `chrome://flags/#unsafely-treat-insecure-origin-as-secure`
   - Add your bot's Tailscale address: `http://YOUR_TAILSCALE_IP:3000`
   - Restart Chrome
3. Navigate to `http://YOUR_TAILSCALE_IP:3000/voice?token=YOUR_VOICE_WEB_TOKEN`
4. Hold spacebar and ask a question
5. Verify: transcript appears → agent routes → response text appears → audio plays

Test per-agent voices:
- Select "Health" and ask a health question — should hear shimmer voice (gentle)
- Select "Finance" and ask a money question — should hear onyx voice (authoritative)
- Leave on "Auto" and ask a strategy question — should auto-route and use fable voice

---

## Security

- **WebSocket auth**: Token in query string, checked on upgrade. Without the correct token, WebSocket connections are rejected.
- **Network isolation**: The web voice interface is accessible only via Tailscale (your private WireGuard network). The Cloudflare tunnel routes are for the Telegram webhook only — `/voice` is not exposed publicly.
- **No public exposure**: The bot serves on port 3000, which is only reachable via Tailscale IPs. Even if someone found the IP, they'd need the WebSocket token.

---

## Browser Compatibility

| Browser | Web Speech API | Audio Playback | Supported |
|---------|---------------|----------------|-----------|
| Chrome (desktop) | Yes | Yes | **Yes** |
| Edge (desktop) | Yes | Yes | **Yes** |
| Chrome (Android) | Yes | Yes | **Yes** |
| Safari | No | Yes | **No** (no Web Speech API) |
| Firefox | No | Yes | **No** (no Web Speech API) |

The Web Speech API requires a secure context (HTTPS) or a localhost origin. On Tailscale without HTTPS certs, use the Chrome flag described in Step 10 to treat your Tailscale IP as a secure origin.

---

## Architecture

### New Files

| File | Purpose |
|------|---------|
| `src/lib/openai-tts.ts` | OpenAI TTS streaming client — `streamTTS()`, `generateTTS()`, `isOpenAITTSEnabled()` |
| `src/voice-server.ts` | WebSocket handler for voice connections — auth, Claude routing, TTS streaming |
| `src/web/voice.html` | Single-page web voice interface — push-to-talk, agent selector, audio playback |

### Modified Files

| File | Changes |
|------|---------|
| `src/agents/base.ts` | Added `VoiceConfig` interface and `voice` field to `AgentConfig` |
| `src/agents/*.ts` (all 8) | Added voice config with OpenAI voice ID and personality instructions |
| `src/agents/index.ts` | Added `VoiceConfig` to type exports |
| `src/bot.ts` | WebSocket upgrade for `/voice`, serves `voice.html`, `voiceMode` brevity for `callClaude()`, failed transcription short-circuit |
| `src/vps-gateway.ts` | Voice messages always process on VPS via Anthropic API, brevity prefix, TTS cap, failed transcription bail |
| `src/lib/transcribe.ts` | Upgraded Gemini model from `2.0-flash` to `2.5-flash`, added error handling |
| `src/lib/voice.ts` | Added `agentName` parameter for per-agent Speaktor voice lookup |
| `.env` / `.env.example` | Added `OPENAI_API_KEY`, `VOICE_WEB_TOKEN` |

---

## Customization

### Voice Mapping

Edit the `voice` property in any agent file (e.g., `src/agents/health.ts`) to change the voice or personality:

```typescript
voice: {
  openai: "shimmer",
  openaiInstructions: "Caring, gentle, and reassuring.",
  speaktor: "Davis",  // Optional Speaktor override for Telegram
}
```

Available OpenAI voices: `alloy`, `ash`, `ballad`, `coral`, `echo`, `fable`, `nova`, `onyx`, `sage`, `shimmer`.

### TTS Character Limit

Responses over 2000 characters are sent as text-only (no TTS) to prevent extremely long audio. Adjust in `src/bot.ts` and `src/vps-gateway.ts`:

```typescript
if (response.length < 2000) {
  // Generate TTS
}
```

### Voice Mode Brevity

The voice mode instruction tells Claude to keep responses short (1-2 sentences). Edit the `VOICE MODE` section in `src/voice-server.ts` for the web interface or the `voiceMode` block in `src/bot.ts` for Telegram.

### WebSocket Token

Rotate the token anytime by changing `VOICE_WEB_TOKEN` in `.env` and restarting the bot. Update bookmarks accordingly.

---

## VPS Setup

Add these env vars to your VPS `.env`:

```env
# Required for Telegram voice notes
GEMINI_API_KEY=your-gemini-key
SPEAKTOR_API_KEY=your-speaktor-key
SPEAKTOR_VOICE_NAME=Davis

# Optional — only needed if you want web voice from VPS
OPENAI_API_KEY=sk-your-openai-key
VOICE_WEB_TOKEN=your-random-token
```

The VPS `start-vps.sh` wrapper script needs `bun` in its PATH:

```bash
#!/bin/bash
export PATH="/home/deploy/.bun/bin:$PATH"
cd /home/deploy/go-telegram-bot
exec bun run vps
```

Restart PM2 after updating:

```bash
pm2 restart go-bot
```

---

## Troubleshooting

| Problem | Solution |
|---------|----------|
| Voice note gets no reply | Check `GEMINI_API_KEY` is set. Check VPS logs: `pm2 logs go-bot --lines 20` |
| "Transcription failed" reply | Gemini API may be down or the audio format isn't supported. Check logs for HTTP status |
| Voice reply is very long (30+ seconds) | The TTS cap or voice mode brevity instructions may not be applied. Verify the code in `vps-gateway.ts` |
| Bot sends both text AND voice reply | Should only send one. Check the return statement after voice reply in `vps-gateway.ts` |
| Web Speech API not available | Use Chrome or Edge. Safari and Firefox don't support it |
| Microphone permission denied | Browser needs microphone access. Check site permissions in Chrome settings |
| Chrome blocks mic on HTTP | Enable `chrome://flags/#unsafely-treat-insecure-origin-as-secure` with your Tailscale IP |
| WebSocket connection rejected | Check that the `token` query parameter matches `VOICE_WEB_TOKEN` in `.env` |
| No audio plays in browser | Check that `OPENAI_API_KEY` is set. Without it, replies are text-only |
| Audio plays but sounds garbled | AudioContext sample rate mismatch. Should be 24000 Hz — check `voice.html` |
| Only first few words get sent | The speech recognition accumulation fix may be missing. Check that `currentInterim` is used in `stopRecording()` |
| Pressing Escape doesn't cancel | Check that the keydown handler for Escape is present in `voice.html` |
| Wrong agent voice plays | Verify the agent's `voice.openai` field in its config file |
| `start-vps.sh: bun: not found` | Add bun to the PATH in `start-vps.sh`: `export PATH="/home/deploy/.bun/bin:$PATH"` |

---

## API Reference

### OpenAI TTS

```
POST https://api.openai.com/v1/audio/speech

Headers:
  Authorization: Bearer YOUR_OPENAI_API_KEY
  Content-Type: application/json

Body:
{
  "model": "gpt-4o-mini-tts",
  "input": "Text to speak",
  "voice": "coral",
  "instructions": "Warm, conversational, and clear.",
  "response_format": "pcm"
}

Response: Raw 24kHz 16-bit mono PCM audio stream
```

Pricing: $0.60 per 1M input characters (as of Feb 2026).

### Google Gemini (Transcription)

```
POST https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=YOUR_KEY

Body:
{
  "contents": [{
    "parts": [
      { "text": "Transcribe this audio to text..." },
      { "inline_data": { "mime_type": "audio/ogg", "data": "BASE64_AUDIO" } }
    ]
  }]
}
```

### Speaktor TTS

Used via the existing `src/lib/voice.ts` client. See [speaktor.com](https://speaktor.com/) for API documentation.

---

## References

- [OpenAI TTS API](https://platform.openai.com/docs/guides/text-to-speech) — Text-to-speech documentation
- [OpenAI TTS Voices](https://platform.openai.com/docs/guides/text-to-speech/voice-options) — Voice samples and descriptions
- [Web Speech API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Speech_API) — Browser speech recognition
- [Tailscale](https://tailscale.com/) — Private WireGuard mesh network
- [Google Gemini API](https://ai.google.dev/) — Multimodal AI including audio transcription
- [Speaktor](https://speaktor.com/) — Text-to-speech service
