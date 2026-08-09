// Read-only-ish Supabase client the harness uses to ASSERT the database
// end-state after each scenario, and to set up forced-conflict scenarios. This
// is independent of the tool endpoints on purpose: we check the ground truth in
// the DB, not the agent's word for it.
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
if (!url || !key) throw new Error("Eval needs NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY");
export const edb = createClient(url, key, { auth: { persistSession: false } });

export async function liveAppointmentsFor(phone: string) {
  const { data: patient } = await edb.from("patients").select("id").eq("phone", phone).maybeSingle();
  if (!patient) return [];
  const { data } = await edb
    .from("appointments")
    .select("id, status, doctor:doctors(full_name, department:departments(name)), slot:doctor_slots(starts_at)")
    .eq("patient_id", patient.id)
    .in("status", ["booked", "rescheduled"]);
  return data ?? [];
}

export async function allAppointmentsFor(phone: string) {
  const { data: patient } = await edb.from("patients").select("id").eq("phone", phone).maybeSingle();
  if (!patient) return [];
  const { data } = await edb
    .from("appointments")
    .select("id, status, doctor:doctors(full_name), slot:doctor_slots(starts_at)")
    .eq("patient_id", patient.id);
  return data ?? [];
}

// Occupy the earliest open slot of a department (to force a conflict scenario).
// Returns a speakable description of what we blocked, or null.
export async function occupyEarliestSlot(departmentName: string): Promise<string | null> {
  const { data: dept } = await edb.from("departments").select("id").eq("name", departmentName).maybeSingle();
  if (!dept) return null;
  const { data: docs } = await edb.from("doctors").select("id, full_name").eq("department_id", dept.id);
  if (!docs?.length) return null;
  const { data: slot } = await edb
    .from("doctor_slots")
    .select("id, starts_at, doctor_id")
    .in("doctor_id", docs.map((d) => d.id))
    .eq("status", "open")
    .gte("starts_at", new Date().toISOString())
    .order("starts_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (!slot) return null;
  await edb.from("doctor_slots").update({ status: "blocked" }).eq("id", slot.id);
  const doc = docs.find((d) => d.id === slot.doctor_id);
  return `${doc?.full_name} @ ${slot.starts_at}`;
}

// Pre-book an appointment for a patient (used to set up reschedule/cancel
// scenarios). Returns the created appointment id + a description.
export async function prebook(
  phone: string,
  name: string,
  departmentName: string
): Promise<{ appointment_id: string; description: string } | null> {
  const { data: dept } = await edb.from("departments").select("id").eq("name", departmentName).maybeSingle();
  if (!dept) return null;
  const { data: docs } = await edb.from("doctors").select("id, full_name").eq("department_id", dept.id);
  if (!docs?.length) return null;
  const { data: slot } = await edb
    .from("doctor_slots")
    .select("id, starts_at, doctor_id")
    .in("doctor_id", docs.map((d) => d.id))
    .eq("status", "open")
    .gte("starts_at", new Date().toISOString())
    .order("starts_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (!slot) return null;

  const { data: patient } = await edb
    .from("patients")
    .upsert({ phone, full_name: name }, { onConflict: "phone" })
    .select("id")
    .single();
  await edb.from("doctor_slots").update({ status: "booked" }).eq("id", slot.id);
  const { data: appt } = await edb
    .from("appointments")
    .insert({ patient_id: patient!.id, doctor_id: slot.doctor_id, slot_id: slot.id, type_code: "new", source: "eval" })
    .select("id")
    .single();
  const doc = docs.find((d) => d.id === slot.doctor_id);
  return { appointment_id: appt!.id, description: `${doc?.full_name} @ ${slot.starts_at}` };
}

// Clean a test patient's footprint so scenarios are repeatable.
export async function resetPatient(phone: string) {
  const { data: patient } = await edb.from("patients").select("id").eq("phone", phone).maybeSingle();
  if (!patient) return;
  const { data: appts } = await edb.from("appointments").select("slot_id").eq("patient_id", patient.id);
  for (const a of appts ?? []) {
    await edb.from("doctor_slots").update({ status: "open" }).eq("id", a.slot_id);
  }
  await edb.from("appointments").delete().eq("patient_id", patient.id);
  await edb.from("patients").delete().eq("id", patient.id);
}
