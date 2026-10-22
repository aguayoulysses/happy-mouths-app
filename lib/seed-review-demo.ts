// The account App Review (and sales demos) sign into: a pretend landscaping business with every
// screen filled in. businesses.demo=1 means it never texts anybody and stays off the ops board.
// Wipes and recreates only this business. Runs from scripts/seed-review-demo.ts, and from the login
// route when the demo was deleted (reviewers test "Delete my account"), so the login always works.

import { randomBytes } from "node:crypto";
import { run, one, all, getDb } from "@/lib/db";
import { hashPassword } from "@/lib/password";
import { storeBytes } from "@/lib/media";
import { saveSteps, DEFAULT_STEPS } from "@/lib/sequence";

export const DEMO_EMAIL = (process.env.DEMO_EMAIL ?? "review@example.com").toLowerCase();
/** No default: the App Review demo login only works once DEMO_PASSWORD is set. */
export const DEMO_PASSWORD = process.env.DEMO_PASSWORD ?? "";

const EMAIL = DEMO_EMAIL;
const SLUG = "green-valley-landscaping";
const TABLES = ["requests", "customers", "feedback", "reviews", "events", "integrations", "opt_outs", "do_not_contact", "push_tokens", "sessions", "messages", "calls", "media", "team_messages", "conversation_messages", "documents", "photos", "gbp_daily", "referrals", "sequence_steps"];

const PEOPLE = ["Maria Lopez", "Jordan Chen", "Priya Patel", "Luis Nguyen", "Hannah Kim", "Devon Brooks", "Sofia Rivera", "Marcus Okafor", "Elena Silva", "Tyler Reed", "Grace Park", "Omar Haddad", "Nina Novak", "Caleb Moreno", "Rosa Diaz", "Ethan Cole", "Layla Farah", "Andre Santos", "Chloe Bauer", "Mateo Ruiz", "Ava Lopez", "Kenji Park", "Isla Reed", "Diego Silva", "Dana Cole", "Victor Chen", "Paula Ruiz", "Sam Brooks"];
const COMMENTS = [
  "The crew showed up on time and the yard looks better than it has in years.",
  "Quick, clean, and they hauled everything away. Will use again.",
  "Fair price for the hedge trimming. Very happy with the result.",
  "Great communication, they texted before arriving. Lawn looks sharp.",
  "",
  "Took care of a big palm cleanup nobody else wanted to touch.",
  "Friendly team, did exactly what we asked.",
];
const sql = (d: Date) => d.toISOString().slice(0, 19).replace("T", " ");
const ago = (min: number) => new Date(Date.now() - min * 60_000);
let seed = 7;
const rnd = (n: number) => (seed = (seed * 16807) % 2147483647) % n;

