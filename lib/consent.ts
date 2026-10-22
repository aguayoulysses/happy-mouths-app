// SMS consent from a business's own website. The sentence the person agreed to is stored
// word for word with the submission (TCPA evidence), and a fresh consent clears an earlier STOP.
import { run } from "@/lib/db";
import { clearOptOut } from "@/lib/sms";

export function consentText(businessName: string): string {
  return (
    `I agree to receive text messages from ${businessName} about my service request, ` +
    `including appointment scheduling, updates, and follow-up after a completed job. ` +
    `Message frequency varies. Message and data rates may apply. ` +
    `Reply STOP to unsubscribe or HELP for help. ` +
    `Consent is not a condition of purchase. ` +
    `${businessName} does not share your mobile number with third parties for marketing.`
  );
}

export async function recordConsent(o: { businessId: number; businessName: string; phone: string; name: string; sourceUrl: string; req: Request }) {
  await run("INSERT INTO consents (business_id, phone, name, source_url, consent_text, ip, user_agent) VALUES (?,?,?,?,?,?,?)", [
    o.businessId, o.phone, o.name, o.sourceUrl.slice(0, 300), consentText(o.businessName), o.req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "", (o.req.headers.get("user-agent") ?? "").slice(0, 300),
  ]);
  await clearOptOut(o.businessId, o.phone);
}
