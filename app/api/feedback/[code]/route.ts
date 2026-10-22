import { loadGate, saveComment } from "@/lib/feedback";
import { gateUrl } from "@/lib/template";

// The private note from the review gate. A plain HTML form posts here (the page
// may be on the business's own domain, so the action is absolute), and the
// customer is sent back to the gate's thank-you screen.
export async function POST(req: Request, ctx: { params: Promise<{ code: string }> }) {
  const { code } = await ctx.params;
  const g = await loadGate(code);
  if (!g) return new Response("This link isn't valid anymore.", { status: 404 });

  const ct = req.headers.get("content-type") ?? "";
  let f: Record<string, string> = {};
  try {
    if (ct.includes("application/json")) f = Object.fromEntries(Object.entries(await req.json()).map(([k, v]) => [k, String(v ?? "")]));
    else f = Object.fromEntries(Array.from((await req.formData()).entries()).map(([k, v]) => [k, String(v)]));
  } catch {
    f = {};
  }
  await saveComment(g.r, g.b, { comment: f.comment ?? "", contactOk: true });

  if (ct.includes("application/json")) return Response.json({ ok: true });
  return Response.redirect(`${gateUrl(code, g.b)}?thanks=1`, 303);
}
