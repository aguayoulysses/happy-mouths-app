import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DOC_LABELS } from "@/lib/doc-labels";
import { one } from "@/lib/db";
import type { DocData } from "@/lib/documents";
import { prettyPhone } from "@/lib/phone";
import DocView from "@/components/DocView";

type Row = { id: number; kind: string; language: string; data: string; created_at: string; name: string; owner_name: string; sms_number: string; owner_phone: string; logo_url: string };
const load = (token: string) =>
  one<Row>("SELECT d.id, d.kind, d.language, d.data, d.created_at, b.name, b.owner_name, b.sms_number, b.owner_phone, b.logo_url FROM documents d JOIN businesses b ON b.id = d.business_id WHERE d.token=?", [token]);

// The customer's page for a receipt, invoice or quote. It carries the business's name, never ours.
export async function generateMetadata({ params }: { params: Promise<{ token: string }> }): Promise<Metadata> {
  const row = await load((await params).token);
  if (!row) return { title: "Not found" };
  const lang = row.language === "es" ? "es" : "en";
  const label = DOC_LABELS[lang][row.kind as "receipt" | "invoice" | "quote"] ?? row.kind;
  return { title: `${label} #${String(row.id).padStart(4, "0")} · ${row.name}`, description: `${label} from ${row.name}`, robots: { index: false } };
}

export default async function PublicDocPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const row = await load(token);
  if (!row) notFound();
  const doc = JSON.parse(row.data) as DocData;
  return (
    <main className="min-h-screen bg-ground px-4 py-8 print:bg-white print:p-0">
      <DocView doc={doc} businessName={row.name} ownerName={row.owner_name} phone={prettyPhone(row.sms_number || row.owner_phone)} logoUrl={row.logo_url ?? ""} createdAt={row.created_at} number={Number(row.id)} />
      <p className="mt-5 text-center text-[13px] font-semibold print:hidden">
        <a href={`/api/doc-pdf/${token}`} className="underline">{doc.language === "es" ? "Descargar PDF" : "Download PDF"}</a>
      </p>
    </main>
  );
}
