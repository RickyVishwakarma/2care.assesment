# Loom Script — CareLine (≤ 3:00)

A word-for-word script for the demo video. The brief asks for a live call against
the deployed product plus a ~60s design walkthrough.

## Before recording — open these tabs, in order
1. Live site: `https://2care-assesment.vercel.app`
2. GitHub repo
3. Supabase → Table Editor → `appointments` (for the proof shot)
4. VS Code with: `ARCHITECTURE.md`, `lib/service.ts`, `agent/prompt.md`

Test your mic. Speak clearly. Pauses are fine — don't rush.

---

## [0:00–0:12] Intro — on the live site
> "Hi, I'm Ricky. This is CareLine — a voice AI receptionist for Manipal Hospital,
> Old Airport Road, built on Retell. It books, reschedules, and cancels real
> appointments over a phone call. Let me show a live call, then how it's built."

## [0:12–1:40] The live call (the money shot)
> "I'll click 'Call the receptionist' and just talk to it like a phone call."

- **CLICK** the button, allow mic.
- **You:** "Hi, I need to see a cardiologist this week."
- (it offers slots) **You:** "Let's do the earliest one."
- (it asks name/number) **You:** "My name's Ricky, my number's 9-8-…"
- (it confirms + books)

> "So it understood a vague request, routed me to Cardiology, checked real
> availability, and booked it — no human involved."

## [1:40–1:58] Prove it's real — switch to Supabase
> "This isn't a mock — here's that exact appointment in the live Postgres
> database: my name, Dr. S S Iyengar, the time, booked from a voice call."

## [1:58–2:48] Design walkthrough — switch to VS Code
> "On the design. **[ARCHITECTURE.md]** Three separable pieces — the Retell agent,
> a Next.js backend on Vercel, and an eval harness — all hitting the same real
> endpoints."

> "I chose Retell for the lowest-friction path to a live, callable agent.
> **[service.ts]** The agent never touches the database — it calls five typed
> tools, and booking a slot is a database guarantee, so two callers can't grab
> the same time."

> "**[prompt.md]** The prompt is deliberately lean — the doctor list lives in the
> database, not the prompt, so it never goes stale. And there's a safety
> guardrail: describe an emergency like chest pain and it refuses to book and
> points you to 108."

> "On latency — tool calls return in about 150 ms, and the agent speaks a filler
> line while they run, so the caller never hears dead air."

## [2:48–3:00] Close
> "Everything's real data, it's deployed and independently callable, and there's a
> re-runnable eval harness and a one-command functional test in the repo. Thanks."

---

## Tips
- If the call misfires, end and restart — don't narrate the stumble. Do 2–3 takes.
- Practice the call once before recording.
- The walkthrough is where people overrun. If you're at 2:30 after the call, cut
  it to just Retell + the emergency guardrail.
