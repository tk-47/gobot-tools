export const SCANNER_VERSION = "1.0.0";

export type Severity = "RISK" | "CAUTION";

export type CheckId =
  | "SHELL_EXEC"
  | "EXTERNAL_URL"
  | "CREDENTIAL_ACCESS"
  | "OBFUSCATED"
  | "PROMPT_INJECTION"
  | "SECURITY_DISABLE"
  | "POST_INSTALL"
  | "TELEMETRY"
  | "FS_OUTSIDE_PROJECT"
  | "PERMISSION_ESCALATION";

export interface Finding {
  checkId: CheckId;
  severity: Severity;
  nonDowngradable: boolean;
  file: string;
  line: number;
  match: string;
  context: string;
}

export interface FileEntry {
  path: string;
  lines: number;
  content: string;
  contentHash: string;
  skipped?: boolean;
  skipReason?: string;
}

export interface ScanResult {
  scannerVersion: string;
  skill: string;
  timestamp: string;
  files: FileEntry[];
  findings: Finding[];
  summary: {
    totalFiles: number;
    totalLines: number;
    totalFindings: number;
    riskCount: number;
    cautionCount: number;
    checksRun: number;
    checksPassed: number;
  };
  contentHash: string;
  errors: string[];
}

export interface SkillIdentifier {
  owner: string;
  repo: string;
  skillName: string;
}

export const SCAN_LIMITS = {
  maxFiles: 20,
  maxFileSizeBytes: 100 * 1024,
  maxTotalSizeBytes: 500 * 1024,
} as const;
