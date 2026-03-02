/**
 * Code Execution Sandbox (E2B)
 *
 * Executes Python code in an isolated E2B Firecracker microVM.
 * No local Docker required — runs via E2B cloud API.
 *
 * Limits: 10s timeout, no network access from code, ephemeral filesystem.
 * Enabled only when SANDBOX_ENABLED=true and E2B_API_KEY is set.
 */

import { Sandbox } from "@e2b/code-interpreter";

export interface SandboxResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  timedOut: boolean;
  durationMs: number;
}

const TIMEOUT_MS = 10_000;
const MAX_OUTPUT_CHARS = 3_000;

export function isSandboxEnabled(): boolean {
  return process.env.SANDBOX_ENABLED === "true" && !!process.env.E2B_API_KEY;
}

/**
 * Execute Python code in an E2B sandbox.
 */
export async function runInSandbox(code: string): Promise<SandboxResult> {
  const start = Date.now();

  let sbx: Sandbox | null = null;
  try {
    sbx = await Sandbox.create({
      apiKey: process.env.E2B_API_KEY,
      timeoutMs: TIMEOUT_MS,
    });

    const exec = await sbx.runCode(code, { timeoutMs: TIMEOUT_MS });

    const stdout = (exec.logs.stdout.join("\n") || exec.text || "").slice(0, MAX_OUTPUT_CHARS);
    const stderr = exec.logs.stderr.join("\n").slice(0, 1_000);
    const exitCode = exec.error ? 1 : 0;

    return {
      stdout,
      stderr: exec.error ? `${exec.error.name}: ${exec.error.value}` : stderr,
      exitCode,
      timedOut: false,
      durationMs: Date.now() - start,
    };
  } catch (err: any) {
    const timedOut = err?.message?.includes("timeout") || err?.message?.includes("Timeout");
    return {
      stdout: "",
      stderr: timedOut ? "Execution timed out (10s limit)." : (err?.message ?? "Sandbox error"),
      exitCode: -1,
      timedOut,
      durationMs: Date.now() - start,
    };
  } finally {
    if (sbx) await sbx.kill().catch(() => {});
  }
}

/**
 * Strip markdown code fences if present. Returns raw code.
 */
export function extractCode(input: string): string {
  const fenced = input.match(/^```(?:python|py)?\s*\n([\s\S]*?)```/im);
  if (fenced) return fenced[1].trim();
  return input.trim();
}
