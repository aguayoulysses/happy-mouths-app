// BlueBubbles posts every new iMessage on our line here (registered from Texts → Settings).
// The secret in the path is the line's webhook_secret; anything else is a 404.
// Always answers 200 once the secret checks out, so BlueBubbles never retries a message we already have.

import { timingSafeEqual } from "node:crypto";
import { getLine, handleInbound } from "@/lib/imessage";
import { textAlert } from "@/lib/meta-leads";
import { logEvent } from "@/lib/db";

const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

export async function POST(req: Request, { params }: { params: Promise<{ line: string; secret: string }> }) {
  const { line: lineId, secret } = await params;
  const line = await getLine(Number(lineId));
  if (!line || !line.webhook_secret || !same(secret, line.webhook_secret)) return new Response("Not found", { status: 404 });
  const payload = (await req.json().catch(() => ({}))) as { type?: string; data?: Parameters<typeof handleInbound>[1] };
  if (payload.type !== "new-message" || !payload.data) return Response.json({ ok: true, ignored: payload.type ?? null });
  try {
    const outcome = await handleInbound(line, payload.data, textAlert);
    return Response.json({ ok: true, outcome });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await logEvent(0, "imessage_webhook_error", msg.slice(0, 300)).catch(() => 0);
    return Response.json({ ok: false, error: msg }, { status: 200 });
  }
}
