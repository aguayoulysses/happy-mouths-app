// Apple guideline 5.1.1(v): an account created in the app must be deletable in
// the app. This removes the business and every row that references it, then
// kills the session. Nothing is soft-deleted or kept for "records".

import { json, fail, preflight, body } from "@/lib/api";
import { requireBusiness } from "@/lib/guard";
import { run, logEvent } from "@/lib/db";
import { verifyPassword } from "@/lib/password";
import { one } from "@/lib/db";

export const OPTIONS = preflight;

const TABLES = ["requests", "customers", "feedback", "opt_outs", "do_not_contact", "reviews", "push_tokens", "integrations", "events", "weekly_summaries", "calls", "conversation_messages", "team_messages", "documents", "photos", "media", "referrals", "leads", "consents", "sessions"];

export async function DELETE(req: Request) {
  const { b, res } = await requireBusiness(req);
  if (!b) return res;
  const { password } = await body<{ password?: string }>(req);
  const row = await one<{ password_hash: string }>("SELECT password_hash FROM businesses WHERE id=?", [b.id]);
  if (!password || !row || !verifyPassword(password, row.password_hash)) return fail("Enter your current password to delete the account", 403);
  await logEvent(b.id, "deleted", `${b.name} deleted their account`);
  for (const t of TABLES) await run(`DELETE FROM ${t} WHERE business_id=?`, [b.id]);
  await run("DELETE FROM businesses WHERE id=?", [b.id]);
  return json({ ok: true });
}
