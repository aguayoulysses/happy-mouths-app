// Creates a demo business with eight weeks of realistic activity so the
// dashboard has something to show. Safe to re-run: it wipes and recreates
// only the demo business. CLI: node scripts/seed-demo.ts. In production it
// runs on boot when DEMO_SEED=true and there are no businesses yet.
import type { Client } from "@libsql/client";
import { hashPassword } from "./password";
import { DEFAULT_TEMPLATE } from "./template";
import { randomBytes } from "node:crypto";

const EMAIL = "demo@example.com";

const FIRST = ["Maria", "Jordan", "Priya", "Luis", "Hannah", "Devon", "Sofia", "Marcus", "Elena", "Tyler", "Grace", "Omar", "Nina", "Caleb", "Rosa", "Ethan", "Layla", "Andre", "Chloe", "Mateo", "Ava", "Kenji", "Isla", "Diego"];
const LAST = ["Lopez", "Chen", "Patel", "Nguyen", "Kim", "Brooks", "Rivera", "Okafor", "Silva", "Reed", "Park", "Haddad", "Novak", "Moreno", "Diaz", "Cole", "Farah", "Santos", "Bauer", "Ruiz"];
const COMMENTS = [
  "The crew are the real deal. Yard looks better than it has in years.",
  "On time, quick, and they cleaned up everything before leaving. Will use again.",
  "Fair price for the hedge trimming and they hauled it all away.",
  "Great communication, they texted before arriving. Lawn looks sharp.",
  "",
  "Took care of a huge palm cleanup nobody else wanted to touch.",
  "Friendly team, did exactly what we asked.",
  "",
];
const rnd = (n: number) => Math.floor(Math.random() * n);
const pick = <T,>(a: T[]) => a[rnd(a.length)];
const sql = (d: Date) => d.toISOString().slice(0, 19).replace("T", " ");

export async function seedDemo(db: Client): Promise<string> {
  const old = await db.execute({ sql: "SELECT id FROM businesses WHERE email IN (?, 'demo@example.com') OR slug IN ('sample-landscaping')", args: [EMAIL] });
  for (const r of old.rows) {
    const id = Number(r.id);
    for (const t of ["requests", "customers", "feedback", "reviews", "events", "integrations", "opt_outs", "do_not_contact", "push_tokens", "sessions", "weekly_summaries", "messages"]) {
      await db.execute({ sql: `DELETE FROM ${t} WHERE business_id=?`, args: [id] });
    }
    await db.execute({ sql: "DELETE FROM businesses WHERE id=?", args: [id] });
  }
  await db.execute("DELETE FROM reviews WHERE review_name LIKE 'accounts/demo/%'");
  const ins = await db.execute({
    sql: `INSERT INTO businesses (slug, name, owner_name, email, password_hash, owner_phone, review_link, message_template, delay_minutes, status, trial_ends_at, webhook_token, gbp_location_id, gbp_account_id)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    args: ["sample-landscaping", "Sample Landscaping", "Demo Owner", EMAIL, hashPassword(process.env.DEMO_PASSWORD || "change-me-demo"), "", "", DEFAULT_TEMPLATE, 120, "active", "", randomBytes(16).toString("hex"), "pending", "pending"],
  });
  const bid = Number(ins.lastInsertRowid);

  const used = new Set<string>();
  let reviewsMade = 0;
  for (let day = 55; day >= 0; day--) {
    const n = day % 7 === 0 ? 1 : rnd(3); // 0-2 a day, one on Sundays
    for (let i = 0; i < n; i++) {
      const name = `${pick(FIRST)} ${pick(LAST)}`;
      let phone = "";
      do phone = `+1714555${String(1000 + rnd(9000))}`; while (used.has(phone));
      used.add(phone);
      const created = new Date(Date.now() - day * 86400_000 - rnd(10) * 3600_000);
      const c = await db.execute({ sql: "INSERT INTO customers (business_id, name, phone, source, created_at) VALUES (?,?,?,?,?)", args: [bid, name, phone, pick(["manual", "manual", "square", "csv"]), sql(created)] });
      const cid = Number(c.lastInsertRowid);
      const code = randomBytes(5).toString("hex").slice(0, 7);
      const sendAt = new Date(created.getTime() + 120 * 60_000);
      let status = "sent", opened = "", rated = "", reviewed = "";
      if (day === 0 && sendAt > new Date()) status = "queued";
      else {
        const roll = Math.random();
        if (roll < 0.28) status = "sent";
        else if (roll < 0.48) { status = "opened"; opened = sql(new Date(sendAt.getTime() + rnd(240) * 60_000)); }
        else if (roll < 0.62) { status = "opened"; opened = sql(new Date(sendAt.getTime() + rnd(240) * 60_000)); }
        else { status = "reviewed"; opened = sql(new Date(sendAt.getTime() + rnd(240) * 60_000)); rated = opened; reviewed = sql(new Date(sendAt.getTime() + (60 + rnd(600)) * 60_000)); }
      }
      const r = await db.execute({
        sql: "INSERT INTO requests (business_id, customer_id, code, status, send_at, sent_at, opened_at, rated_at, reviewed_at, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
        args: [bid, cid, code, status, sql(sendAt), status === "queued" ? "" : sql(sendAt), opened, rated, reviewed, sql(created)],
      });
      const rid = Number(r.lastInsertRowid);
      if (status === "reviewed") {
        reviewsMade++;
        const stars = Math.random() < 0.85 ? 5 : 4;
        await db.execute({
          sql: "INSERT INTO reviews (business_id, review_name, star_rating, comment, reviewer_name, create_time, reply_comment, reply_time, request_id, notified_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
          args: [bid, `accounts/demo/locations/demo/reviews/${code}`, stars, pick(COMMENTS), name, new Date(reviewed.replace(" ", "T") + "Z").toISOString(), day > 10 ? "Thank you so much, it was a pleasure working on your yard!" : "", day > 10 ? reviewed : "", rid, reviewed],
        });
      }
    }
  }
  // A few older reviews that weren't from us
  for (let i = 0; i < 9; i++) {
    const d = new Date(Date.now() - (70 + rnd(300)) * 86400_000).toISOString();
    await db.execute({ sql: "INSERT INTO reviews (business_id, review_name, star_rating, comment, reviewer_name, create_time, reply_comment, reply_time, notified_at) VALUES (?,?,?,?,?,?,?,?,?)", args: [bid, `accounts/demo/locations/demo/reviews/old${i}`, pick([5, 5, 5, 4, 3]), pick(COMMENTS), `${pick(FIRST)} ${pick(LAST)[0]}.`, d, "Thanks for the kind words!", d, d] });
  }
  await db.execute({ sql: "INSERT INTO integrations (business_id, provider, token, events, last_event_at) VALUES (?,?,?,?,?)", args: [bid, "square", randomBytes(18).toString("base64url"), 31, sql(new Date(Date.now() - 3 * 3600_000))] });
  return `Seeded business #${bid} (${EMAIL}, password from DEMO_PASSWORD or change-me-demo, GBP ids and Twilio still to be entered in admin; seeded rows clear on first real sync or via admin), ${used.size} customers, ${reviewsMade} matched reviews`;
}
