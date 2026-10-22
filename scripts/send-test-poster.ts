// One real test through the normal pipeline: the first text (+ sign photo) and, with STEPS=2,
// the first follow-up (+ meme) right behind it. The request is then stopped so nothing else
// goes to that phone. Usage:
//   npx tsx scripts/send-test-poster.ts <business_id> "<Name>" <phone>
// Env: DATABASE_URL (+ token) for the database to use, BASE_URL public (Twilio fetches the
// picture from it), the Twilio keys, SMS_DRY_RUN=false. STEPS=1|2 (default 2).
import { one, run } from "@/lib/db";
import { addCustomerAndQueue, deliverRequest, stopRequest } from "@/lib/requests";
import { cancelPending } from "@/lib/dnc";
import type { Business } from "@/lib/auth";

(async () => {
  const [id, name, phone] = process.argv.slice(2);
  const steps = Number(process.env.STEPS ?? 2);
  const b = await one<Business>("SELECT * FROM businesses WHERE id=?", [Number(id)]);
  if (!b) throw new Error("no such business");
  await cancelPending(b.id, phone, "test finished");
  await run("UPDATE requests SET status='skipped' WHERE business_id=? AND status IN ('sent','opened') AND stop_reason='test finished'", [b.id]);
  const r = await addCustomerAndQueue(b, { name, phone, source: "manual", sendNow: true });
  console.log("queue:", r.outcome, r.request?.code);
  if (!r.request) return;
  for (let i = 0; i < steps; i++) {
    const out = await deliverRequest(b, r.request.id);
    console.log(`step ${i + 1}:`, out?.status, out?.error || "ok", "| picture:", out?.poster_url || "none");
    if (out?.status !== "sent") break;
  }
  await stopRequest(r.request.id, "test finished");
})();
