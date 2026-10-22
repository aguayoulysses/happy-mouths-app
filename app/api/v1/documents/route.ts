// The invoices tool: the owner says what the job was, Claude writes the
// receipt, invoice or quote, and the customer gets a link.

import { randomBytes } from "node:crypto";
import { json, fail, preflight, body } from "@/lib/api";
import { requireBusiness } from "@/lib/guard";
import { all, run } from "@/lib/db";
import { generateDocument } from "@/lib/documents";
import { docUrl } from "@/lib/template";

export const OPTIONS = preflight;
export const maxDuration = 120;


export async function GET(req: Request) {
  const { b, res } = await requireBusiness(req);
  if (!b) return res;
  if (!b.feature_invoices) return fail("Invoices are not on for this account.", 404);
  const rows = await all<{ id: number; token: string; kind: string; language: string; data: string; created_at: string }>(
    "SELECT id, token, kind, language, data, created_at FROM documents WHERE business_id=? ORDER BY id DESC LIMIT 30", [b.id]
  );
  return json({ documents: rows.map((r) => ({ id: Number(r.id), kind: r.kind, language: r.language, url: docUrl(r.token, b), data: JSON.parse(r.data), created_at: r.created_at })) });
}

export async function POST(req: Request) {
  const { b, res } = await requireBusiness(req);
  if (!b) return res;
  if (!b.feature_invoices) return fail("Invoices are not on for this account.", 404);
  const p = await body<{ dictation?: string; kind?: string }>(req);
  const dictation = String(p.dictation ?? "").trim();
  if (dictation.length < 10) return fail("Tell us a little more about the job first.");
  let doc;
  try {
    doc = await generateDocument({
      dictation,
      requestedKind: ["receipt", "invoice", "quote"].includes(String(p.kind)) ? String(p.kind) : "auto",
      businessName: b.name,
      ownerName: b.owner_name,
      today: new Date().toISOString().slice(0, 10),
    });
  } catch (err) {
    console.error("[documents] generation failed:", err);
    const msg = err instanceof Error ? err.message : "";
    if (/overloaded|rate limit|529|429|timeout|ECONNRESET|fetch failed/i.test(msg)) return fail("The generator is busy right now. Give it a minute and try again.", 502);
    return fail("That one did not go through. Try rewording it.", 502);
  }
  const token = randomBytes(10).toString("hex");
  const { lastId } = await run("INSERT INTO documents (business_id, token, kind, language, data) VALUES (?,?,?,?,?)", [b.id, token, doc.kind, doc.language, JSON.stringify(doc)]);
  return json({ document: { id: lastId, kind: doc.kind, language: doc.language, url: docUrl(token, b), data: doc, created_at: new Date().toISOString() } });
}
