# CareLine — Voice AI Receptionist

A voice agent that acts as the front desk for **Manipal Hospital, Old Airport Road, Bengaluru**. Patients call in, speak naturally, and walk away with an appointment **booked, rescheduled, or cancelled** — no human in the loop. It reasons like an agent, holds up when things go sideways mid-call, and refuses to schedule when someone describes an emergency.

> Built for the 2care.ai Voice AI Engineering assignment.
> Live demo: **[your-deployment-url]** · Loom: **[link]**

---

## What I built

- **A voice agent (Retell)** that handles the full appointment lifecycle — booking, rescheduling, cancellation, and conflict resolution when a slot isn't available. It copes with vague requests ("my knee hurts"), mid-conversation changes of mind ("actually, the afternoon"), and recovers gracefully when a slot is taken.
- **A real backend** (Next.js API + Postgres on Supabase) exposing five typed tools. Appointments are real rows; conflicts are checked against a real database; double-booking is prevented by a DB constraint, not hopeful code.
- **Real clinic data** — 26 real doctors across 14 departments, scraped/sourced from Manipal's public directory. Provenance is documented in [`data/clinic.json`](data/clinic.json) (`_meta`): names, departments, designations, and fees are real; only per-doctor slot *times* are reconstructed (hospitals don't publish those) and the concrete slots are generated from them.
- **An eval harness** — a re-runnable pipeline that drives simulated patients through the *real* agent tool-loop against the *real* backend and scores the outcome. `npm run eval`.
- **2care-flavoured extras**: an **emergency safety guardrail** (won't book a chest-pain caller — escalates to 108), **symptom→department routing**, and **WhatsApp confirmations** (their actual channel).

## Why the key choices

| Choice | Why |
|---|---|
| **Retell** over Bolna | The hard constraint is "we must be able to independently call the agent." Retell's web-call widget makes the deployed URL a one-click call with zero telephony setup. Backend is platform-agnostic, so swapping to Bolna touches only the agent layer. ([ARCHITECTURE §2](ARCHITECTURE.md)) |
| **Slots as real DB rows** | Makes "is this free?" one indexed query and makes double-booking a `unique` constraint. Turns a demo into something that survives concurrency and re-runs. |
| **Agent never touches the DB** | It calls five typed HTTPS tools that return short, *speakable* results. Keeps the prompt lean and the payloads small → lower latency. |
| **Lean prompt, knowledge in tools** | The doctor list lives in the DB, not the prompt — so the prompt stays short (fast to process) and never goes stale. ([`agent/prompt.md`](agent/prompt.md)) |
| **Harness hits the real endpoints** | What we test is what runs in production. The only gap is the audio layer — stated plainly below. |

## Generic engine, per-clinic config

The clinic is **data, not code**. The entire engine — tools, conflict-checking, slot generation, symptom routing, the emergency guardrail, the eval harness — reads from the database and knows nothing about Manipal specifically. Manipal lives in exactly two places: [`data/clinic.json`](data/clinic.json) (the real doctors, departments, and OPD hours) and a few branding strings (homepage title, the greeting, the emergency line).

**To repoint it at another hospital:** scrape that clinic's directory into a new `clinic.json`, run `npm run seed`, change ~3 branding strings, redeploy. The engine is unchanged.

This isn't over-engineering — it mirrors how a product like 2care actually runs: **one engine, deployed per hospital**, each with its own data and branding. The clinic is configuration; it's multi-tenant by construction (single-tenant *per deployment* — there's no self-serve "add a clinic" UI, which is the right scope here).

## Latency story

Voice UX lives or dies on turn latency. What the design does about it:

- **Small model, small prompt.** Tool-heavy, not reasoning-heavy → a fast model (GPT-4o-mini / Haiku) with a lean prompt keeps time-to-first-token low.
- **`speak_during_execution` on every DB tool** — the agent says "let me check…" so the tool round-trip is never dead air.
- **Fast tools.** Simple indexed Postgres queries; availability returns ≤ 5 ranked slots, never the whole grid. The harness records **backend tool latency per call** (see `eval/results/latest.json` → `backend_latency_ms_avg`); in local runs this is well under the ~300ms budget.
- **Nothing heavy on the hot path.** Transcript/call logging happens on the webhook *after* the call, not inside a tool the agent is waiting on.

> Measured turn latency from a live Retell call goes here after you deploy (see the Loom).

## Known limitations (honest)

- **The eval exercises reasoning + tools, not acoustics.** It won't catch an ASR mishearing "Dr. Rao" as "Dr. Rowe," or TTS prosody issues. That's the one thing only a live call tests — hence the Loom.
- **Slot *times* are reconstructed**, not scraped — hospitals don't publish per-doctor OPD minute-grids. Everything else in the dataset is real.
- **LLM-judge scores have variance.** They're clearly separated from the deterministic pass/fail (DB end-state + tool trace), which are the numbers that matter.
- **Persona coverage is finite** (8 scenarios). It targets the graded axes, not every possible caller.
- **WhatsApp send is simulated** unless `WHATSAPP_TOKEN`/`WHATSAPP_PHONE_ID` are set — it logs the exact message it would send.

---

## Run it

### 1. Backend + database (local)
```bash
cp .env.example .env        # fill in Supabase + LLM keys
npm install
# create the schema: paste db/schema.sql into the Supabase SQL editor (or psql)
npm run seed                # loads real clinic data + generates the slot grid
npm run dev                 # backend live at http://localhost:3000
```

### 2. Eval harness (re-runnable by you)
```bash
# needs the backend running (CARELINE_BASE_URL) + an LLM key (EVAL_LLM_API_KEY)
npm run eval                # runs all scenarios, prints a table
npm run eval book-happy     # run a single scenario by id
# → results written to eval/results/latest.json
```

### 3. Voice agent + live deploy
Full walkthrough in **[docs/DEPLOY.md](docs/DEPLOY.md)** — deploy to Vercel, create the Retell agent from [`agent/`](agent), wire the tools + webhook, and the web-call button on the homepage goes live.

## Repo map
```
app/api/tools/*          five tool endpoints (check/book/reschedule/cancel/lookup)
app/api/retell-webhook   call logging (off the hot path)
app/api/web-call         creates a Retell web call → one-click demo on the homepage
lib/                     db, slot logic, NLP date/dept/emergency, service logic, whatsapp
data/clinic.json         REAL Manipal data + provenance
data/scraper/scrape.ts   sourcing pipeline
db/schema.sql · seed.ts  schema + seeding
agent/                   prompt.md, tools.json, config.md  (paste into Retell)
eval/                    harness, scenarios, simulated patient, metrics
ARCHITECTURE.md          the full design record
```

See **[ARCHITECTURE.md](ARCHITECTURE.md)** for the deep version of every decision above.
