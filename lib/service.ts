// Business logic for every tool. Route handlers stay thin; this is where the
// booking rules, conflict checks, and speakable responses live. The eval
// harness calls these same functions via the HTTP endpoints, so what we test is
// what runs in production.
import { db } from "./db";
import {
  speakSlot,
  matchDepartment,
  resolveDateHint,
  isEmergency,
} from "./slots";
import { sendWhatsAppConfirmation } from "./whatsapp";
import type { ToolResult, AppointmentTypeCode } from "./types";

const EMERGENCY_SPEAK =
  "This sounds like it may be an emergency. I'm not able to handle emergencies over booking — " +
  "please call 108 for an ambulance right away, or go to the Manipal emergency department, which is open 24/7. " +
  "Is there anything non-urgent I can help you schedule?";

// ── lookup-patient ─────────────────────────────────────────────────────────
export async function lookupPatient(phone: string): Promise<ToolResult> {
  if (!phone) return { ok: false, code: "invalid", speak: "I didn't catch a phone number." };
  const { data: patient } = await db
    .from("patients")
    .select("id, phone, full_name")
    .eq("phone", phone)
    .maybeSingle();

  if (!patient) {
    return {
      ok: true,
      code: "not_found",
      speak: "I don't see you in our records yet — I'll set you up as a new patient. May I have your name?",
      data: { known: false },
    };
  }

  const { data: appts } = await db
    .from("appointments")
    .select("id, status, type_code, slot_id, doctor_id, doctor:doctors(full_name), slot:doctor_slots(starts_at)")
    .eq("patient_id", patient.id)
    .in("status", ["booked", "rescheduled"])
    .order("created_at", { ascending: false });

  const upcoming = (appts ?? []).map((a) => ({
    appointment_id: a.id,
    // @ts-expect-error supabase nested select typing
    doctor: a.doctor?.full_name,
    // @ts-expect-error supabase nested select typing
    when: a.slot?.starts_at ? speakSlot(a.slot.starts_at) : null,
  }));

  const speak = upcoming.length
    ? `Welcome back, ${patient.full_name ?? "there"}. You have ${upcoming.length} upcoming appointment${upcoming.length > 1 ? "s" : ""}. How can I help?`
    : `Welcome back, ${patient.full_name ?? "there"}. How can I help you today?`;

  return { ok: true, code: "ok", speak, data: { known: true, patient, upcoming } };
}

