// The agent runner. This mirrors what Retell's LLM does at runtime: it takes the
// SAME system prompt, the SAME tool schemas, and executes tool calls against the
// SAME deployed backend. That's the whole point — the harness tests production
// logic, not a mock. The only thing it doesn't exercise is the audio layer
// (ASR/TTS), which we call out honestly in the README.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { chat, type ChatMessage, type ToolCall, type ToolDef } from "./llm";

const BASE_URL = process.env.CARELINE_BASE_URL ?? "http://localhost:3000";

// Load the real system prompt the deployed agent uses.
const SYSTEM_PROMPT = readFileSync(join(process.cwd(), "agent", "prompt.md"), "utf8");

// Load the real tool schema and map each to its live endpoint.
const toolsFile = JSON.parse(
  readFileSync(join(process.cwd(), "agent", "tools.json"), "utf8")
) as { tools: { name: string; url: string; description: string; parameters: unknown }[] };

const TOOL_DEFS: ToolDef[] = toolsFile.tools.map((t) => ({
  type: "function",
  function: { name: t.name, description: t.description, parameters: t.parameters },
}));
const TOOL_URL = new Map(toolsFile.tools.map((t) => [t.name, t.url]));

export interface ToolTraceEntry {
  name: string;
  args: Record<string, unknown>;
  result: any;
  latency_ms: number;
}

export interface AgentTurnResult {
  utterance: string;
  toolTrace: ToolTraceEntry[];
}

// Execute one tool call against the live backend.
async function runTool(call: ToolCall): Promise<{ entry: ToolTraceEntry; message: ChatMessage }> {
  const name = call.function.name;
  const url = TOOL_URL.get(name);
  let args: Record<string, unknown> = {};
  try {
    args = JSON.parse(call.function.arguments || "{}");
  } catch {
    /* leave empty */
  }
  const t0 = Date.now();
  let result: any = { ok: false, speak: "tool error" };
  try {
    const res = await fetch(`${BASE_URL}${url}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ args }),
    });
    result = await res.json();
  } catch (e) {
    result = { ok: false, speak: `tool fetch failed: ${(e as Error).message}` };
  }
  const latency_ms = Date.now() - t0;
  return {
    entry: { name, args, result, latency_ms },
    message: { role: "tool", tool_call_id: call.id, name, content: JSON.stringify(result) },
  };
}

/**
 * Given the conversation so far (patient/agent turns), produce the agent's next
 * spoken turn, running any tool calls it makes along the way.
 */
export async function agentRespond(
  history: { role: "assistant" | "user"; content: string }[]
): Promise<AgentTurnResult> {
  const messages: ChatMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
    ...history.map((h) => ({ role: h.role, content: h.content } as ChatMessage)),
  ];
  const toolTrace: ToolTraceEntry[] = [];

  // Tool loop: keep resolving tool calls until the model produces speech.
  for (let hop = 0; hop < 6; hop++) {
    const msg = await chat(messages, TOOL_DEFS, { temperature: 0.3 });
    messages.push(msg);

    if (msg.tool_calls && msg.tool_calls.length > 0) {
      for (const call of msg.tool_calls) {
        const { entry, message } = await runTool(call);
        toolTrace.push(entry);
        messages.push(message);
      }
      continue; // let the model react to tool results
    }
    return { utterance: msg.content ?? "", toolTrace };
  }
  return { utterance: "(agent stalled)", toolTrace };
}
