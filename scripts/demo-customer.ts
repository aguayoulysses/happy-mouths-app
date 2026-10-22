// Puts a pretend customer with a review text waiting to send into an account, so the "stop" sheet
// can be shown to someone. The number is a made-up 555 one, so nothing reaches a real person.
// Safe to re-run: it clears the last demo and queues a fresh one.
//
//   set -a; source .env.turso.local; set +a
//   npx tsx scripts/demo-customer.ts            (sends in 2 days)
//   SLUG=<business slug> NAME="Maria Lopez" HOURS=3 npx tsx scripts/demo-customer.ts

import { run, one } from "@/lib/db";
import { addCustomerAndQueue } from "@/lib/requests";
import type { Business } from "@/lib/auth";

const PHONE = "+17145550142";

(async () => {
  const slug = process.env.SLUG ?? "sample-landscaping";
  const b = await one<Business>("SELECT * FROM businesses WHERE slug=?", [slug]);
  if (!b) throw new Error(`No business with slug ${slug}`);

  await run("DELETE FROM do_not_contact WHERE business_id=? AND phone=?", [b.id, PHONE]);
  await run("DELETE FROM requests WHERE business_id=? AND customer_id IN (SELECT id FROM customers WHERE business_id=? AND phone=?)", [b.id, b.id, PHONE]);

  const r = await addCustomerAndQueue(b, { name: process.env.NAME ?? "Maria Lopez", phone: PHONE, source: "manual" });
  if (r.outcome !== "queued" || !r.request) throw new Error(`Not queued: ${r.outcome}`);

  const hours = Number(process.env.HOURS ?? 48);
  await run("UPDATE requests SET send_at=datetime('now', ?), next_at=datetime('now', ?) WHERE id=?", [`+${hours} hours`, `+${hours} hours`, r.request.id]);
  console.log(`${r.customer.name} is waiting in ${b.name}. Text sends in ${hours} hr unless stopped.`);
})();
