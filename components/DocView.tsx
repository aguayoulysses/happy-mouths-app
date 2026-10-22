import type { DocData } from "@/lib/documents";
import { DOC_LABELS, money } from "@/lib/doc-labels";

export default function DocView({
  doc,
  businessName,
  ownerName,
  phone,
  logoUrl,
  createdAt,
  number,
}: {
  doc: DocData;
  businessName: string;
  ownerName: string;
  phone: string;
  logoUrl: string;
  createdAt: string;
  number: number;
}) {
  const L = DOC_LABELS[doc.language];
  const kindLabel = L[doc.kind];
  const date = new Date(createdAt + "Z");
  const dateStr = isNaN(date.getTime())
    ? createdAt
    : date.toLocaleDateString(doc.language === "es" ? "es-MX" : "en-US", { year: "numeric", month: "long", day: "numeric" });

  return (
    <div className="mx-auto max-w-lg rounded-2xl border border-line bg-white p-7 print:max-w-none print:rounded-none print:p-0 print:shadow-none">
      <header className="flex items-start justify-between gap-4">
        <div>
          {logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logoUrl} alt={businessName} className="mb-3 h-14 w-auto max-w-[160px] object-contain object-left" />
          ) : null}
          <p className="text-[17px] font-bold leading-tight">{businessName}</p>
          <p className="text-[13px] text-ink-soft">{ownerName}</p>
          {phone && <p className="text-[13px] text-ink-soft">{phone}</p>}
        </div>
        <div className="text-right">
          <p className="display text-[22px] font-bold uppercase tracking-wide text-ink">{kindLabel}</p>
          <p className="mt-1 text-[13px] text-ink-soft">#{String(number).padStart(4, "0")}</p>
          <p className="text-[13px] text-ink-soft">{dateStr}</p>
        </div>
      </header>

      {(doc.customer_name || doc.customer_phone || doc.customer_email) && (
        <section className="mt-6">
          <p className="text-[11px] font-bold uppercase tracking-wide text-ink-soft">
            {doc.kind === "quote" ? L.prepared_for : L.billed_to}
          </p>
          <p className="mt-1 text-[15px] font-semibold">{doc.customer_name}</p>
          {doc.customer_phone && <p className="text-[13px] text-ink-soft">{doc.customer_phone}</p>}
          {doc.customer_email && <p className="text-[13px] text-ink-soft">{doc.customer_email}</p>}
        </section>
      )}

      {doc.service_date && (
        <p className="mt-3 text-[13px] text-ink-soft">
          {L.service_date}: {doc.service_date}
        </p>
      )}

      <table className="mt-6 w-full text-[14px]">
        <thead>
          <tr className="border-b-2 border-ink text-left text-[11px] font-bold uppercase tracking-wide">
            <th className="pb-2">{L.description}</th>
            <th className="hidden pb-2 pl-4 text-right sm:table-cell">{L.qty}</th>
            <th className="hidden pb-2 pl-4 text-right sm:table-cell">{L.unit_price}</th>
            <th className="pb-2 pl-4 text-right">{L.line_total}</th>
          </tr>
        </thead>
        <tbody>
          {doc.line_items.map((item, i) => (
            <tr key={i} className="border-b border-ink/10">
              <td className="py-2.5 pr-2 break-words">
                {item.description}
                <div className="mt-0.5 text-[12px] text-ink-soft tabular-nums sm:hidden">{item.quantity} × {money(item.unit_price)}</div>
              </td>
              <td className="hidden whitespace-nowrap py-2.5 pl-4 text-right tabular-nums sm:table-cell">{item.quantity}</td>
              <td className="hidden whitespace-nowrap py-2.5 pl-4 text-right tabular-nums sm:table-cell">{money(item.unit_price)}</td>
              <td className="whitespace-nowrap py-2.5 pl-4 text-right font-semibold tabular-nums">{money(item.total)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <section className="ml-auto mt-4 w-56 space-y-1.5 text-[14px]">
        <div className="flex justify-between text-ink-soft">
          <span>{L.subtotal}</span>
          <span>{money(doc.subtotal)}</span>
        </div>
        {doc.tax_amount > 0 && (
          <div className="flex justify-between text-ink-soft">
            <span>
              {L.tax} {doc.tax_rate > 0 ? `(${doc.tax_rate}%)` : ""}
            </span>
            <span>{money(doc.tax_amount)}</span>
          </div>
        )}
        <div className="flex justify-between border-t-2 border-ink pt-1.5 text-[16px] font-bold">
          <span>{L.total}</span>
          <span>{money(doc.total)}</span>
        </div>
        {doc.amount_paid > 0 && (
          <div className="flex justify-between text-leaf">
            <span>{L.amount_paid}</span>
            <span>-{money(doc.amount_paid)}</span>
          </div>
        )}
        {doc.amount_paid > 0 && doc.balance_due > 0 && (
          <div className="flex justify-between font-bold text-cherry">
            <span>{L.balance_due}</span>
            <span>{money(doc.balance_due)}</span>
          </div>
        )}
      </section>

      {doc.notes && (
        <section className="mt-6 text-[13px]">
          <p className="font-bold">{L.notes}</p>
          <p className="mt-0.5 whitespace-pre-line text-ink-soft">{doc.notes}</p>
        </section>
      )}
      {doc.payment_terms && (
        <section className="mt-3 text-[13px]">
          <p className="font-bold">{L.payment_terms}</p>
          <p className="mt-0.5 text-ink-soft">{doc.payment_terms}</p>
        </section>
      )}

      <p className="mt-8 border-t border-ink/10 pt-4 text-center text-[12px] text-ink-soft">{L.thank_you}</p>
    </div>
  );
}
