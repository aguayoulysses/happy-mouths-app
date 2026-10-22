import { json, fail, preflight, body } from "@/lib/api";
import { requireBusiness } from "@/lib/guard";
import { one, run } from "@/lib/db";
import { publicBusiness, type Business } from "@/lib/auth";
import { normalizePhone, isValidUsPhone } from "@/lib/phone";
import { hashPassword } from "@/lib/password";

export const OPTIONS = preflight;

export async function GET(req: Request) {
  const { b, res } = await requireBusiness(req);
  if (!b) return res;
  return json({ business: publicBusiness(b) });
}

export async function PATCH(req: Request) {
  const { b, res } = await requireBusiness(req);
  if (!b) return res;
  const input = await body<Record<string, unknown>>(req);
  const sets: string[] = [];
  const args: (string | number)[] = [];

  const text = (k: string, max = 200) => {
    if (typeof input[k] === "string") {
      sets.push(`${k}=?`);
      args.push(String(input[k]).trim().slice(0, max));
    }
  };
  text("name", 80);
  text("owner_name", 80);
  text("timezone", 60);
  if (typeof input.owner_phone === "string") {
    const p = input.owner_phone.trim() ? normalizePhone(input.owner_phone) : "";
    if (p && !isValidUsPhone(p)) return fail("That phone number doesn't look right");
    sets.push("owner_phone=?");
    args.push(p);
  }
  if (input.owner_alerts !== undefined) {
    sets.push("owner_alerts=?");
    args.push(input.owner_alerts ? 1 : 0);
  }
  for (const k of ["notify_texts", "notify_calls", "notify_reviews", "notify_photos"]) {
    if (input[k] !== undefined) {
      sets.push(`${k}=?`);
      args.push(input[k] ? 1 : 0);
    }
  }
  if (typeof input.password === "string" && input.password) {
    if (input.password.length < 8) return fail("Password needs at least 8 characters");
    sets.push("password_hash=?");
    args.push(hashPassword(input.password));
  }
  if (!sets.length) return fail("Nothing to update");
  args.push(b.id);
  await run(`UPDATE businesses SET ${sets.join(", ")} WHERE id=?`, args);
  const fresh = (await one<Business>("SELECT * FROM businesses WHERE id=?", [b.id]))!;
  return json({ business: publicBusiness(fresh) });
}
