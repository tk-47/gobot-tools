export type Subject = "math" | "science" | "history" | "unknown";

export interface AskRequest {
  question: string;
  problemImageBase64?: string;   // base64 (no data URL prefix)
  problemImageType?: string;     // "image/jpeg" | "image/png" | "image/webp"
  referenceImageBase64?: string;
  referenceImageType?: string;
}

export interface AskResponse {
  subject: Subject;
  problem: string;       // extracted/cleaned problem text
  answer?: string;       // math only — from E2B stdout
  pythonCode?: string;   // math only — shown for transparency
  explanation: string;   // full explanation
  steps?: string[];      // math: numbered steps
  error?: string;
}
