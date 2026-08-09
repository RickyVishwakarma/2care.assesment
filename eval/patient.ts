// The simulated patient. An LLM plays a persona (decisive, vague, mind-changer,
// impatient, emergency) and talks to the agent. It ends the call by emitting
// [[END]] when its goal is met or clearly unreachable.
import { chat, type ChatMessage } from "./llm";

export const END = "[[END]]";

export async function simulatePatient(
  persona: string,
  agentHistory: { role: "assistant" | "user"; content: string }[]
): Promise<string> {
  // Flip perspective: to the patient-LLM, the AGENT is the "user" it's replying
  // to, and the patient's own prior lines are "assistant".
  const flipped: ChatMessage[] = agentHistory.map((h) => ({
    role: h.role === "assistant" ? "user" : "assistant",
    content: h.content,
  }));

  const system: ChatMessage = {
    role: "system",
    content:
      `${persona}\n\n` +
      `You are the PATIENT calling a hospital receptionist. Speak naturally, one short line at a time, ` +
      `like a real phone call. Give information only as asked; don't dump everything at once. ` +
      `When your goal is achieved OR it's clearly not going to happen, reply with exactly ${END} and nothing else.`,
  };

  // On the opener there are no agent turns yet. Some providers (Gemini's
  // OpenAI-compat layer) reject a system-only request with no user content, so
  // seed an explicit cue for the patient's first line.
  const convo: ChatMessage[] =
    flipped.length === 0
      ? [{ role: "user", content: "[The receptionist has just answered the phone. Say your opening line.]" }]
      : flipped;

  const msg = await chat([system, ...convo], undefined, { temperature: 0.7 });
  return (msg.content ?? "").trim();
}
