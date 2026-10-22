// Refer a friend: the owner hands us another business owner. They get a month
// free once the friend signs up; the friend gets half off their first month.
// It lands in the team chat too, so the rep sees it and can say thanks.

import { json, fail, preflight, body } from "@/lib/api";
import { requireBusiness } from "@/lib/guard";
import { all, run, logEvent } from "@/lib/db";
import { normalizePhone, isValidUsPhone, prettyPhone } from "@/lib/phone";
import { alertOps } from "@/lib/sms";

export const OPTIONS = preflight;

export async function GET(req: Request) {
  const { b, res } = await requireBusiness(req);
  if (!b) return res;
  const rows = await all<{ id: number; friend_name: string; friend_business: string; status: string; created_at: string }>(
    "SELECT id, friend_name, friend_business, status, created_at FROM referrals WHERE business_id=? ORDER BY id DESC LIMIT 50", [b.id]
  );
  return json({ referrals: rows });
}

export async function POST(req: Request) {
  const { b, res } = await requireBusiness(req);
  if (!b) return res;
  const p = await body<{ name?: string; business?: string; phone?: string }>(req);
  const name = String(p.name ?? "").trim().slice(0, 80);
  const biz = String(p.business ?? "").trim().slice(0, 120);
  const phone = normalizePhone(String(p.phone ?? ""));
  if (!name) return fail("Add your friend's name.");
  if (!isValidUsPhone(phone)) return fail("Add a cell number we can reach them at.");
  await run("INSERT INTO referrals (business_id, friend_name, friend_business, friend_phone) VALUES (?,?,?,?)", [b.id, name, biz, phone]);
  await run("INSERT INTO team_messages (business_id, sender, body) VALUES (?,?,?)", [b.id, "client", `I have a referral for you: ${name}${biz ? `, ${biz}` : ""}, ${prettyPhone(phone)}.`]);
  await logEvent(b.id, "referral", `${name}${biz ? ` (${biz})` : ""} ${prettyPhone(phone)}`);

  await alertOps(`Referral from ${b.name}: ${name}${biz ? `, ${biz}` : ""}, ${prettyPhone(phone)}.`).catch(() => {});
  return json({ sent: true });
}