// ── check-availability ──────────────────────────────────────────────────────
export async function checkAvailability(input: {
  department?: string;
  doctor?: string;
  symptom?: string;
  date_hint?: string;
  type?: AppointmentTypeCode;
}): Promise<ToolResult> {
  // Safety first: never route an emergency into a booking flow.
  if (input.symptom && isEmergency(input.symptom)) {
    return { ok: false, code: "emergency", speak: EMERGENCY_SPEAK };
  }

  const { data: departments } = await db.from("departments").select("id, name, synonyms");
  const depts = departments ?? [];

  // Resolve which department we're searching, from an explicit name or a symptom.
  let deptName = input.department
    ? matchDepartment(input.department, depts)
    : null;
  if (!deptName && input.symptom) deptName = matchDepartment(input.symptom, depts);

  // Build the doctor filter.
  let doctorQuery = db.from("doctors").select("id, full_name, teleconsult, department_id, departments(name)").eq("active", true);
  if (input.doctor) {
    doctorQuery = doctorQuery.ilike("full_name", `%${input.doctor.replace(/^dr\.?\s*/i, "")}%`);
  } else if (deptName) {
    const dept = depts.find((d) => d.name === deptName);
    if (dept) doctorQuery = doctorQuery.eq("department_id", dept.id);
  } else {
    return {
      ok: false,
      code: "invalid",
      speak: "Which department or doctor would you like — for example Cardiology, Orthopaedics, or a specific doctor's name?",
    };
  }

  const { data: doctors } = await doctorQuery;
  if (!doctors || doctors.length === 0) {
    return { ok: true, code: "not_found", speak: `I couldn't find a match there. Could you tell me the department or doctor again?` };
  }

  const wantsTele = input.type === "tele";
  const eligible = wantsTele ? doctors.filter((d) => d.teleconsult) : doctors;
  if (eligible.length === 0) {
    return { ok: true, code: "no_availability", speak: `None of those doctors offer teleconsultation. Would an in-person visit work instead?` };
  }

  const { from, to } = resolveDateHint(input.date_hint, new Date());
  const { data: slots } = await db
    .from("doctor_slots")
    .select("id, doctor_id, starts_at")
    .in("doctor_id", eligible.map((d) => d.id))
    .eq("status", "open")
    .gte("starts_at", from.toISOString())
    .lt("starts_at", to.toISOString())
    .order("starts_at", { ascending: true })
    .limit(5);

  if (!slots || slots.length === 0) {
    return {
      ok: true,
      code: "no_availability",
      speak: `I don't have anything open ${input.date_hint ?? "in that window"}. Want me to check the next available day instead?`,
      data: { department: deptName, doctors: eligible.map((d) => d.full_name) },
    };
  }

  const byDoctor = new Map(eligible.map((d) => [d.id, d.full_name]));
  const options = slots.map((s) => ({
    slot_id: s.id,
    doctor_id: s.doctor_id,
    doctor: byDoctor.get(s.doctor_id),
    when: speakSlot(s.starts_at),
  }));

  const top = options[0];
  const speak =
    options.length === 1
      ? `I have ${top.doctor} at ${top.when}. Shall I book it?`
      : `The earliest I have is ${top.doctor} at ${top.when}. I also have ${options[1].when}${options[1].doctor !== top.doctor ? ` with ${options[1].doctor}` : ""}. Which works?`;

  return { ok: true, code: "ok", speak, data: { department: deptName, options } };
}

// ── book-appointment ────────────────────────────────────────────────────────
export async function bookAppointment(input: {
  slot_id: string;
  phone: string;
  patient_name?: string;
  type?: AppointmentTypeCode;
  reason?: string;
  source?: string;
}): Promise<ToolResult> {
  const { slot_id, phone } = input;
  if (!slot_id || !phone) return { ok: false, code: "invalid", speak: "I need a slot and your phone number to book." };

  // Re-check the slot is still open (someone may have taken it since we quoted).
  const { data: slot } = await db
    .from("doctor_slots")
    .select("id, doctor_id, starts_at, status, doctor:doctors(full_name)")
    .eq("id", slot_id)
    .maybeSingle();

  if (!slot) return { ok: false, code: "not_found", speak: "I couldn't find that slot anymore. Let me pull fresh options for you." };
  if (slot.status !== "open") {
    return { ok: false, code: "conflict", speak: "Ah — that slot was just taken. Let me find you the next closest time." };
  }

  // Upsert patient by phone.
  const { data: patient } = await db
    .from("patients")
    .upsert({ phone, full_name: input.patient_name ?? null }, { onConflict: "phone" })
    .select("id, full_name")
    .single();

  // Flip slot to booked. Because of the partial unique index on live
  // appointments(slot_id), a racing booker will fail the insert below.
  const { error: slotErr } = await db
    .from("doctor_slots")
    .update({ status: "booked" })
    .eq("id", slot_id)
    .eq("status", "open"); // guard: only if still open
  if (slotErr) return { ok: false, code: "conflict", speak: "That time just filled up — let me get you the next one." };

  const { data: appt, error: apptErr } = await db
    .from("appointments")
    .insert({
      patient_id: patient!.id,
      doctor_id: slot.doctor_id,
      slot_id,
      type_code: input.type ?? "new",
      reason: input.reason ?? null,
      source: input.source ?? "voice",
    })
    .select("id")
    .single();

  if (apptErr) {
    // Roll the slot back so it isn't orphaned as "booked".
    await db.from("doctor_slots").update({ status: "open" }).eq("id", slot_id);
    return { ok: false, code: "conflict", speak: "That time just filled up — let me get you the next one." };
  }

  // @ts-expect-error nested select typing
  const docName = slot.doctor?.full_name ?? "the doctor";
  const when = speakSlot(slot.starts_at);

  // WhatsApp confirmation (2care-style). Simulated unless WhatsApp env is set.
  await sendWhatsAppConfirmation(
    phone,
    `Manipal Hospital: Appointment confirmed with ${docName} on ${when}. Reply RESCHEDULE or CANCEL to change. Ref ${appt!.id.slice(0, 8)}.`
  );

  return {
    ok: true,
    code: "ok",
    speak: `Done — you're booked with ${docName} on ${when}. You'll get a WhatsApp confirmation shortly. Anything else?`,
    data: { appointment_id: appt!.id, doctor: docName, when },
  };
}

