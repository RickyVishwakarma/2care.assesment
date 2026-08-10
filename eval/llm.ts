// Minimal OpenAI-compatible chat client with tool-calling. Works with any
// OpenAI-compatible endpoint (OpenAI, Groq, Together, OpenRouter, local) via
// EVAL_LLM_BASE_URL — so the reviewer can re-run with whatever key they have.
//
//   EVAL_LLM_API_KEY   (required)
//   EVAL_LLM_BASE_URL  (default https://api.openai.com/v1)
//   EVAL_LLM_MODEL     (default gpt-4o-mini)

const BASE = process.env.EVAL_LLM_BASE_URL ?? "https://api.openai.com/v1";
const MODEL = process.env.EVAL_LLM_MODEL ?? "gpt-4o-mini";
const KEY = process.env.EVAL_LLM_API_KEY ?? "";

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  name?: string;
}
export interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}
export interface ToolDef {
  type: "function";
  function: { name: string; description: string; parameters: unknown };
}

export function haveLLM(): boolean {
  return KEY.length > 0;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function chat(
  messages: ChatMessage[],
  tools?: ToolDef[],
  opts: { temperature?: number } = {}
): Promise<ChatMessage> {
  if (!KEY) throw new Error("EVAL_LLM_API_KEY not set");
  const body = JSON.stringify({
    model: MODEL,
    messages,
    tools,
    tool_choice: tools ? "auto" : undefined,
    temperature: opts.temperature ?? 0.4,
  });

  // Retry on 429 (rate limit) and 5xx, honouring the server's retry delay when
  // present. Free-tier LLM keys throttle aggressively; this keeps the run alive
  // instead of failing the whole suite on a transient limit.
  const MAX_RETRIES = 8;
  for (let attempt = 0; ; attempt++) {
    let res: Response;
    try {
      res = await fetch(`${BASE}/chat/completions`, {
        method: "POST",
        headers: { authorization: `Bearer ${KEY}`, "content-type": "application/json" },
        body,
      });
    } catch (e) {
      // Network-level failure (ECONNRESET / socket hang up) — retry, don't die.
      if (attempt < MAX_RETRIES) {
        await sleep(Math.min(2 ** attempt * 1000, 15000));
        continue;
      }
      throw new Error(`LLM network error: ${(e as Error).message}`);
    }
    if (res.ok) {
      const data = await res.json();
      return data.choices[0].message as ChatMessage;
    }
    const text = await res.text();
    // 429 = rate/TPM limit; honour retryDelay when present, else exponential.
    if ((res.status === 429 || res.status >= 500) && attempt < MAX_RETRIES) {
      const m = text.match(/"retryDelay":\s*"(\d+)s"/) || text.match(/try again in ([\d.]+)s/);
      const waitMs = m ? Math.ceil(Number(m[1]) + 1) * 1000 : Math.min(2 ** attempt * 1000, 30000);
      await sleep(waitMs);
      continue;
    }
    throw new Error(`LLM ${res.status}: ${text}`);
  }
}

// One-shot JSON scorer used by the LLM-judge. Returns parsed JSON or null.
export async function judge(prompt: string): Promise<any | null> {
  if (!KEY) return null;
  const msg = await chat(
    [
      { role: "system", content: "You are a strict evaluator. Reply with ONLY valid JSON." },
      { role: "user", content: prompt },
    ],
    undefined,
    { temperature: 0 }
  );
  try {
    return JSON.parse((msg.content ?? "").replace(/```json|```/g, "").trim());
  } catch {
    return null;
  }
}

export const EVAL_MODEL = MODEL;
