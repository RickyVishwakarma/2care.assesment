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

  const msg = await chat([system, ...flipped], undefined, { temperature: 0.7 });
  return (msg.content ?? "").trim();
}