// ── reschedule-appointment ─────────────────────────────────────────────────
export async function rescheduleAppointment(input: {
  appointment_id: string;
  new_slot_id: string;
}): Promise<ToolResult> {
  const { appointment_id, new_slot_id } = input;
  if (!appointment_id || !new_slot_id) return { ok: false, code: "invalid", speak: "I need the appointment and the new time to reschedule." };

  const { data: appt } = await db
    .from("appointments")
    .select("id, slot_id, status, patient:patients(phone)")
    .eq("id", appointment_id)
    .maybeSingle();
  if (!appt || appt.status === "cancelled") {
    return { ok: false, code: "not_found", speak: "I couldn't find that appointment to move." };
  }

  const { data: newSlot } = await db
    .from("doctor_slots")
    .select("id, status, starts_at, doctor_id, doctor:doctors(full_name)")
    .eq("id", new_slot_id)
    .maybeSingle();
  if (!newSlot || newSlot.status !== "open") {
    return { ok: false, code: "conflict", speak: "That new time isn't available. Want me to check other times?" };
  }

  // Claim new slot, free the old one, point the appointment at the new slot.
  const { error: claimErr } = await db
    .from("doctor_slots")
    .update({ status: "booked" })
    .eq("id", new_slot_id)
    .eq("status", "open");
  if (claimErr) return { ok: false, code: "conflict", speak: "That new time just filled up — let me find another." };

  const oldSlotId = appt.slot_id;
  await db.from("appointments").update({ slot_id: new_slot_id, status: "rescheduled" }).eq("id", appointment_id);
  await db.from("doctor_slots").update({ status: "open" }).eq("id", oldSlotId);

  // @ts-expect-error nested select typing
  const docName = newSlot.doctor?.full_name ?? "the doctor";
  const when = speakSlot(newSlot.starts_at);

  // @ts-expect-error nested select typing
  const phone = appt.patient?.phone;
  if (phone) {
    await sendWhatsAppConfirmation(
      phone,
      `Manipal Hospital: Appointment rescheduled to ${docName} on ${when}. Ref ${appointment_id.slice(0, 8)}.`
    );
  }

  return {
    ok: true,
    code: "ok",
    speak: `All set — moved to ${docName} on ${when}. A new WhatsApp confirmation is on its way.`,
    data: { appointment_id, doctor: docName, when },
  };
}

// ── cancel-appointment ──────────────────────────────────────────────────────
export async function cancelAppointment(input: {
  appointment_id: string;
}): Promise<ToolResult> {
  const { appointment_id } = input;
  if (!appointment_id) return { ok: false, code: "invalid", speak: "Which appointment should I cancel?" };

  const { data: appt } = await db
    .from("appointments")
    .select("id, slot_id, status")
    .eq("id", appointment_id)
    .maybeSingle();
  if (!appt) return { ok: false, code: "not_found", speak: "I couldn't find that appointment." };
  if (appt.status === "cancelled") return { ok: true, code: "ok", speak: "That appointment was already cancelled." };

  await db.from("appointments").update({ status: "cancelled" }).eq("id", appointment_id);
  await db.from("doctor_slots").update({ status: "open" }).eq("id", appt.slot_id);

  return { ok: true, code: "ok", speak: "Done — that's cancelled, and the slot is freed up. Anything else I can help with?" };
}
