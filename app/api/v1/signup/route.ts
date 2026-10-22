import { json, fail, preflight, body } from "@/lib/api";
import { one, run, logEvent } from "@/lib/db";
import { hashPassword } from "@/lib/password";
import { createSession, publicBusiness, type Business } from "@/lib/auth";
import { normalizePhone, isValidUsPhone } from "@/lib/phone";
import { DEFAULT_TEMPLATE } from "@/lib/template";
import { randomBytes } from "node:crypto";

export const OPTIONS = preflight;

export function slugify(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "business";
}

export async function POST(req: Request) {
  const { business, owner, email, phone, password } = await body<Record<string, string>>(req);
  if (!business?.trim() || !email?.trim() || !password) return fail("Business name, email and password are required");
  if (password.length < 8) return fail("Password needs at least 8 characters");
  const ownerPhone = phone ? normalizePhone(phone) : "";
  if (ownerPhone && !isValidUsPhone(ownerPhone)) return fail("That phone number doesn't look right");
  const mail = email.trim().toLowerCase();
  if (await one("SELECT 1 AS x FROM businesses WHERE email=?", [mail])) return fail("An account with that email already exists", 409);

  let slug = slugify(business);
  for (let i = 2; await one("SELECT 1 AS x FROM businesses WHERE slug=?", [slug]); i++) slug = `${slugify(business)}-${i}`;
  const trialEnds = new Date(Date.now() + 7 * 86400_000).toISOString().slice(0, 10);
  const { lastId } = await run(
    `INSERT INTO businesses (slug, name, owner_name, email, password_hash, owner_phone, message_template, status, trial_ends_at, webhook_token)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
    [slug, business.trim(), (owner ?? "").trim(), mail, hashPassword(password), ownerPhone, DEFAULT_TEMPLATE, "trial", trialEnds, randomBytes(16).toString("hex")]
  );
  await logEvent(lastId, "signup", `${business.trim()} started a trial`);
  const b = (await one<Business>("SELECT * FROM businesses WHERE id=?", [lastId]))!;
  const token = await createSession(b.id);
  return json({ token, business: publicBusiness(b) }, 201);
}
