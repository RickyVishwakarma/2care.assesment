# Loom script (≤ 3 minutes)

The brief: a live demo of a call going through + a 60-second walkthrough of
design decisions. Record against the **deployed** app, not localhost.

## Before you hit record
- Deployed app open on the homepage.
- Supabase `appointments` table open in a second tab (to show the row appear).
- `eval/results/latest.json` or the eval terminal output ready to flash.
- Mic tested; quiet room.

## Part 1 — Live call (~90s)
1. **(10s)** "This is CareLine — a voice receptionist for Manipal Hospital, Old
   Airport Road. Real doctors, real backend. Let me call it." Click **Call**.
2. **(50s)** Do a booking that shows off reasoning + recovery. Suggested script:
   - You: "Hi, my knee's been hurting, I'm not sure who to see." → agent routes
     to Orthopaedics and offers a real doctor/slot. *(shows symptom routing)*
   - You: "Actually, do you have something in the afternoon?" → agent adapts.
     *(shows change-of-mind recovery)*
   - You: "Yeah, book that. My number's +9198…" → agent confirms and books.
3. **(15s)** Switch to Supabase: point at the new `appointments` row and the
   freed/booked `doctor_slots`. "That's a real row — not hardcoded JSON."
4. **(15s, optional)** Quick emergency line: "I have severe chest pain" → agent
   refuses to book and points to 108. "Safety guardrail — it won't schedule an
   emergency."

## Part 2 — Design decisions (~60s)
Talk over the ARCHITECTURE diagram:
- **"Three separable pieces"** — agent, backend, eval — all hitting the same
  real endpoints. So the eval tests production logic, not a mock.
- **"Why Retell"** — web-call link = reviewer can call it with zero setup;
  backend is platform-agnostic so Bolna would be a small swap.
- **"Latency"** — lean prompt, speakable tool results, `speak_during_execution`
  fillers, and I measure backend tool latency in the harness (say the number).
- **"Eval"** — simulated patients (decisive, vague, mind-changer, emergency)
  driven through the real tool loop; I score DB end-state + tool trace
  deterministically, and add a softer LLM-judge for recovery/naturalness.
- **"Known gap"** — the harness doesn't test ASR/TTS acoustics; that's what this
  live call is for. *(Naming your own limitation reads as senior.)*

## Tips
- Keep it under 3:00 — they said max 3 minutes; going over reads as not editing.
- One clean take of the call beats three messy ones. If it fumbles, re-record.
- Say the actual latency number out loud — it shows you measured, not guessed.
