import { json, fail, preflight, body } from "@/lib/api";
import { one } from "@/lib/db";
import { verifyPassword } from "@/lib/password";
import { createSession, publicBusiness, type Business } from "@/lib/auth";
import { seedReviewDemo, DEMO_EMAIL, DEMO_PASSWORD } from "@/lib/seed-review-demo";
import { clearWelcomePassword } from "@/lib/welcome";

export const OPTIONS = preflight;

export async function POST(req: Request) {
  const { email, password } = await body<{ email?: string; password?: string }>(req);
  if (!email || !password) return fail("Email and password required");
  const find = () => one<Business & { password_hash: string }>("SELECT * FROM businesses WHERE email=?", [email.trim().toLowerCase()]);
  let b = await find();
  // The demo account deletes like any other; it comes back on the next sign-in so the login never dies.
  if (!b && email.trim().toLowerCase() === DEMO_EMAIL && DEMO_PASSWORD && password === DEMO_PASSWORD) {
    await seedReviewDemo();
    b = await find();
  }
  if (!b || !verifyPassword(password, b.password_hash)) return fail("Wrong email or password", 401);
  if (b.status === "cancelled") return fail("This account is closed", 403);
  const token = await createSession(b.id);
  await clearWelcomePassword(b.id); // signed in once: the welcome page stops showing the temporary password
  return json({ token, business: publicBusiness(b) });
}