export async function seedReviewDemo(photos: Uint8Array[] = []): Promise<string> {
  const password = DEMO_PASSWORD;
  const old = await one<{ id: number }>("SELECT id FROM businesses WHERE email=? AND demo=1", [EMAIL]);
  if (old) {
    for (const t of TABLES) await run(`DELETE FROM ${t} WHERE business_id=?`, [old.id]);
    await run("DELETE FROM businesses WHERE id=?", [old.id]);
  }
  const { lastId: bid } = await run(
    `INSERT INTO businesses (slug, name, owner_name, email, password_hash, owner_phone, review_link, delay_minutes, status, webhook_token, gbp_location_id, gbp_account_id,
       demo, feature_messages, feature_invoices, feature_photos, rep_key, sms_number, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,1,1,1,1,'rep','+15555550100',?)`,
    [SLUG, "Green Valley Landscaping", "Alex Rivera", EMAIL, hashPassword(password), "", "https://example.com", 120, "active", randomBytes(16).toString("hex"), "pending", "pending", sql(ago(60 * 24 * 60))]
  );
  await saveSteps(bid, DEFAULT_STEPS);

  // Eight weeks of customers and review requests. Batched: this also runs inside a sign-in.
  const db = await getDb();
  type Plan = { name: string; phone: string; created: Date; sendAt: Date; code: string; status: string; opened: string; reviewed: string };
  const plans: Plan[] = [];
  for (let day = 55; day >= 0; day--) {
    const count = day === 0 ? 2 : day % 7 === 0 ? 1 : rnd(3);
    for (let i = 0; i < count; i++) {
      const n = plans.length;
      const created = day === 0 ? ago(20 + i * 25) : ago(day * 1440 + rnd(600));
      const sendAt = new Date(created.getTime() + 120 * 60_000);
      const roll = rnd(100);
      const status = day === 0 ? "queued" : roll < 28 ? "sent" : roll < 60 ? "opened" : "reviewed";
      plans.push({
        name: PEOPLE[n % PEOPLE.length], phone: `+1714555${String(100 + n).padStart(4, "0")}`, created, sendAt, code: randomBytes(5).toString("hex").slice(0, 7), status,
        opened: status === "opened" || status === "reviewed" ? sql(new Date(sendAt.getTime() + rnd(240) * 60_000)) : "",
        reviewed: status === "reviewed" ? sql(new Date(sendAt.getTime() + (60 + rnd(600)) * 60_000)) : "",
      });
    }
  }
  const n = plans.length;
  const phones = plans.map((p) => p.phone);
  await db.batch(plans.map((p) => ({ sql: "INSERT INTO customers (business_id, name, phone, source, created_at) VALUES (?,?,?,?,?)", args: [bid, p.name, p.phone, "manual", sql(p.created)] })), "write");
  const cids = new Map((await all<{ id: number; phone: string }>("SELECT id, phone FROM customers WHERE business_id=?", [bid])).map((c) => [c.phone, Number(c.id)]));
  await db.batch(plans.map((p) => ({
    sql: "INSERT INTO requests (business_id, customer_id, code, status, send_at, next_at, sent_at, opened_at, rated_at, reviewed_at, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
    args: [bid, cids.get(p.phone)!, p.code, p.status, sql(p.sendAt), p.status === "queued" ? sql(p.sendAt) : "", p.status === "queued" ? "" : sql(p.sendAt), p.opened, p.reviewed ? p.opened : "", p.reviewed, sql(p.created)],
  })), "write");
  const rids = new Map((await all<{ id: number; code: string }>("SELECT id, code FROM requests WHERE business_id=?", [bid])).map((r) => [r.code, Number(r.id)]));
  const reviewed = plans.filter((p) => p.status === "reviewed");
  if (reviewed.length) await db.batch(reviewed.map((p) => ({
    sql: "INSERT INTO reviews (business_id, review_name, star_rating, comment, reviewer_name, create_time, reply_comment, reply_time, request_id, notified_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
    args: [bid, `accounts/demo/locations/${SLUG}/reviews/${p.code}`, rnd(100) < 85 ? 5 : 4, COMMENTS[rnd(COMMENTS.length)], p.name, new Date(p.reviewed.replace(" ", "T") + "Z").toISOString(), "Thank you so much, it was a pleasure working on your yard!", p.reviewed, rids.get(p.code)!, p.reviewed],
  })), "write");

  // Customer conversations
  const threads: [number, ["in" | "out", string][]][] = [
    [35, [["in", "Hi, do you do sprinkler repairs? One of mine is spraying the driveway."], ["out", "We do. I can come by Thursday morning to take a look, does 9 work?"], ["in", "9 works, thank you!"]]],
    [190, [["in", "How much to trim the hedges along the back fence? About 40 feet."], ["out", "Usually $180 to $220 for that length, hauling included. Want me to stop by for an exact price?"], ["in", "Yes please, any afternoon this week."]]],
    [1500, [["out", "Hi Priya, this is Alex from Green Valley. We finished the sod today, water it twice a day for the first two weeks."], ["in", "Looks amazing. Will do!"]]],
    [4400, [["in", "Can you send me the invoice for last month?"], ["out", "Just sent it over. Thanks again!"]]],
  ];
  for (const [i, [start, msgs]] of [...threads.entries()].reverse()) {
    for (const [j, [direction, body]] of msgs.entries()) {
      const last = j === msgs.length - 1;
      await run("INSERT INTO conversation_messages (business_id, customer_phone, direction, body, read_at, created_at) VALUES (?,?,?,?,?,?)", [
        bid, phones[phones.length - 3 - i], direction, body, direction === "in" && last && i < 2 ? null : sql(new Date()), sql(ago(start - j * 9)),
      ]);
    }
  }

  // Chat with their rep
  const team: [string, string, number][] = [
    ["team", "Hi Alex, I set up your review texts. Add a customer after each job and we take it from there.", 9000],
    ["owner", "Got it. Can you change the follow-up text to mention our spring cleanup?", 8800],
    ["team", "Done. Take a look next time one goes out and tell me if you want it reworded.", 8700],
  ];
  for (const [sender, body, min] of team) await run("INSERT INTO team_messages (business_id, sender, body, read_at, created_at) VALUES (?,?,?,?,?)", [bid, sender, body, sql(new Date()), sql(ago(min))]);

  // Invoices
  const docs = [
    { kind: "invoice", customer_name: "Priya Patel", items: [["Sod installation, front yard (600 sq ft)", 1, 1850], ["Sprinkler adjustment", 1, 120]], paid: 0, days: 1 },
    { kind: "receipt", customer_name: "Marcus Okafor", items: [["Monthly yard maintenance", 1, 160]], paid: 160, days: 6 },
    { kind: "quote", customer_name: "Hannah Kim", items: [["Hedge trimming, back fence (40 ft)", 1, 200], ["Green waste hauling", 1, 45]], paid: 0, days: 12 },
  ] as const;
  for (const d of docs) {
    const line_items = d.items.map(([description, quantity, unit_price]) => ({ description, quantity, unit_price, total: quantity * unit_price }));
    const total = line_items.reduce((a, x) => a + x.total, 0);
    const data = { kind: d.kind, language: "en", customer_name: d.customer_name, customer_phone: "", customer_email: "", service_date: sql(ago(d.days * 1440)).slice(0, 10), line_items, subtotal: total, tax_rate: 0, tax_amount: 0, total, amount_paid: d.paid, balance_due: total - d.paid, notes: "", payment_terms: d.kind === "invoice" ? "Due on receipt" : "" };
    await run("INSERT INTO documents (business_id, token, kind, language, data, created_at) VALUES (?,?,?,?,?,?)", [bid, randomBytes(10).toString("hex"), d.kind, "en", JSON.stringify(data), sql(ago(d.days * 1440))]);
  }

  // Job photos, all waiting: no Google profile is linked to a demo, so nothing can be "on Google"
  for (const [i, bytes] of photos.entries()) {
    const url = await storeBytes(bid, bytes, "image/jpeg");
    if (url) await run("INSERT INTO photos (business_id, url, status, created_at) VALUES (?,?,?,?)", [bid, url, "new", sql(ago((12 - i) * 1440))]);
  }

  return `Demo business #${bid} ready: ${n} customers, ${threads.length} conversations, ${docs.length} documents, ${photos.length} photos.`;
}
