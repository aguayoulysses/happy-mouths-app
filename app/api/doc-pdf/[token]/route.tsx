import { renderToBuffer } from "@react-pdf/renderer";
import { one } from "@/lib/db";
import type { DocData } from "@/lib/documents";
import { DOC_LABELS } from "@/lib/doc-labels";
import { DocPdf } from "@/lib/pdf-doc";
import { prettyPhone } from "@/lib/phone";

export const runtime = "nodejs";

// Customer-facing, addressed by the document's unguessable token, same as /d/<token>.
export async function GET(_req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const row = await one<{ id: number; data: string; created_at: string; name: string; owner_name: string; sms_number: string; owner_phone: string; logo_url: string }>(
    "SELECT d.id, d.data, d.created_at, b.name, b.owner_name, b.sms_number, b.owner_phone, b.logo_url FROM documents d JOIN businesses b ON b.id = d.business_id WHERE d.token=?",
    [token]
  );
  if (!row) return new Response("Not found", { status: 404 });
  const doc = JSON.parse(row.data) as DocData;
  const buffer = await renderToBuffer(
    <DocPdf doc={doc} businessName={row.name} ownerName={row.owner_name} phone={prettyPhone(row.sms_number || row.owner_phone)} logoSrc={row.logo_url || null} createdAt={row.created_at} number={Number(row.id)} />
  );
  const filename = `${DOC_LABELS[doc.language][doc.kind]}-${String(row.id).padStart(4, "0")}-${row.name.replace(/[^a-zA-Z0-9]+/g, "-")}.pdf`;
  return new Response(new Uint8Array(buffer), {
    headers: { "content-type": "application/pdf", "content-disposition": `inline; filename="${filename}"`, "cache-control": "private, max-age=300" },
  });
}
