/**
 * OpenRouter client with a multi-model failover chain.
 *
 * Why failover? The free-tier vision models on OpenRouter share one upstream
 * rate-limit pool, so any single model can answer 429 at any moment (verified
 * live on 2026-11-22: both Gemma 4 free models and Ling 3.2 returned 429
 * within minutes of each other). Trying models in priority order makes the
 * app work when any one provider is congested, at zero cost.
 *
 * The chain is ordered by measured quality first, then availability:
 *   1. particle-ai/particle-1:free        — richest descriptions, fastest
 *   2. nvidia/nemotron-3-nano-omni:free   — accurate, slightly slower (reasoning)
 *   3. google/gemma-4-31b-it:free         — Gemini-family vision model
 *   4. google/gemma-4-26b-a4b-it:free     — Gemini-family vision model
 *   5. inclusionai/ling-3.2-flash:free   — last resort
 *
 * All calls are server-side only. The API key never leaves the server.
 */

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

export const DEFAULT_MODEL_CHAIN: string[] = [
  "particle-ai/particle-1:free",
  "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free",
  "google/gemma-4-31b-it:free",
  "google/gemma-4-26b-a4b-it:free",
  "inclusionai/ling-3.2-flash:free",
];

export function modelChain(): string[] {
  const override = process.env.OPENROUTER_MODELS;
  if (override) {
    const list = override
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (list.length > 0) return list;
  }
  return DEFAULT_MODEL_CHAIN;
}

export interface VisionAttempt {
  model: string;
  ok: boolean;
  status?: number;
  error?: string;
  latencyMs: number;
}

export interface VisionResult {
  /** Raw text returned by the model (usually JSON, parsed by callers). */
  text: string;
  /** Model that produced the answer. */
  model: string;
  /** Every model tried, in order, with outcome — shown in the UI for transparency. */
  attempts: VisionAttempt[];
  /** Total wall-clock time across all attempts. */
  totalLatencyMs: number;
}

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content:
    | string
    | Array<
        | { type: "text"; text: string }
        | { type: "image_url"; image_url: { url: string } }
      >;
}

const ATTEMPT_TIMEOUT_MS = 20_000;

/** True for errors worth retrying on the next model (rate limits, provider 5xx). */
function isRetryable(status: number): boolean {
  return status === 429 || status === 404 || status === 502 || status === 503 || status === 504;
}

/**
 * Send one vision chat completion, walking the model chain until a model
 * answers. Throws only when every model failed; the error message lists
 * what each model said so the UI can show a useful reason.
 */
export async function chatVision(
  messages: ChatMessage[],
  maxTokens = 900,
): Promise<VisionResult> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error(
      "OPENROUTER_API_KEY is not set. Copy .env.example to .env.local and add a free key from https://openrouter.ai/keys",
    );
  }

  const started = Date.now();
  const attempts: VisionAttempt[] = [];
  let lastError = "all models failed";

  for (const model of modelChain()) {
    const attemptStarted = Date.now();
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), ATTEMPT_TIMEOUT_MS);
      let res: Response;
      try {
        res = await fetch(OPENROUTER_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
            // OpenRouter asks clients to identify themselves; harmless and helps rate limits.
            "HTTP-Referer": "https://github.com/jajanb923-netizen/lumina-visual-search-assistant",
            "X-Title": "Lumina Visual Search Assistant",
          },
          body: JSON.stringify({ model, messages, max_tokens: maxTokens }),
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timer);
      }

      const latencyMs = Date.now() - attemptStarted;
      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        attempts.push({ model, ok: false, status: res.status, error: detail.slice(0, 200), latencyMs });
        lastError = `${model} → HTTP ${res.status}`;
        if (!isRetryable(res.status)) break; // e.g. 400/401: retrying won't help
        continue;
      }

      const payload = (await res.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const text = payload.choices?.[0]?.message?.content ?? "";
      if (!text.trim()) {
        attempts.push({ model, ok: false, error: "empty reply", latencyMs });
        lastError = `${model} → empty reply`;
        continue;
      }
      attempts.push({ model, ok: true, status: res.status, latencyMs });
      return { text, model, attempts, totalLatencyMs: Date.now() - started };
    } catch (err) {
      const latencyMs = Date.now() - attemptStarted;
      const msg = err instanceof Error ? err.message : String(err);
      attempts.push({ model, ok: false, error: msg.slice(0, 200), latencyMs });
      lastError = `${model} → ${msg}`;
      // Network/timeout errors are retryable on the next model.
    }
  }

  throw new Error(`Vision request failed on every model. Last error: ${lastError}`);
}

/**
 * Best-effort JSON extraction: models sometimes wrap JSON in ``` fences or
 * add a sentence before/after it. Returns null when nothing parses.
 */
export function extractJson<T>(text: string): T | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(candidate.slice(start, end + 1)) as T;
  } catch {
    return null;
  }
}

/**
 * Salvage individual fields from a malformed/truncated JSON reply.
 * Reasoning models sometimes emit a JSON object that is cut off or has a
 * stray unescaped character, which breaks a full JSON.parse — but the
 * "description" string itself is usually intact. This pulls fields out one
 * by one with regexes so the request still succeeds instead of showing raw
 * JSON to the user.
 */
function extractStringField(text: string, key: string): string | null {
  const match = text.match(new RegExp(`"${key}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"`));
  if (!match) return null;
  try {
    return JSON.parse(`"${match[1]}"`) as string;
  } catch {
    return match[1].replace(/\\"/g, '"');
  }
}

function extractArrayField(text: string, key: string): string[] {
  // Closed array first; fall back to an unterminated array (truncated reply).
  const match =
    text.match(new RegExp(`"${key}"\\s*:\\s*\\[([\\s\\S]*?)\\]`)) ||
    text.match(new RegExp(`"${key}"\\s*:\\s*\\[([\\s\\S]*)$`));
  if (!match) return [];
  const items = [...match[1].matchAll(/"((?:[^"\\]|\\.)*)"/g)];
  return items.map((item) => {
    try {
      return JSON.parse(`"${item[1]}"`) as string;
    } catch {
      return item[1];
    }
  });
}

export interface SalvagedAnalysis {
  description: string | null;
  objects: string[];
  colors: string[];
  mood: string | null;
  altText: string | null;
  tags: string[];
}

export function salvageAnalysis(text: string): SalvagedAnalysis {
  return {
    description: extractStringField(text, "description"),
    objects: extractArrayField(text, "objects"),
    colors: extractArrayField(text, "colors"),
    mood: extractStringField(text, "mood"),
    altText: extractStringField(text, "altText"),
    tags: extractArrayField(text, "tags"),
  };
}
