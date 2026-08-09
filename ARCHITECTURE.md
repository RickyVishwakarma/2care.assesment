# CareLine — Architecture

> Voice AI receptionist for a real hospital. Patients call in, speak naturally,
> and leave with an appointment **booked, rescheduled, or cancelled** — no human
> in the loop.

This document is the design record for the 2care.ai Voice AI Engineering
assignment. It explains **what** the system is, **how** the pieces fit, and
**why** each choice was made — including where the design deliberately stops.

---

## 1. High-level shape

```
                      ┌─────────────────────────────────────────────┐
   PSTN / Web call    │                RETELL AI                    │
  ┌───────────┐       │  ┌──────────┐  ┌───────────┐  ┌──────────┐  │
  │  Patient  │◀─────▶│  │   ASR    │─▶│    LLM    │─▶│   TTS    │  │
  │  (voice)  │  audio│  │(deepgram)│  │ (agent +  │  │(11labs / │  │
  └───────────┘       │  └──────────┘  │  prompt)  │  │ cartesia)│  │
                      │                └─────┬─────┘  └──────────┘  │
                      └──────────────────────┼──────────────────────┘
                                             │ tool calls (HTTPS, JSON)
                                             ▼
                      ┌─────────────────────────────────────────────┐
                      │        BACKEND  (Next.js API on Vercel)      │
                      │                                              │
                      │  /api/tools/check-availability               │
                      │  /api/tools/book-appointment                 │
                      │  /api/tools/reschedule-appointment           │
                      │  /api/tools/cancel-appointment               │
                      │  /api/tools/lookup-patient                   │
                      │  /api/retell-webhook   (call lifecycle logs) │
                      └──────────────────────┬───────────────────────┘
                                             │ SQL (RLS off, service key)
                                             ▼
                      ┌─────────────────────────────────────────────┐
                      │          SUPABASE  (Postgres)                │
                      │  departments · doctors · doctor_slots        │
                      │  patients · appointments · call_logs         │
                      │  ↑ seeded from REAL scraped hospital data    │
                      └─────────────────────────────────────────────┘

   ┌──────────────────────────────────────────────────────────────┐
   │  EVAL HARNESS  (TypeScript, `npm run eval`)                   │
   │  simulated-patient LLM  ⇄  agent reason+tool loop  ⇄  backend │
   │  → scores scenarios → eval/results/*.json + console report    │
   └──────────────────────────────────────────────────────────────┘
```

**Three independently-runnable pieces:** the voice agent (Retell), the backend
(Vercel + Supabase), and the eval harness. The backend is the source of truth;
both the voice agent and the harness hit the *same* endpoints, so the harness
tests the real booking logic, not a mock.

---

## 2. Why Retell (not Bolna)

The rubric explicitly rewards a **live, independently-callable** agent and a
**justified** stack choice. Trade-off:

| Dimension | Retell (chosen) | Bolna |
|---|---|---|
| Independently callable by reviewer | **Web-call widget + shareable link, zero telephony setup** | Needs Twilio number provisioning |
| Latency | Managed, tuned ASR→LLM→TTS pipeline, ~800ms–1s turn latency out of the box | Comparable, but you own the tuning |
| Function calling | First-class, typed, per-tool timeouts | Supported, more manual wiring |
| Setup time (2–3 day budget) | Low — config + webhook | Higher — self-host / infra |
| "We own the stack" story | Weaker (managed) | Stronger (open source) |

**Decision:** For a 2–3 day assignment whose #1 hard constraint is *"if we can't
independently call the agent and have it work, it doesn't count,"* Retell's
web-call link is the single biggest de-risker. Bolna's advantage (owning the
pipeline) matters more at company scale than in a 3-day proof. The latency story
(§5) is built around Retell's primitives.

> If asked to migrate to Bolna later, only the **agent layer** changes. The
> backend, schema, tool contracts, and eval harness are platform-agnostic — that
> separation is deliberate.

---

## 3. Data model

Real clinic data (see `data/clinic.json`, sourced in the data step) seeds:

- **departments** — real departments/specialties of the chosen hospital.
- **doctors** — real doctor names, their department, and consultation type(s).
- **doctor_slots** — realistic slot grid *generated* from each doctor's real
  OPD days/hours (public), at a fixed slot granularity (e.g. 15/20 min).
  Slots are concrete rows so conflict-checking is a real DB constraint, not
  in-memory guesswork.
- **appointment_types** — new consult / follow-up / teleconsult, with durations.
- **patients** — created/looked up by phone number during a call.
- **appointments** — the booking records; unique constraint prevents double
  booking the same slot.
- **call_logs** — every call's transcript + tool-call trace (from the webhook),
  used for debugging and for the eval harness to inspect.

> **Why real slot *rows* instead of computing availability on the fly:** it makes
> "is this slot free?" a single indexed query and a DB uniqueness guarantee,
> which is exactly what turns a demo into something that survives concurrent
> bookings and re-runs. Conflicts are checked against something real, per the
> constraint in the brief.

Full DDL: [`db/schema.sql`](db/schema.sql).

---

## 4. Tool contracts (agent ↔ backend)

The agent never touches the DB directly — it calls typed HTTPS tools. Each is an
idempotent-where-possible JSON endpoint.

