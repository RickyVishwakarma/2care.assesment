# Deploy & wire-up guide

Everything needed to take CareLine from repo → a live agent a reviewer can call.
Steps marked **[you]** require your own accounts/keys — I can't create those.

## 1. Supabase (database) **[you]**
1. Create a project at supabase.com.
2. Open the **SQL Editor**, paste all of [`db/schema.sql`](../db/schema.sql), run it.
3. Settings → API: copy the **Project URL** and the **service_role key**.

## 2. Local env + seed
```bash
cp .env.example .env
# set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY
npm install
npm run seed        # → "~N slots generated over next 14 days"
```
Re-run `npm run seed` any time to refresh the forward slot window.

## 3. Deploy the backend to Vercel **[you]**
1. Push this repo to GitHub, import it at vercel.com.
2. Add env vars in Vercel: `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
   `RETELL_API_KEY`, `RETELL_AGENT_ID`, `RETELL_WEBHOOK_SECRET`
   (and optionally `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_ID`).
3. Deploy. Note your URL, e.g. `https://careline.vercel.app`.
4. Sanity check: `POST https://<your-url>/api/tools/check-availability`
   with body `{"args":{"department":"Cardiology","date_hint":"this week"}}`
   should return open slots.

## 4. Create the Retell agent **[you]**
1. In the Retell dashboard, **create an agent**.
2. **General prompt:** paste [`agent/prompt.md`](../agent/prompt.md).
3. **Begin message:** see [`agent/config.md`](../agent/config.md).
4. **Model / voice / latency knobs:** follow [`agent/config.md`](../agent/config.md)
   (small fast model, Indian-English voice, `speak_during_execution` on).
5. **Custom functions:** for each entry in [`agent/tools.json`](../agent/tools.json),
   add a function with that name, description, and parameters, and set the URL to
   `https://<your-url>/api/tools/<endpoint>`.
6. **Webhook URL:** `https://<your-url>/api/retell-webhook`.
7. Copy the **agent id** → set `RETELL_AGENT_ID` in Vercel and redeploy.

## 5. The one-click demo
Visit your deployed homepage → **"📞 Call the receptionist"** starts a web call
against your live agent. This is what the reviewer clicks — no phone number
needed. (Optional: also buy a Retell phone number for a real PSTN call.)

## 6. Verify end-to-end
- Call the agent: "I need a cardiologist this week." → it should offer a real
  Manipal doctor + slot, confirm, and book.
- Check Supabase → `appointments` for the new row, and `call_logs` for the
  transcript.
- Run `npm run eval` against the deployed URL:
  `CARELINE_BASE_URL=https://<your-url> npm run eval`.

## Troubleshooting
- **"Missing Supabase env"** → env vars not set on Vercel (or `.env` locally).
- **Web-call button errors** → `RETELL_AGENT_ID` not set / agent not created.
- **Tools return "Unauthorized"** → `RETELL_WEBHOOK_SECRET` mismatch; either set
  the same value as a custom header in Retell, or leave it unset in dev.
- **No slots** → run `npm run seed`; the horizon is 14 days from seed time.
