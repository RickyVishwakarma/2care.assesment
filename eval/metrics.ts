// Scoring. We separate WHAT happened (deterministic: DB end-state + tool trace)
// from HOW it happened (LLM-judged: recovery + naturalness). The deterministic
// scores are the ones that matter; the judge adds colour and is clearly labelled
// as softer signal (it has variance — see README limitations).
import { judge } from "./llm";
import type { ToolTraceEntry } from "./agent";

export interface ConvoJudgement {
  recovery: number; // 1-5: did it handle problems / changes gracefully?
  naturalness: number; // 1-5: did it sound like a person, not a form?
  grounding: number; // 1-5: did it avoid inventing doctors/slots/confirmations?
  notes: string;
}

// Fraction of expected tools that actually got used (order-independent).
export function toolCoverage(expect: string[], trace: ToolTraceEntry[]): number {
  if (expect.length === 0) return 1;
  const used = new Set(trace.map((t) => t.name));
  const hit = expect.filter((e) => used.has(e)).length;
  return hit / expect.length;
}

export function avgToolLatency(trace: ToolTraceEntry[]): number | null {
  if (!trace.length) return null;
  return Math.round(trace.reduce((s, t) => s + t.latency_ms, 0) / trace.length);
}

// Did the agent ever claim success while the underlying tool failed? A cheap,
// deterministic hallucination check on the trace.
export function falseConfirmation(trace: ToolTraceEntry[]): boolean {
  return trace.some(
    (t) =>
      (t.name === "book_appointment" || t.name === "reschedule_appointment") &&
      t.result?.ok === false &&
      // a following successful call would redeem it; flag only trailing failures
      false === trace.slice(trace.indexOf(t) + 1).some((n) => n.name === t.name && n.result?.ok)
  );
}

export async function judgeConversation(
  transcript: { role: string; content: string }[],
  goal: string
): Promise<ConvoJudgement | null> {
  const convo = transcript
    .map((t) => `${t.role === "assistant" ? "AGENT" : "PATIENT"}: ${t.content}`)
    .join("\n");
  const prompt =
    `A hospital voice receptionist handled this call.\n\nPATIENT GOAL: ${goal}\n\n` +
    `TRANSCRIPT:\n${convo}\n\n` +
    `Score 1-5 (integers) and return ONLY JSON:\n` +
    `{"recovery": n, "naturalness": n, "grounding": n, "notes": "one short sentence"}\n` +
    `recovery = handled problems / changes of mind gracefully.\n` +
    `naturalness = sounded like a real person, concise, not robotic.\n` +
    `grounding = never invented a doctor, slot, or confirmation.`;
  const res = await judge(prompt);
  if (!res) return null;
  return {
    recovery: Number(res.recovery) || 0,
    naturalness: Number(res.naturalness) || 0,
    grounding: Number(res.grounding) || 0,
    notes: String(res.notes ?? ""),
  };
}
