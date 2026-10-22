// The owner's chat with us. Reading the thread marks our replies read.
// A new message texts the team cells (alertOps: HM_LEAD_ALERT_PHONES) so a person sees it fast.

import { json, fail, preflight, body } from "@/lib/api";
import { requireBusiness } from "@/lib/guard";
import { all, run, logEvent } from "@/lib/db";
import { storeUpload } from "@/lib/media";
import { repFor } from "@/lib/reps";
import { alertOps } from "@/lib/sms";
import { baseUrl } from "@/lib/template";
import { NAME } from "@/lib/whitelabel";

export const OPTIONS = preflight;

export async function GET(req: Request) {
  const { b, res } = await requireBusiness(req);
  if (!b) return res;
  const peek = new URL(req.url).searchParams.get("peek") === "1";
  // channel 'imessage' rows are our iMessage texts with the owner, mirrored for ops; the app shows its own chat only.
  if (!peek) await run("UPDATE team_messages SET read_at=datetime('now') WHERE business_id=? AND sender='team' AND channel='app' AND read_at IS NULL", [b.id]);
  const rows = await all<{ id: number; sender: string; body: string; image_url: string; read_at: string | null; created_at: string }>(
    "SELECT id, sender, body, image_url, read_at, created_at FROM (SELECT * FROM team_messages WHERE business_id=? AND channel='app' ORDER BY id DESC LIMIT 300) ORDER BY id ASC",
    [b.id]
  );
  return json({
    rep: repFor(b.rep_key),
    // The 15-minute support call scheduler. Its own calendar page when set, else the site's booking page.
    booking_url: process.env.SUPPORT_BOOKING_URL || process.env.NEXT_PUBLIC_BOOKING_URL || "",
    owner_phone: b.owner_phone || b.forward_to,
    unread: rows.filter((r) => r.sender === "team" && !r.read_at).length,
    messages: peek ? [] : rows.map((r) => ({ id: Number(r.id), sender: r.sender, body: r.body, image_url: r.image_url, created_at: r.created_at })),
  });
}

export async function POST(req: Request) {
  const { b, res } = await requireBusiness(req);
  if (!b) return res;
  let text = "";
  let imageUrl = "";
  if ((req.headers.get("content-type") ?? "").includes("multipart/form-data")) {
    const form = await req.formData().catch(() => null);
    if (!form) return fail("Invalid request");
    text = String(form.get("body") ?? "").trim();
    const image = form.get("image");
    if (image instanceof File && image.size > 0) {
      imageUrl = (await storeUpload(b.id, image)) ?? "";
      if (!imageUrl) return fail("That image is too large or not a photo.");
    }
  } else {
    text = String((await body<{ body?: string }>(req)).body ?? "").trim();
  }
  if (!text && !imageUrl) return fail("Message is empty.");
  await run("INSERT INTO team_messages (business_id, sender, body, image_url) VALUES (?,?,?,?)", [b.id, "client", text.slice(0, 2000), imageUrl]);
  await logEvent(b.id, "team_chat", (text || "Sent a photo").slice(0, 300));

  await alertOps(`${b.name} messaged you in ${NAME}: ${(text || "(photo)").slice(0, 600)}\nReply: ${baseUrl()}/admin/${b.id}#chat`).catch(() => {});
  return json({ sent: true });
}
