/**
 * Configuration — reads from environment variables with sensible defaults.
 * All infrastructure-specific values are configurable here.
 */

import { join } from "path";

// --- Target Infrastructure ---
export const VPS_URL = process.env.VPS_URL || "https://localhost";
export const VPS_HOST = process.env.VPS_SSH_HOST || "127.0.0.1";
export const VPS_USER = process.env.VPS_SSH_USER || "deploy";
export const VPS_KEY = process.env.VPS_SSH_KEY || join(process.env.HOME || "", ".ssh", "id_ed25519");
export const VPS_DIR = process.env.VPS_PROJECT_DIR || "/home/deploy/app";
export const LOCAL_URL = process.env.LOCAL_URL || "http://localhost:3000";
export const PROJECT_ROOT = process.env.GO_PROJECT_ROOT || process.cwd();
export const DOMAIN = process.env.DOMAIN || new URL(VPS_URL).hostname;

// --- Webhook Endpoints ---
// Format: "/path:METHOD:auth_type" — auth_type is signature, bearer, or none
function parseEndpoints(envKey: string, fallback: string): { path: string; method: string; authType: string }[] {
  const raw = process.env[envKey] || fallback;
  if (!raw) return [];
  return raw.split(",").map((e) => {
    const [path, method = "POST", authType = "signature"] = e.trim().split(":");
    return { path, method, authType };
  });
}

export const WEBHOOK_ENDPOINTS = parseEndpoints("WEBHOOK_ENDPOINTS", "/webhook:POST:signature");
export const DISABLED_ENDPOINTS = (process.env.DISABLED_ENDPOINTS || "").split(",").map((s) => s.trim()).filter(Boolean);
export const SENSITIVE_PATHS = (process.env.SENSITIVE_PATHS || "/.env,/.git/config,/node_modules,/.env.local").split(",").map((s) => s.trim()).filter(Boolean);
export const EXPECTED_PORTS = (process.env.EXPECTED_PORTS || "22,80,443").split(",").map((s) => parseInt(s.trim())).filter((n) => !isNaN(n));

// --- PM2 ---
export const PM2_PROCESS_NAME = process.env.PM2_PROCESS_NAME || "app";

// --- Rate Limiting ---
export const RATE_LIMIT_THRESHOLD = parseInt(process.env.RATE_LIMIT_THRESHOLD || "30");
export const RATE_LIMIT_PROBE_COUNT = parseInt(process.env.RATE_LIMIT_PROBE_COUNT || "35");

// --- Notifications ---
export const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
export const TELEGRAM_CHAT_ID = process.env.TELEGRAM_USER_ID || "";

// --- AI Review ---
export const OLLAMA_URL = process.env.OLLAMA_URL || "http://localhost:11434";
export const OLLAMA_MODEL = process.env.SECURITY_OLLAMA_MODEL || "qwen3:8b";
export const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || "";
export const ANTHROPIC_MODEL = process.env.SECURITY_CLAUDE_MODEL || "claude-sonnet-4-5-20250929";

// --- Local Security ---
export const SUBPROCESS_SOURCE_FILE = process.env.SUBPROCESS_SOURCE_FILE || "";
export const GATEWAY_SECRET = process.env.GATEWAY_SECRET || "";

// --- GitHub (for TruffleHog) ---
export const GITHUB_REPO = process.env.GITHUB_REPO || "";

// --- Timezone ---
export const TIMEZONE = process.env.TIMEZONE || "UTC";

// --- Cloudflare IP Ranges (public, stable — for DNS verification) ---
export const CLOUDFLARE_RANGES = [
  "104.", "172.64.", "172.65.", "172.66.", "172.67.",
  "173.245.", "103.21.", "103.22.", "103.31.",
  "141.101.", "108.162.", "190.93.", "188.114.",
  "197.234.", "198.41.", "162.158.",
];

/** Build infrastructure description for Claude deep analysis prompt */
export function getInfraDescription(): string {
  const parts: string[] = [];
  parts.push(`- VPS (${VPS_HOST}) running behind ${VPS_URL}`);
  parts.push(`- Domain: ${DOMAIN}`);
  if (WEBHOOK_ENDPOINTS.length > 0) {
    parts.push(`- Webhook endpoints: ${WEBHOOK_ENDPOINTS.map((e) => e.path).join(", ")}`);
  }
  if (PM2_PROCESS_NAME) {
    parts.push(`- Process manager: PM2 (${PM2_PROCESS_NAME})`);
  }
  return parts.join("\n");
}