| Tool | Purpose | Key inputs | Returns |
|---|---|---|---|
| `lookup-patient` | Find/greet returning patient by phone | `phone` | patient + upcoming appts |
| `check-availability` | Find open slots | `department`/`doctor`, `date_hint`, `type` | ranked open slots |
| `book-appointment` | Reserve a slot | `doctor_id`, `slot_id`, `patient`, `type` | confirmation / conflict |
| `reschedule-appointment` | Move an existing appt | `appointment_id`, `new_slot_id` | confirmation / conflict |
| `cancel-appointment` | Cancel | `appointment_id` | confirmation |

Design rules:
- **Every tool returns a compact, speakable result** (short strings the LLM can
  read aloud), plus structured fields. No raw SQL rows dumped into the prompt.
- **Conflicts are first-class return values**, not errors — so the agent can
  recover gracefully ("that 4pm just went — I have 4:20 or 5, which works?").
- **Server is authoritative.** If two calls race for a slot, the DB uniqueness
  constraint makes exactly one win; the loser gets a `conflict` response the
  agent handles conversationally.

---

## 5. Latency story

Voice UX lives or dies on turn latency. Targets and how we hit them:

1. **Keep the model's job small.** The prompt is lean (§6) and tools return
   pre-digested, speakable data → fewer tokens in and out → faster first token.
2. **Fast tool round-trips.** Endpoints are simple indexed Postgres queries on
   Supabase, co-located region, no N+1. Target **< 300ms** server time per tool
   call so the agent can speak a filler ("let me check that…") and have the
   answer back before it finishes the sentence.
3. **Bounded availability results.** `check-availability` returns at most a
   handful of ranked slots, never the whole grid — small payloads, small
   spoken responses.
4. **Streaming end-to-end** via Retell (partial ASR → LLM streaming → TTS
   streaming). We measure and report actual turn latency in the README.
5. **No blocking work on the hot path.** Call logging / transcript persistence
   happens on the webhook (post-turn), never inside a tool the agent is waiting
   on.

Measured numbers go in the README after deploy; the harness also records backend
tool latency per call.

---

## 6. Prompt philosophy (clean, not bloated)

The rubric weights *"how clean is the prompt — does it work without bloat."*
Principles for [`agent/prompt.md`](agent/prompt.md):

- **Role + rules + tools, nothing else.** No few-shot dialogue dumps; the model
  is capable enough with crisp instructions and good tool schemas.
- **State the recovery behaviors explicitly** (slot taken, patient changes mind,
  vague date, wrong department) because those are the graded "things go wrong"
  cases — but as short rules, not scripts.
- **Push knowledge into tools, not the prompt.** The doctor list lives in the DB
  and is reached via `check-availability`, so the prompt doesn't balloon with
  data and never goes stale.
- **Guardrails:** never invent slots/doctors, confirm before mutating, read back
  the final appointment.

---

## 7. Eval harness — what "performs well" means

Fully in [`eval/`](eval), run with `npm run eval`, re-runnable by the reviewer.

**Dimensions (and why each):**

| Dimension | What it measures | Why it matters here |
|---|---|---|
| **Task success** | Did the intended appointment end up correctly in the DB? | The one outcome the patient actually cares about. |
| **Tool correctness** | Right tools, right args, right order | A fluent agent that calls the wrong tool still fails the patient. |
| **Error recovery** | Behavior when a slot is taken / info is missing / user changes mind | Directly the graded "things go wrong" axis. |
| **Turn efficiency** | # of turns to resolution | Proxy for latency-of-experience and prompt quality. |
| **Grounding** | Zero invented doctors/slots | Safety in a healthcare context. |

**How it works:** a *simulated-patient* LLM plays scripted personas (decisive,
vague, mind-changer, impatient, conflict-forced). Each turn, the agent's
reason+tool loop runs against the **real backend**, mutating a test schema. After
each scenario, an assertion layer checks the DB end-state and the tool trace, and
an LLM-judge scores conversational recovery. Results → `eval/results/*.json` +
console table.

**Where it falls short (stated honestly):** it exercises the *text/reasoning +
tool* layer, not ASR/TTS acoustics — it won't catch mishearing "Dr. Rao" as "Dr.
Rowe." Persona coverage is finite. The LLM-judge introduces some variance
(mitigated by fixed seeds + rubric). These limits are documented in the README so
the reviewer knows exactly what the numbers do and don't certify.

---

## 8. Repo layout

```
careline/
  ARCHITECTURE.md          ← this file
  README.md                ← what/why/latency/limitations + run steps
  app/api/tools/*          ← the 5 tool endpoints
  app/api/retell-webhook/  ← call lifecycle + transcript logging
  lib/                     ← db client, slot logic, shared types
  data/scraper/            ← the real-clinic scraper
  data/clinic.json         ← scraped real data (checked in)
  db/schema.sql            ← Postgres DDL
  db/seed.ts               ← loads clinic.json + generates slot grid
  agent/prompt.md          ← the system prompt
  agent/tools.json         ← Retell function schema (mirrors §4)
  agent/config.md          ← Retell setup: voice, model, timeouts
  eval/                    ← harness, scenarios, metrics, results/
  docs/                    ← deploy guide, Loom script
```

## 9. Boundaries of responsibility

| I build & verify | You operate (with my exact steps) |
|---|---|
| Backend, schema, seed, tools, prompt, tool schema, eval harness, README | Create Retell account + API key |
| Local run + eval results | Deploy to Vercel + Supabase (your accounts) |
| Deploy guide + Loom script | Paste keys, wire Retell webhook, record Loom |

Accounts, credentials, deploys, and the demo recording are yours by design — the
handoff points are all documented in [`docs/`](docs).
