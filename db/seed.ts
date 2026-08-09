// Seed the database from data/clinic.json (real Manipal directory) and generate
// a concrete bookable slot grid from each doctor's OPD blocks.
//
//   npm run seed
//
// Idempotent: safe to re-run. Re-seeding refreshes doctors and regenerates the
// forward slot window; existing appointments are preserved.
import { createClient } from "@supabase/supabase-js";
import clinic from "../data/clinic.json";
import { generateSlots } from "../lib/slots";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
if (!url || !key) throw new Error("Set NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY");
const db = createClient(url, key, { auth: { persistSession: false } });

const SLOT_HORIZON_DAYS = 14; // how far ahead we open slots
const SLOT_GRANULARITY_MIN = 20; // matches "new consult" duration

async function main() {
  console.log(`Seeding from: ${clinic.clinic.name}`);

  // ── appointment types ──
  for (const t of clinic.appointment_types) {
    await db.from("appointment_types").upsert(
      { code: t.code, label: t.label, duration_min: t.duration_min },
      { onConflict: "code" }
    );
  }

  // ── departments ──
  const deptId = new Map<string, string>();
  for (const d of clinic.departments) {
    const { data, error } = await db
      .from("departments")
      .upsert({ name: d.name, synonyms: d.synonyms }, { onConflict: "name" })
      .select("id, name")
      .single();
    if (error) throw error;
    deptId.set(d.name, data.id);
  }
  console.log(`  ${deptId.size} departments`);

  // ── doctors ──
  let doctorCount = 0;
  let slotCount = 0;
  const now = new Date();

  for (const doc of clinic.doctors) {
    const department_id = deptId.get(doc.department);
    if (!department_id) {
      console.warn(`  ! no department for ${doc.full_name} (${doc.department})`);
      continue;
    }
    // Upsert doctor keyed on (name, department) — no natural unique in schema,
    // so look up first, then insert if absent.
    const { data: existing } = await db
      .from("doctors")
      .select("id")
      .eq("full_name", doc.full_name)
      .eq("department_id", department_id)
      .maybeSingle();

    let doctorId: string;
    if (existing) {
      doctorId = existing.id;
      await db.from("doctors").update({
        designation: doc.designation,
        teleconsult: doc.teleconsult,
        active: true,
      }).eq("id", doctorId);
    } else {
      const { data, error } = await db
        .from("doctors")
        .insert({
          full_name: doc.full_name,
          department_id,
          designation: doc.designation,
          teleconsult: doc.teleconsult,
        })
        .select("id")
        .single();
      if (error) throw error;
      doctorId = data.id;
    }
    doctorCount++;

    // ── generate slots ──
    const slots = generateSlots(doc.opd, now, SLOT_HORIZON_DAYS, SLOT_GRANULARITY_MIN);
    if (slots.length) {
      // Insert only slots that don't already exist (unique on doctor_id+starts_at).
      const rows = slots.map((s) => ({
        doctor_id: doctorId,
        starts_at: s.starts_at,
        ends_at: s.ends_at,
        status: "open" as const,
      }));
      const { error } = await db
        .from("doctor_slots")
        .upsert(rows, { onConflict: "doctor_id,starts_at", ignoreDuplicates: true });
      if (error) throw error;
      slotCount += rows.length;
    }
  }

  console.log(`  ${doctorCount} doctors`);
  console.log(`  ~${slotCount} slots generated over next ${SLOT_HORIZON_DAYS} days`);
  console.log("Done.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
