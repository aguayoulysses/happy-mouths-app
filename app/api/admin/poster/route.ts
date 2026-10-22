// Admin-only: everything the "Pictures" card on a business page needs.
//   GET  ?key=db:3&name=Anika            → a saved template rendered with a sample name
//   POST { action: "preview", ... }       → render an unsaved upload (returns a JPEG)
//   POST { action: "save", ... }          → store the photo and make it the business's sign or meme
//   POST { action: "remove", ... }        → take a picture off the business
//   POST { action: "test", ... }          → send step 1 and step 2 to a phone right now

import { isAdmin, type Business } from "@/lib/auth";
import { one, run, logEvent } from "@/lib/db";
import { renderPoster, resolveTemplate, prepareUpload, orderQuad, type Pt, type PosterTemplate } from "@/lib/poster-render";
import { addCustomerAndQueue, deliverRequest, stopRequest } from "@/lib/requests";
import { cancelPending } from "@/lib/dnc";

export const runtime = "nodejs";
export const maxDuration = 60;

const jpeg = (buf: Buffer) => new Response(new Uint8Array(buf), { headers: { "content-type": "image/jpeg", "cache-control": "no-store" } });
const bad = (msg: string, status = 400) => Response.json({ error: msg }, { status });

export async function GET(req: Request) {
  if (!(await isAdmin())) return bad("Not signed in", 401);
  const u = new URL(req.url);
  // ?raw=<poster_images id>: the untouched photo a client sent from their finish page, so the corners can be clicked here.
  if (u.searchParams.get("raw")) {
    const row = await one<{ image: ArrayBuffer | Uint8Array }>("SELECT image FROM poster_images WHERE id=?", [Number(u.searchParams.get("raw"))]);
    if (!row) return bad("No such picture", 404);
    return jpeg(Buffer.from(row.image instanceof Uint8Array ? row.image : new Uint8Array(row.image)));
  }
  const tpl = await resolveTemplate(u.searchParams.get("key") ?? "");
  if (!tpl) return bad("No such picture", 404);
  return jpeg(await renderPoster(u.searchParams.get("name") || "Anika", tpl));
}

type Body = { action: string; business_id?: number; kind?: "sign" | "caption"; image?: string; quad?: Pt[]; caption?: string; name?: string; phone?: string };

async function build(b: Body): Promise<{ tpl: PosterTemplate; jpeg: Buffer } | string> {
  const kind = b.kind === "caption" ? "caption" : "sign";
  const raw = Buffer.from(String(b.image ?? "").replace(/^data:image\/\w+;base64,/, ""), "base64");
  if (raw.length < 1000) return "Choose a photo first";
  if (kind === "sign" && b.quad?.length !== 4) return "Click the four corners of the board";
  const prepared = await prepareUpload(raw, kind, kind === "sign" ? orderQuad(b.quad as Pt[]) : undefined);
  return { jpeg: prepared.jpeg, tpl: { image: "upload", data: prepared.jpeg, kind, quad: prepared.quad, caption: b.caption?.trim() || undefined } };
}

export async function POST(req: Request) {
  if (!(await isAdmin())) return bad("Not signed in", 401);
  const b = (await req.json().catch(() => ({}))) as Body;

  if (b.action === "preview") {
    const built = await build(b);
    if (typeof built === "string") return bad(built);
    return jpeg(await renderPoster(b.name || "Anika", built.tpl));
  }

  const biz = await one<Business>("SELECT * FROM businesses WHERE id=?", [Number(b.business_id)]);
  if (!biz) return bad("No such business", 404);

  if (b.action === "save") {
    const built = await build(b);
    if (typeof built === "string") return bad(built);
    const { lastId } = await run("INSERT INTO poster_images (business_id, kind, image, quad, caption) VALUES (?,?,?,?,?)", [
      biz.id, built.tpl.kind ?? "sign", new Uint8Array(built.jpeg), built.tpl.quad ? JSON.stringify(built.tpl.quad) : "", built.tpl.caption ?? "",
    ]);
    const col = built.tpl.kind === "caption" ? "meme_template" : "poster_template";
    await run(`UPDATE businesses SET ${col}=? WHERE id=?`, [`db:${lastId}`, biz.id]);
    await run("DELETE FROM poster_images WHERE business_id=? AND kind=? AND id != ?", [biz.id, built.tpl.kind ?? "sign", lastId]);
    await logEvent(biz.id, "picture", `${built.tpl.kind === "caption" ? "Follow-up meme" : "Sign"} photo saved by admin`);
    return Response.json({ ok: true, key: `db:${lastId}` });
  }

  if (b.action === "remove") {
    const col = b.kind === "caption" ? "meme_template" : "poster_template";
    await run(`UPDATE businesses SET ${col}='' WHERE id=?`, [biz.id]);
    await run("DELETE FROM poster_images WHERE business_id=? AND kind=?", [biz.id, b.kind === "caption" ? "caption" : "sign"]);
    return Response.json({ ok: true });
  }

  if (b.action === "test") {
    if (!b.phone) return bad("Enter a phone number");
    // A clean run every time: stop whatever an earlier test left going for this phone.
    await cancelPending(biz.id, b.phone, "test finished");
    await run("UPDATE requests SET status='skipped' WHERE business_id=? AND status IN ('sent','opened') AND stop_reason='test finished'", [biz.id]);
    const q = await addCustomerAndQueue(biz, { name: b.name || "Anika", phone: b.phone, source: "manual", sendNow: true });
    if (q.outcome !== "queued" || !q.request) return bad(q.outcome === "invalid_phone" ? "That isn't a US mobile number" : `Couldn't queue: ${q.outcome.replace(/_/g, " ")}`);
    // A test is ours, not the client's: keep it out of their customer list in the app.
    await run("UPDATE customers SET source='test' WHERE id=?", [q.customer.id]);
    const first = await deliverRequest(biz, q.request.id);
    if (first?.status !== "sent") return bad(`First text failed: ${first?.error || "unknown"}`);
    const second = await deliverRequest(biz, q.request.id);
    await stopRequest(q.request.id, "test finished");
    await logEvent(biz.id, "test", `Test sequence sent to ${b.phone} by admin`);
    return Response.json({ ok: true, steps: second?.step ?? 1, error: second?.error || "" });
  }
  return bad("Unknown action");
}
