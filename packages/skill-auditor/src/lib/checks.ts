import type { CheckId, Severity, Finding, FileEntry } from "./types";
import safeDomainData from "../data/safe-domains.json";

// ─── Public types ─────────────────────────────────────────────────────────────

export type { FileEntry };

export interface CheckDefinition {
  id: CheckId;
  severity: Severity;
  /**
   * Returns an array of { match, nonDowngradable } for each hit found on a
   * single line, given the full line text and the safe-domain list.
   */
  matchLine: (
    line: string,
    safeDomains: string[]
  ) => Array<{ match: string; nonDowngradable: boolean }>;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Extract the hostname (without port) from a URL-like string. Returns null if none found. */
function extractHostname(url: string): string | null {
  const m = url.match(/https?:\/\/([^/\s"':]+)/i);
  return m ? m[1].toLowerCase() : null;
}

/** Check whether a hostname is on the safe list. */
function isSafeDomain(hostname: string, safeDomains: string[]): boolean {
  return safeDomains.some(
    (safe) =>
      hostname === safe.toLowerCase() ||
      hostname.endsWith("." + safe.toLowerCase())
  );
}

// ─── Check Definitions ────────────────────────────────────────────────────────

export const CHECK_DEFINITIONS: CheckDefinition[] = [
  // ── SHELL_EXEC ──────────────────────────────────────────────────────────────
  {
    id: "SHELL_EXEC",
    severity: "RISK",
    matchLine(line, safeDomains) {
      const hits: Array<{ match: string; nonDowngradable: boolean }> = [];

      // Patterns that indicate shell execution
      // 1. Piped-to-shell: `curl ... | bash` or `wget ... | bash/sh`
      const pipedShell =
        /(curl|wget)\s+[^\n|]*\|\s*(ba)?sh/gi;
      let m: RegExpExecArray | null;
      while ((m = pipedShell.exec(line)) !== null) {
        // Determine if the URL is to a non-safe domain → non-downgradable
        const hostname = extractHostname(m[0]);
        const nonDowngradable =
          hostname !== null && !isSafeDomain(hostname, safeDomains);
        hits.push({ match: m[0], nonDowngradable });
      }

      // 2. eval( — any context
      const evalPattern = /\beval\s*\(/gi;
      while ((m = evalPattern.exec(line)) !== null) {
        hits.push({ match: m[0], nonDowngradable: false });
      }

      // 3. exec( — any context
      const execPattern = /\bexec\s*\(/gi;
      while ((m = execPattern.exec(line)) !== null) {
        hits.push({ match: m[0], nonDowngradable: false });
      }

      // 4. bash -c — inline execution
      const bashC = /bash\s+-c\s+/gi;
      while ((m = bashC.exec(line)) !== null) {
        hits.push({ match: m[0], nonDowngradable: false });
      }

      return hits;
    },
  },

  // ── EXTERNAL_URL ────────────────────────────────────────────────────────────
  {
    id: "EXTERNAL_URL",
    severity: "CAUTION",
    matchLine(line, safeDomains) {
      const hits: Array<{ match: string; nonDowngradable: boolean }> = [];
      const urlPattern = /https?:\/\/([^/\s"'<>:]+)(?::\d+)?/gi;
      let m: RegExpExecArray | null;
      while ((m = urlPattern.exec(line)) !== null) {
        // m[1] is the hostname without port
        const hostname = m[1].toLowerCase();
        if (!isSafeDomain(hostname, safeDomains)) {
          hits.push({ match: m[0], nonDowngradable: false });
        }
      }
      return hits;
    },
  },

  // ── CREDENTIAL_ACCESS ───────────────────────────────────────────────────────
  {
    id: "CREDENTIAL_ACCESS",
    severity: "RISK",
    matchLine(line, _safeDomains) {
      const hits: Array<{ match: string; nonDowngradable: boolean }> = [];

      // Direct reads of sensitive key directories → non-downgradable
      const criticalPaths = [
        { re: /~\/\.ssh\/\S+/gi, nd: true },
        { re: /~\/\.aws\/\S+/gi, nd: true },
        { re: /~\/\.gnupg\/\S+/gi, nd: true },
      ];
      for (const { re, nd } of criticalPaths) {
        let m: RegExpExecArray | null;
        while ((m = re.exec(line)) !== null) {
          hits.push({ match: m[0], nonDowngradable: nd });
        }
      }

      // Other credential patterns — still RISK but downgradable
      const otherPatterns = [
        /~\/\.env\b/gi,
        /\/etc\/passwd\b/gi,
        /\/etc\/shadow\b/gi,
      ];
      for (const re of otherPatterns) {
        let m: RegExpExecArray | null;
        while ((m = re.exec(line)) !== null) {
          // Avoid double-reporting if already caught above
          const alreadyCaught = hits.some((h) => line.includes(h.match));
          if (!alreadyCaught) {
            hits.push({ match: m[0], nonDowngradable: false });
          }
        }
      }

      return hits;
    },
  },

  // ── OBFUSCATED ──────────────────────────────────────────────────────────────
  {
    id: "OBFUSCATED",
    severity: "RISK",
    matchLine(line, _safeDomains) {
      const hits: Array<{ match: string; nonDowngradable: boolean }> = [];

      // Base64 blocks: [A-Za-z0-9+/]{40,}={0,2}
      // Must be a standalone token (word boundary or spaces)
      const b64Pattern = /(?<![A-Za-z0-9+/])([A-Za-z0-9+/]{40,}={0,2})(?![A-Za-z0-9+/=])/g;
      let m: RegExpExecArray | null;
      while ((m = b64Pattern.exec(line)) !== null) {
        const token = m[1];
        const nonDowngradable = token.length > 100;
        hits.push({ match: token, nonDowngradable });
      }

      // Hex escape sequences: \xNN repeated 4+ times
      // Count the number of \xNN pairs in a run
      const hexRunPattern = /((?:\\x[0-9a-fA-F]{2}){4,})/g;
      while ((m = hexRunPattern.exec(line)) !== null) {
        const run = m[1];
        // Count pairs: each \xNN is 4 chars
        const pairCount = run.length / 4;
        const nonDowngradable = pairCount > 20;
        hits.push({ match: run, nonDowngradable });
      }

      return hits;
    },
  },

  // ── PROMPT_INJECTION ────────────────────────────────────────────────────────
  {
    id: "PROMPT_INJECTION",
    severity: "RISK",
    matchLine(line, _safeDomains) {
      const hits: Array<{ match: string; nonDowngradable: boolean }> = [];

      const patterns: Array<{ re: RegExp; nd: boolean }> = [
        // Ignore previous instructions
        { re: /ignore\s+(all\s+)?previous\s+instructions?/gi, nd: false },
        // You are now — explicit role override
        { re: /you\s+are\s+now\b/gi, nd: true },
        // im_start / im_end tokens
        { re: /<\|im_(start|end)\|>/gi, nd: true },
        // System prompt override attempts
        { re: /\[system\]/gi, nd: false },
        // "Act as" role overrides
        { re: /\bact\s+as\s+(an?\s+)?(ai|bot|assistant|dan)\b/gi, nd: true },
        // "Pretend you are" overrides
        { re: /pretend\s+(you\s+are|to\s+be)\b/gi, nd: true },
        // Disregard previous
        { re: /disregard\s+(all\s+)?previous/gi, nd: false },
      ];

      for (const { re, nd } of patterns) {
        let m: RegExpExecArray | null;
        while ((m = re.exec(line)) !== null) {
          hits.push({ match: m[0], nonDowngradable: nd });
        }
      }

      return hits;
    },
  },

  // ── SECURITY_DISABLE ────────────────────────────────────────────────────────
  {
    id: "SECURITY_DISABLE",
    severity: "RISK",
    matchLine(line, _safeDomains) {
      const hits: Array<{ match: string; nonDowngradable: boolean }> = [];

      const patterns = [
        /--no-verify\b/gi,
        /--dangerously-skip-permissions\b/gi,
        /--force\b/gi,
        /--allow-root\b/gi,
        /--insecure\b/gi,
      ];

      for (const re of patterns) {
        let m: RegExpExecArray | null;
        while ((m = re.exec(line)) !== null) {
          hits.push({ match: m[0], nonDowngradable: false });
        }
      }

      return hits;
    },
  },

  // ── POST_INSTALL ────────────────────────────────────────────────────────────
  {
    id: "POST_INSTALL",
    severity: "CAUTION",
    matchLine(line, _safeDomains) {
      const hits: Array<{ match: string; nonDowngradable: boolean }> = [];

      // JSON key format: "postinstall":, "preinstall":, "prepare":
      const patterns = [
        /"postinstall"\s*:/gi,
        /"preinstall"\s*:/gi,
        /"prepare"\s*:/gi,
      ];

      for (const re of patterns) {
        let m: RegExpExecArray | null;
        while ((m = re.exec(line)) !== null) {
          hits.push({ match: m[0], nonDowngradable: false });
        }
      }

      return hits;
    },
  },

  // ── TELEMETRY ───────────────────────────────────────────────────────────────
  {
    id: "TELEMETRY",
    severity: "CAUTION",
    matchLine(line, _safeDomains) {
      const hits: Array<{ match: string; nonDowngradable: boolean }> = [];

      const keywords = [
        /\banalytics\b/gi,
        /\btelemetry\b/gi,
        /\btracking\b/gi,
        /\bbeacon\b/gi,
        /\bsentry\b/gi,
        /\bmixpanel\b/gi,
        /\bdatadog\b/gi,
        /\bnewrelic\b/gi,
        /\bsegment\.io\b/gi,
        /\bamplitude\b/gi,
      ];

      for (const re of keywords) {
        let m: RegExpExecArray | null;
        while ((m = re.exec(line)) !== null) {
          hits.push({ match: m[0], nonDowngradable: false });
        }
      }

      return hits;
    },
  },

  // ── FS_OUTSIDE_PROJECT ──────────────────────────────────────────────────────
  {
    id: "FS_OUTSIDE_PROJECT",
    severity: "CAUTION",
    matchLine(line, _safeDomains) {
      const hits: Array<{ match: string; nonDowngradable: boolean }> = [];

      const patterns: Array<{ re: RegExp }> = [
        // System directories
        { re: /\/tmp\//gi },
        { re: /\/var\//gi },
        { re: /\/etc\//gi },
        { re: /\/usr\//gi },
        { re: /\/opt\//gi },
        { re: /\/home\/[^/\s]+/gi },
        { re: /\/root\//gi },
        // Path traversal: 3 or more ../ levels
        { re: /(?:\.\.\/){3,}/g },
      ];

      for (const { re } of patterns) {
        let m: RegExpExecArray | null;
        while ((m = re.exec(line)) !== null) {
          hits.push({ match: m[0], nonDowngradable: false });
        }
      }

      return hits;
    },
  },

  // ── PERMISSION_ESCALATION ───────────────────────────────────────────────────
  {
    id: "PERMISSION_ESCALATION",
    severity: "RISK",
    matchLine(line, _safeDomains) {
      const hits: Array<{ match: string; nonDowngradable: boolean }> = [];

      const patterns = [
        /\bsudo\b/gi,
        /\bchmod\s+777\b/gi,
        /\bchown\s+root\b/gi,
        /\bsetuid\s*\(/gi,
        /\bsu\s+-\s+root\b/gi,
        /\bpkexec\b/gi,
        /\brunAs\b/gi,
      ];

      for (const re of patterns) {
        let m: RegExpExecArray | null;
        while ((m = re.exec(line)) !== null) {
          // ALL permission escalation matches are non-downgradable
          hits.push({ match: m[0], nonDowngradable: true });
        }
      }

      return hits;
    },
  },
];

// ─── Default safe domains (loaded from safe-domains.json) ────────────────────

const DEFAULT_SAFE_DOMAINS: string[] = [
  ...safeDomainData.defaults,
  ...safeDomainData.custom,
];

// ─── Core engine ─────────────────────────────────────────────────────────────

/**
 * Run a single check against a single file.
 * Returns one Finding per matched occurrence.
 */
export function runCheck(
  check: CheckDefinition,
  file: FileEntry,
  safeDomains: string[]
): Finding[] {
  if (file.skipped) return [];

  const allDomains = mergeDomains(safeDomains);
  const findings: Finding[] = [];
  const fileLines = file.content.split("\n");

  for (let i = 0; i < fileLines.length; i++) {
    const lineText = fileLines[i];
    const lineNumber = i + 1; // 1-indexed

    const hits = check.matchLine(lineText, allDomains);
    for (const hit of hits) {
      const context = buildContext(fileLines, i, 3);
      findings.push({
        checkId: check.id,
        severity: check.severity,
        nonDowngradable: hit.nonDowngradable,
        file: file.path,
        line: lineNumber,
        match: hit.match,
        context,
      });
    }
  }

  return findings;
}

/**
 * Run all 10 checks against all provided files.
 * Merges caller-supplied safe domains with the defaults from safe-domains.json.
 */
export function runAllChecks(
  files: FileEntry[],
  safeDomains: string[]
): Finding[] {
  const allDomains = mergeDomains(safeDomains);
  const findings: Finding[] = [];

  for (const file of files) {
    if (file.skipped) continue;
    for (const check of CHECK_DEFINITIONS) {
      findings.push(...runCheck(check, file, allDomains));
    }
  }

  return findings;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Merge caller-supplied domains with the defaults, deduplicating.
 */
function mergeDomains(callerDomains: string[]): string[] {
  const set = new Set<string>([
    ...DEFAULT_SAFE_DOMAINS.map((d) => d.toLowerCase()),
    ...callerDomains.map((d) => d.toLowerCase()),
  ]);
  return Array.from(set);
}

/**
 * Build a context string: `contextLines` lines before and after the target line.
 * Lines are joined with newlines.
 */
function buildContext(
  lines: string[],
  targetIndex: number,
  contextLines: number
): string {
  const start = Math.max(0, targetIndex - contextLines);
  const end = Math.min(lines.length - 1, targetIndex + contextLines);
  return lines.slice(start, end + 1).join("\n");
}
