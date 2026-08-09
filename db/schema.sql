-- CareLine — Postgres schema (Supabase)
-- Source of truth for the voice agent. Seeded from REAL scraped clinic data
-- (see data/clinic.json + db/seed.ts). Slots are concrete rows so that
-- "is this free?" is an indexed query and double-booking is a DB guarantee.

-- ── extensions ────────────────────────────────────────────────────────────
create extension if not exists "pgcrypto";   -- gen_random_uuid()

-- ── departments ───────────────────────────────────────────────────────────
create table if not exists departments (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,           -- e.g. "Cardiology"
  synonyms    text[] not null default '{}',   -- ["heart", "cardiac"] for matching
  created_at  timestamptz not null default now()
);

-- ── doctors ───────────────────────────────────────────────────────────────
create table if not exists doctors (
  id             uuid primary key default gen_random_uuid(),
  full_name      text not null,               -- real doctor name from clinic
  department_id  uuid not null references departments(id) on delete cascade,
  designation    text,                         -- "Senior Consultant", etc.
  teleconsult    boolean not null default false,
  active         boolean not null default true,
  created_at     timestamptz not null default now()
);
create index if not exists idx_doctors_department on doctors(department_id);

-- ── appointment types ─────────────────────────────────────────────────────
create table if not exists appointment_types (
  id           uuid primary key default gen_random_uuid(),
  code         text not null unique,           -- 'new' | 'followup' | 'tele'
  label        text not null,                  -- "New consultation"
  duration_min int  not null                   -- drives slot granularity
);

-- ── doctor_slots ──────────────────────────────────────────────────────────
-- One row per bookable slot. Generated from each doctor's REAL OPD days/hours.
-- status: 'open' | 'booked' | 'blocked'
create table if not exists doctor_slots (
  id           uuid primary key default gen_random_uuid(),
  doctor_id    uuid not null references doctors(id) on delete cascade,
  starts_at    timestamptz not null,
  ends_at      timestamptz not null,
  status       text not null default 'open'
                 check (status in ('open','booked','blocked')),
  created_at   timestamptz not null default now(),
  -- a doctor can never have two slots starting at the same instant
  unique (doctor_id, starts_at)
);
create index if not exists idx_slots_lookup
  on doctor_slots(doctor_id, starts_at, status);
create index if not exists idx_slots_open
  on doctor_slots(status, starts_at) where status = 'open';

-- ── patients ──────────────────────────────────────────────────────────────
-- Created/looked up by phone number during a call.
create table if not exists patients (
  id           uuid primary key default gen_random_uuid(),
  phone        text not null unique,           -- E.164, the identity key
  full_name    text,
  created_at   timestamptz not null default now()
);

-- ── appointments ──────────────────────────────────────────────────────────
-- status: 'booked' | 'rescheduled' | 'cancelled'
create table if not exists appointments (
  id            uuid primary key default gen_random_uuid(),
  patient_id    uuid not null references patients(id) on delete cascade,
  doctor_id     uuid not null references doctors(id) on delete cascade,
  slot_id       uuid not null references doctor_slots(id),
  type_code     text not null references appointment_types(code),
  status        text not null default 'booked'
                  check (status in ('booked','rescheduled','cancelled')),
  reason        text,                           -- free-text chief complaint
  source        text not null default 'voice',  -- 'voice' | 'eval' | 'web'
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists idx_appts_patient on appointments(patient_id);
-- a live slot can back at most one live appointment → no double-booking
create unique index if not exists uniq_live_slot
  on appointments(slot_id) where status in ('booked','rescheduled');

-- ── call_logs ─────────────────────────────────────────────────────────────
-- Written by /api/retell-webhook after the call. Off the hot path.
create table if not exists call_logs (
  id           uuid primary key default gen_random_uuid(),
  call_id      text unique,                    -- Retell call id
  from_number  text,
  transcript   jsonb,                          -- full turn-by-turn
  tool_trace   jsonb,                          -- tools called + latencies
  outcome      text,                           -- 'booked'|'rescheduled'|...
  started_at   timestamptz,
  ended_at     timestamptz,
  created_at   timestamptz not null default now()
);

-- ── helper: keep updated_at fresh on appointments ─────────────────────────
create or replace function touch_updated_at() returns trigger as $$
begin new.updated_at = now(); return new; end;
$$ language plpgsql;

drop trigger if exists trg_touch_appts on appointments;
create trigger trg_touch_appts before update on appointments
  for each row execute function touch_updated_at();
