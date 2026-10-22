// The business's do-not-contact list. POST takes a customer_id (from the
// customer sheet) or a bare phone (blocking someone before they ever show up
// from the booking system). Either way anything scheduled for them stops.

import { json, fail, preflight, body } from "@/lib/api";
import { requireBusiness } from "@/lib/guard";
import { one } from "@/lib/db";
import { block, unblock, listBlocked } from "@/lib/dnc";

export const OPTIONS = preflight;

export async function GET(req: Request) {
  const { b, res } = await requireBusiness(req);
  if (!b) return res;
  return json({ blocked: await listBlocked(b.id) });
}

export async function POST(req: Request) {
  const { b, res } = await requireBusiness(req);
  if (!b) return res;
  const input = await body<{ customer_id?: number; phone?: string; name?: string; reason?: string }>(req);
  let phone = String(input.phone ?? "");
  let name = String(input.name ?? "");
  if (input.customer_id) {
    const c = await one<{ name: string; phone: string }>("SELECT name, phone FROM customers WHERE id=? AND business_id=?", [Number(input.customer_id), b.id]);
    if (!c) return fail("Customer not found", 404);
    phone = c.phone;
    name = name || c.name;
  }
  if (!phone) return fail("Phone number required");
  const r = await block(b.id, { phone, name, reason: input.reason, addedBy: "owner" });
  if (!r.ok) return fail("That phone number doesn't look like a US mobile number");
  return json({ ok: true, phone: r.phone, cancelled: r.cancelled }, 201);
}

export async function DELETE(req: Request) {
  const { b, res } = await requireBusiness(req);
  if (!b) return res;
  const input = await body<{ phone?: string }>(req);
  const phone = input.phone || new URL(req.url).searchParams.get("phone") || "";
  if (!phone) return fail("Phone number required");
  await unblock(b.id, phone, "owner");
  return json({ ok: true });
}
