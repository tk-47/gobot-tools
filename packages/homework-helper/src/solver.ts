/**
 * Homework Helper — Core Solver Pipeline
 *
 * Two pipelines:
 *   Math:    Claude vision → Python code → E2B execution → Claude explanation
 *   Science/History: Claude vision (single call)
 *
 * Critical invariant: math answers ONLY come from E2B stdout, never from Claude directly.
 */

import Anthropic from "@anthropic-ai/sdk";
import { Sandbox } from "@e2b/code-interpreter";
import type { AskRequest, AskResponse, Subject } from "./types";
import { MATH_CODE_PROMPT, MATH_EXPLAIN_PROMPT, KNOWLEDGE_PROMPT, ENGLISH_PROMPT } from "./prompts";

const MATH_KEYWORDS = /\b(solve|equation|calculate|fraction|decimal|percent|algebra|geometry|area|perimeter|volume|angle|triangle|circle|square|rectangle|factor|simplify|evaluate|multiply|divide|add|subtract|sum|product|quotient|remainder|exponent|power|root|sqrt|inequality|graph|slope|ratio|proportion|probability|mean|median|mode|range|integer|prime|composite)\b/i;

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ─── Public entry point ────────────────────────────────────────────────────

export async function solveHomework(req: AskRequest): Promise<AskResponse> {
  // Explicit subject from UI overrides auto-detection
  const subject = req.subject && req.subject !== "unknown"
    ? req.subject
    : detectSubject(req);

  if (subject === "math") {
    return solveMath(req);
  } else {
    return solveKnowledge(req, subject);
  }
}

// ─── Subject detection ─────────────────────────────────────────────────────

function detectSubject(req: AskRequest): Subject {
  // Image-only with no text — let the vision model detect the subject
  if (req.problemImageBase64 && !req.question.trim()) return "unknown";

  // Text-only: keyword match first
  const q = req.question.toLowerCase();
  if (MATH_KEYWORDS.test(q)) return "math";
  if (/\b(history|war|revolution|president|colony|civil|ancient|empire|treaty|congress|constitution|amendment|slavery|migration|civilization|dynasty|kingdom|republic|independence)\b/i.test(q)) return "history";
  if (/\b(science|biology|chemistry|physics|cell|atom|molecule|element|compound|energy|force|gravity|velocity|acceleration|photosynthesis|ecosystem|organism|evolution|genetics|dna|periodic|element|reaction|hypothesis|experiment|climate|weather|planet|solar|body|organ|tissue)\b/i.test(q)) return "science";
  if (/\b(grammar|punctuation|sentence|paragraph|essay|vocabulary|vocab|spelling|definition|synonym|antonym|noun|verb|adjective|adverb|pronoun|preposition|conjunction|interjection|subject|predicate|clause|phrase|comma|apostrophe|capitalize|capitalization|parts of speech|reading|comprehension|metaphor|simile|figurative|theme|plot|character|setting|conflict|author|poetry|poem|rhyme|tone|mood|inference|summarize|main idea|context clues|prefix|suffix|root word|homophone|homonym|dialogue|narrative|persuasive|expository|descriptive)\b/i.test(q)) return "english";

  // Ambiguous — default to unknown (solver will use vision model to classify)
  return "unknown";
}

// ─── Math pipeline ─────────────────────────────────────────────────────────

async function solveMath(req: AskRequest): Promise<AskResponse> {
  // Step 1: Claude vision — extract problem + generate Python code
  const step1Content: Anthropic.MessageParam["content"] = [];

  if (req.question.trim()) {
    step1Content.push({ type: "text", text: req.question });
  }

  if (req.problemImageBase64 && req.problemImageType) {
    step1Content.push(buildImageContent(req.problemImageBase64, req.problemImageType));
  }

  step1Content.push({
    type: "text",
    text: "Read the problem above and return JSON as described in the system prompt.",
  });

  const step1Resp = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 1024,
    system: MATH_CODE_PROMPT,
    messages: [{ role: "user", content: step1Content }],
  });

  const step1Text = extractText(step1Resp);
  let parsed: { problem: string; python_code: string; subject?: string };

  try {
    parsed = JSON.parse(stripFences(step1Text));
  } catch {
    return {
      subject: "math",
      problem: req.question || "Unknown problem",
      explanation: "Sorry, I couldn't understand that problem. Try typing it out clearly.",
      error: "Failed to parse problem extraction JSON",
    };
  }

  // Re-route if vision model detected a non-math subject
  if (parsed.subject && parsed.subject !== "math") {
    return solveKnowledge(req, (parsed.subject as Subject) || "unknown");
  }

  // Step 2: Execute Python in E2B sandbox
  const sandboxResult = await runInE2B(parsed.python_code);

  if (sandboxResult.error && !sandboxResult.output) {
    return {
      subject: "math",
      problem: parsed.problem,
      pythonCode: parsed.python_code,
      explanation: `There was an error computing the answer: ${sandboxResult.error}. Try typing the problem again or ask your teacher for help.`,
      error: sandboxResult.error,
    };
  }

  const computedAnswer = sandboxResult.output.trim();

  // Step 3: Claude explanation (haiku — cost-efficient for explanation only)
  const step3Resp = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 1024,
    system: MATH_EXPLAIN_PROMPT,
    messages: [
      {
        role: "user",
        content: JSON.stringify({
          problem: parsed.problem,
          python_code: parsed.python_code,
          computed_answer: computedAnswer,
        }),
      },
    ],
  });

  const step3Text = extractText(step3Resp);
  let explanation: { explanation: string; steps: string[] };

  try {
    explanation = JSON.parse(stripFences(step3Text));
  } catch {
    // Fallback: use raw text if JSON parse fails
    explanation = {
      explanation: step3Text,
      steps: [],
    };
  }

  return {
    subject: "math",
    problem: parsed.problem,
    answer: computedAnswer,
    pythonCode: parsed.python_code,
    explanation: explanation.explanation,
    steps: explanation.steps,
  };
}

