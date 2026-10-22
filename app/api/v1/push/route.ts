import { json, fail, preflight, body } from "@/lib/api";
import { requireBusiness } from "@/lib/guard";
import { savePushToken, deletePushToken } from "@/lib/push";

export const OPTIONS = preflight;

export async function POST(req: Request) {
  const { b, res } = await requireBusiness(req);
  if (!b) return res;
  const { token, platform } = await body<{ token?: string; platform?: string }>(req);
  if (!token) return fail("token required");
  await savePushToken(b.id, token, platform || "ios");
  return json({ ok: true });
}

export async function DELETE(req: Request) {
  const { token } = await body<{ token?: string }>(req);
  if (token) await deletePushToken(token);
  return json({ ok: true });
}
