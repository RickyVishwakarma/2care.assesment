// Shared domain types. The tool endpoints, seed, and eval harness all speak
// these — one vocabulary across the whole system.

export type AppointmentTypeCode = "new" | "followup" | "tele";

export interface Department {
  id: string;
  name: string;
  synonyms: string[];
}

export interface Doctor {
  id: string;
  full_name: string;
  department_id: string;
  designation: string | null;
  teleconsult: boolean;
  active: boolean;
}

export interface Slot {
  id: string;
  doctor_id: string;
  starts_at: string; // ISO
  ends_at: string; // ISO
  status: "open" | "booked" | "blocked";
}

export interface Patient {
  id: string;
  phone: string;
  full_name: string | null;
}

export interface Appointment {
  id: string;
  patient_id: string;
  doctor_id: string;
  slot_id: string;
  type_code: AppointmentTypeCode;
  status: "booked" | "rescheduled" | "cancelled";
  reason: string | null;
  source: string;
}

// ── Tool response envelope ────────────────────────────────────────────────
// Every tool returns { ok, speak, data? }. `speak` is a short, ready-to-say
// line the voice model can read aloud without post-processing — this keeps the
// prompt lean and the latency low (§5/§6 of ARCHITECTURE).
export interface ToolResult<T = unknown> {
  ok: boolean;
  speak: string;
  code?:
    | "ok"
    | "conflict"
    | "not_found"
    | "no_availability"
    | "invalid"
    | "emergency"; // healthcare safety escalation (2care-style guardrail)
  data?: T;
}