// ─── Science / History pipeline ────────────────────────────────────────────

async function solveKnowledge(req: AskRequest, subject: Subject): Promise<AskResponse> {
  const content: Anthropic.MessageParam["content"] = [];

  if (req.question.trim()) {
    content.push({ type: "text", text: req.question });
  }

  if (req.problemImageBase64 && req.problemImageType) {
    content.push(buildImageContent(req.problemImageBase64, req.problemImageType));
  }

  if (req.referenceImageBase64 && req.referenceImageType) {
    content.push({ type: "text", text: "Reference material (textbook/notes):" });
    content.push(buildImageContent(req.referenceImageBase64, req.referenceImageType));
  }

  content.push({
    type: "text",
    text: "Answer the question above and return JSON as described in the system prompt.",
  });

  // Explicit English selection → targeted English prompt
  // Unknown or auto-detected non-math → KNOWLEDGE_PROMPT (classifies + answers all three subjects)
  // Explicitly selected science/history → also use KNOWLEDGE_PROMPT (handles those subjects well)
  const systemPrompt = subject === "english" ? ENGLISH_PROMPT : KNOWLEDGE_PROMPT;

  const resp = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 1024,
    system: systemPrompt,
    messages: [{ role: "user", content }],
  });

  const text = extractText(resp);
  let parsed: { subject: string; problem: string; explanation: string; corrected?: string };

  try {
    parsed = JSON.parse(stripFences(text));
  } catch {
    return {
      subject: subject === "unknown" ? "history" : subject,
      problem: req.question || "Unknown problem",
      explanation: text || "Sorry, I couldn't answer that question.",
      error: "Failed to parse response JSON",
    };
  }

  return {
    subject: (parsed.subject as Subject) || subject,
    problem: parsed.problem || req.question,
    explanation: parsed.explanation,
    ...(parsed.corrected ? { corrected: parsed.corrected } : {}),
  };
}

// ─── E2B sandbox ───────────────────────────────────────────────────────────

async function runInE2B(code: string): Promise<{ output: string; error?: string }> {
  let sbx: Sandbox | null = null;
  try {
    sbx = await Sandbox.create({ apiKey: process.env.E2B_API_KEY });
    const exec = await sbx.runCode(code, { timeoutMs: 20_000 });

    const stdout = (exec.logs.stdout.join("\n") || exec.text || "").trim();
    const stderr = exec.logs.stderr.join("\n").trim();

    if (exec.error) {
      return { output: stdout, error: `${exec.error.name}: ${exec.error.value}` };
    }

    return { output: stdout, error: stderr || undefined };
  } catch (err: any) {
    return { output: "", error: err?.message ?? "Sandbox execution failed" };
  } finally {
    if (sbx) await sbx.kill().catch(() => {});
  }
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function buildImageContent(base64: string, mediaType: string): Anthropic.ImageBlockParam {
  return {
    type: "image",
    source: {
      type: "base64",
      media_type: mediaType as "image/jpeg" | "image/png" | "image/webp" | "image/gif",
      data: base64,
    },
  };
}

function extractText(resp: Anthropic.Message): string {
  for (const block of resp.content) {
    if (block.type === "text") return block.text;
  }
  return "";
}

function stripFences(text: string): string {
  // Remove ```json ... ``` or ``` ... ``` fences if present
  const match = text.match(/^```(?:json)?\s*\n?([\s\S]*?)```\s*$/m);
  if (match) return match[1].trim();
  // Also try to extract JSON object/array directly
  const jsonMatch = text.match(/(\{[\s\S]*\})/);
  if (jsonMatch) return jsonMatch[1];
  return text.trim();
}
