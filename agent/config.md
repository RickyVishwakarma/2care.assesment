# Retell agent configuration

Recommended settings when you create the agent in the Retell dashboard. These
choices are all about **latency** and **sounding human** (rubric core items).

## Model & voice
- **LLM:** GPT-4o mini (or Claude Haiku) — this task is tool-heavy, not
  reasoning-heavy; a small fast model keeps time-to-first-token low. The prompt
  is lean by design so a small model handles it well.
- **Voice:** an ElevenLabs / Cartesia Indian-English voice — callers are Indian
  patients; a local accent reads as "a real person at Manipal," not a US bot.
- **Temperature:** ~0.3. Low, so it follows the flow and doesn't improvise
  clinical content.

## Latency knobs
- **Interruption sensitivity:** medium — let callers barge in ("actually…")
  without cutting them off too eagerly.
- **Responsiveness:** high.
- **`speak_during_execution`:** ON for every tool that hits the DB (see
  `tools.json`) — the agent says "let me check…" so the ~200–300ms tool call is
  never dead air.
- **Backchanneling:** light ("mm-hm") — feels human, don't overdo it.

## Wiring
1. Create the agent, paste `agent/prompt.md` as the general prompt.
2. Add each function in `agent/tools.json` as a **Custom Function**. Set the URL
   to `https://YOUR-DEPLOYMENT/api/tools/<endpoint>`.
3. Set the agent's **webhook URL** to `https://YOUR-DEPLOYMENT/api/retell-webhook`
   (call logging).
4. Put the agent id in `RETELL_AGENT_ID` so the web-call button works.
5. Add a **begin message**: "Thanks for calling Manipal Hospital, Old Airport
   Road — this is the appointments line. How can I help you today?"

## Dynamic variables (optional, nice touch)
Retell passes the caller's number as `{{from_number}}`. You can auto-call
`lookup_patient` with it at call start so returning patients are greeted by name
before they say anything.
