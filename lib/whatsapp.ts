// WhatsApp confirmation — a nod to 2care.ai's actual product (they run patient
// comms over WhatsApp). This is a pluggable sender: with WHATSAPP_TOKEN +
// WHATSAPP_PHONE_ID set it posts a real WhatsApp Cloud API message; without
// them it logs the message it *would* send, so the demo stays self-contained
// and nothing silently fails. Kept off the voice hot path (called post-booking).
export async function sendWhatsAppConfirmation(
  toPhone: string,
  message: string
): Promise<{ sent: boolean; simulated: boolean }> {
  const token = process.env.WHATSAPP_TOKEN;
  const phoneId = process.env.WHATSAPP_PHONE_ID;

  if (!token || !phoneId) {
    console.log(`[whatsapp:simulated] → ${toPhone}: ${message}`);
    return { sent: true, simulated: true };
  }

  try {
    const res = await fetch(`https://graph.facebook.com/v20.0/${phoneId}/messages`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: toPhone.replace("+", ""),
        type: "text",
        text: { body: message },
      }),
    });
    return { sent: res.ok, simulated: false };
  } catch {
    return { sent: false, simulated: false };
  }
}
