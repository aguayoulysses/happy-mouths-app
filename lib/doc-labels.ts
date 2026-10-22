export const DOC_LABELS = {
  en: {
    receipt: "Receipt",
    invoice: "Invoice",
    quote: "Quote",
    billed_to: "Billed to",
    prepared_for: "Prepared for",
    date: "Date",
    service_date: "Service date",
    description: "Description",
    qty: "Qty",
    unit_price: "Price",
    line_total: "Total",
    subtotal: "Subtotal",
    tax: "Tax",
    total: "Total",
    amount_paid: "Paid",
    balance_due: "Balance due",
    notes: "Notes",
    payment_terms: "Payment terms",
    thank_you: "Thank you for your business.",
  },
  es: {
    receipt: "Recibo",
    invoice: "Factura",
    quote: "Cotización",
    billed_to: "Facturado a",
    prepared_for: "Preparado para",
    date: "Fecha",
    service_date: "Fecha del servicio",
    description: "Descripción",
    qty: "Cant.",
    unit_price: "Precio",
    line_total: "Total",
    subtotal: "Subtotal",
    tax: "Impuesto",
    total: "Total",
    amount_paid: "Pagado",
    balance_due: "Saldo pendiente",
    notes: "Notas",
    payment_terms: "Condiciones de pago",
    thank_you: "Gracias por su confianza.",
  },
} as const;

export function money(n: number) {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

export function docMessage(language: "en" | "es", kindLabel: string, businessName: string, url: string) {
  return language === "es"
    ? `Hola! Aquí está su ${kindLabel.toLowerCase()} de ${businessName}: ${url}`
    : `Hi! Here is your ${kindLabel.toLowerCase()} from ${businessName}: ${url}`;
}
