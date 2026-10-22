import { Document, Page, View, Text, Image, StyleSheet } from "@react-pdf/renderer";
import type { DocData } from "@/lib/documents";
import { DOC_LABELS, money } from "@/lib/doc-labels";

// PDF mirror of components/DocView.tsx — keep the two in sync when the layout changes.

const s = StyleSheet.create({
  page: { padding: 48, fontSize: 10, fontFamily: "Helvetica", color: "#111111" },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  logo: { height: 52, width: 52, objectFit: "contain", marginBottom: 8 },
  business: { fontSize: 13, fontFamily: "Helvetica-Bold" },
  soft: { color: "#5a6079" },
  kind: { fontSize: 18, fontFamily: "Helvetica-Bold", color: "#111111", textTransform: "uppercase", letterSpacing: 1 },
  right: { textAlign: "right" },
  sectionLabel: { fontSize: 8, fontFamily: "Helvetica-Bold", textTransform: "uppercase", letterSpacing: 0.8, color: "#5a6079" },
  customer: { fontSize: 11, fontFamily: "Helvetica-Bold", marginTop: 3 },
  table: { marginTop: 20 },
  thRow: { flexDirection: "row", borderBottomWidth: 1.5, borderBottomColor: "#111111", paddingBottom: 5 },
  th: { fontSize: 8, fontFamily: "Helvetica-Bold", textTransform: "uppercase", letterSpacing: 0.8 },
  tr: { flexDirection: "row", borderBottomWidth: 0.5, borderBottomColor: "#d8dae3", paddingVertical: 7 },
  colDesc: { flex: 1, paddingRight: 8 },
  colQty: { width: 40, textAlign: "right" },
  colPrice: { width: 70, textAlign: "right" },
  colTotal: { width: 70, textAlign: "right" },
  totals: { marginTop: 12, marginLeft: "auto", width: 190 },
  totalRow: { flexDirection: "row", justifyContent: "space-between", marginBottom: 4 },
  grand: { borderTopWidth: 1.5, borderTopColor: "#111111", paddingTop: 5, fontSize: 12, fontFamily: "Helvetica-Bold" },
  paid: { color: "#18a05e" },
  due: { color: "#e5484d", fontFamily: "Helvetica-Bold" },
  noteLabel: { fontFamily: "Helvetica-Bold", marginTop: 14 },
  footer: { marginTop: 28, borderTopWidth: 0.5, borderTopColor: "#d8dae3", paddingTop: 12, textAlign: "center", color: "#5a6079" },
});

export function DocPdf({
  doc,
  businessName,
  ownerName,
  phone,
  logoSrc,
  createdAt,
  number,
}: {
  doc: DocData;
  businessName: string;
  ownerName: string;
  phone: string;
  logoSrc: string | null;
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
    <Document title={`${kindLabel} #${String(number).padStart(4, "0")} · ${businessName}`}>
      <Page size="LETTER" style={s.page}>
        <View style={s.header}>
          <View>
            {logoSrc ? <Image style={s.logo} src={logoSrc} /> : null}
            <Text style={s.business}>{businessName}</Text>
            <Text style={s.soft}>{ownerName}</Text>
            {phone ? <Text style={s.soft}>{phone}</Text> : null}
          </View>
          <View style={s.right}>
            <Text style={s.kind}>{kindLabel}</Text>
            <Text style={[s.soft, { marginTop: 4 }]}>#{String(number).padStart(4, "0")}</Text>
            <Text style={s.soft}>{dateStr}</Text>
          </View>
        </View>

        {(doc.customer_name || doc.customer_phone || doc.customer_email) && (
          <View style={{ marginTop: 22 }}>
            <Text style={s.sectionLabel}>{doc.kind === "quote" ? L.prepared_for : L.billed_to}</Text>
            {doc.customer_name ? <Text style={s.customer}>{doc.customer_name}</Text> : null}
            {doc.customer_phone ? <Text style={s.soft}>{doc.customer_phone}</Text> : null}
            {doc.customer_email ? <Text style={s.soft}>{doc.customer_email}</Text> : null}
          </View>
        )}

        {doc.service_date ? (
          <Text style={[s.soft, { marginTop: 10 }]}>
            {L.service_date}: {doc.service_date}
          </Text>
        ) : null}

        <View style={s.table}>
          <View style={s.thRow}>
            <Text style={[s.th, s.colDesc]}>{L.description}</Text>
            <Text style={[s.th, s.colQty]}>{L.qty}</Text>
            <Text style={[s.th, s.colPrice]}>{L.unit_price}</Text>
            <Text style={[s.th, s.colTotal]}>{L.line_total}</Text>
          </View>
          {doc.line_items.map((item, i) => (
            <View key={i} style={s.tr}>
              <Text style={s.colDesc}>{item.description}</Text>
              <Text style={s.colQty}>{item.quantity}</Text>
              <Text style={s.colPrice}>{money(item.unit_price)}</Text>
              <Text style={[s.colTotal, { fontFamily: "Helvetica-Bold" }]}>{money(item.total)}</Text>
            </View>
          ))}
        </View>

        <View style={s.totals}>
          <View style={[s.totalRow, s.soft]}>
            <Text style={s.soft}>{L.subtotal}</Text>
            <Text style={s.soft}>{money(doc.subtotal)}</Text>
          </View>
          {doc.tax_amount > 0 && (
            <View style={s.totalRow}>
              <Text style={s.soft}>
                {L.tax} {doc.tax_rate > 0 ? `(${doc.tax_rate}%)` : ""}
              </Text>
              <Text style={s.soft}>{money(doc.tax_amount)}</Text>
            </View>
          )}
          <View style={[s.totalRow, s.grand]}>
            <Text>{L.total}</Text>
            <Text>{money(doc.total)}</Text>
          </View>
          {doc.amount_paid > 0 && (
            <View style={s.totalRow}>
              <Text style={s.paid}>{L.amount_paid}</Text>
              <Text style={s.paid}>-{money(doc.amount_paid)}</Text>
            </View>
          )}
          {doc.amount_paid > 0 && doc.balance_due > 0 && (
            <View style={s.totalRow}>
              <Text style={s.due}>{L.balance_due}</Text>
              <Text style={s.due}>{money(doc.balance_due)}</Text>
            </View>
          )}
        </View>

        {doc.notes ? (
          <View>
            <Text style={s.noteLabel}>{L.notes}</Text>
            <Text style={s.soft}>{doc.notes}</Text>
          </View>
        ) : null}
        {doc.payment_terms ? (
          <View>
            <Text style={s.noteLabel}>{L.payment_terms}</Text>
            <Text style={s.soft}>{doc.payment_terms}</Text>
          </View>
        ) : null}

        <Text style={s.footer}>{L.thank_you}</Text>
      </Page>
    </Document>
  );
}
