// Turns a few dictated words about a job into a receipt, invoice or quote (structured output, so the layout is ours and the math is consistent).

import Anthropic from "@anthropic-ai/sdk";

export type DocLineItem = { description: string; quantity: number; unit_price: number; total: number };

export type DocData = {
  kind: "receipt" | "invoice" | "quote";
  language: "en" | "es";
  customer_name: string;
  customer_phone: string;
  customer_email: string;
  service_date: string;
  line_items: DocLineItem[];
  subtotal: number;
  tax_rate: number;
  tax_amount: number;
  total: number;
  amount_paid: number;
  balance_due: number;
  notes: string;
  payment_terms: string;
};

const DOC_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "kind", "language", "customer_name", "customer_phone", "customer_email", "service_date",
    "line_items", "subtotal", "tax_rate", "tax_amount", "total", "amount_paid", "balance_due",
    "notes", "payment_terms",
  ],
  properties: {
    kind: { type: "string", enum: ["receipt", "invoice", "quote"] },
    language: { type: "string", enum: ["en", "es"] },
    customer_name: { type: "string" },
    customer_phone: { type: "string" },
    customer_email: { type: "string" },
    service_date: { type: "string", description: "ISO date YYYY-MM-DD, or empty string if not mentioned" },
    line_items: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["description", "quantity", "unit_price", "total"],
        properties: {
          description: { type: "string" },
          quantity: { type: "number" },
          unit_price: { type: "number" },
          total: { type: "number" },
        },
      },
    },
    subtotal: { type: "number" },
    tax_rate: { type: "number", description: "Percent, e.g. 7.75. Zero if no tax mentioned." },
    tax_amount: { type: "number" },
    total: { type: "number" },
    amount_paid: { type: "number", description: "For receipts, usually equals total. Zero if nothing paid." },
    balance_due: { type: "number" },
    notes: { type: "string" },
    payment_terms: { type: "string" },
  },
} as const;

export async function generateDocument(input: {
  dictation: string;
  requestedKind: string;
  businessName: string;
  ownerName: string;
  today: string;
}): Promise<DocData> {
  // Transient 429/5xx/529s from the API should not surface to clients; retry hard,
  // then fall back to Sonnet once so an Opus capacity incident never takes the feature down.
  try {
    return await generateWithModel("claude-opus-5", input);
  } catch (err) {
    const status = err instanceof Anthropic.APIError ? err.status : undefined;
    if (status === 429 || (typeof status === "number" && status >= 500)) {
      console.error(`[ai] claude-opus-5 unavailable (${status}), falling back to claude-sonnet-5`);
      return await generateWithModel("claude-sonnet-5", input);
    }
    throw err;
  }
}

async function generateWithModel(
  model: string,
  input: { dictation: string; requestedKind: string; businessName: string; ownerName: string; today: string }
): Promise<DocData> {
  const client = new Anthropic({ maxRetries: 3 });
  const response = await client.messages.create({
    model,
    max_tokens: 4096,
    output_config: {
      effort: "low",
      format: { type: "json_schema", schema: DOC_SCHEMA },
    },
    system: `You turn a business owner's dictated or typed description of a job into a clean billing document for their customer. The owner runs "${input.businessName}". Today's date is ${input.today}.

Rules:
- The dictation may be in English or Spanish, often informal and rambling. Detect the language and set "language" accordingly; write descriptions, notes, and payment terms in that same language.
- Decide the document kind: a receipt records payment already made, an invoice bills for work done or scheduled, a quote estimates work not yet agreed. ${input.requestedKind === "auto" ? "Infer the kind from what they say." : `The owner already chose: ${input.requestedKind}.`}
- Turn rambling descriptions into short, professional line items. Compute quantity x unit price for each line total, the subtotal, tax if mentioned (otherwise zero), and the grand total. Keep every amount exactly consistent with the math.
- If the owner mentions a deposit or partial payment, reflect it in amount_paid and balance_due.
- Only include facts the owner actually said. Leave fields as empty strings or zero when not mentioned. Never invent prices, dates, or contact details.`,
    messages: [{ role: "user", content: input.dictation }],
  });

  if (response.stop_reason === "refusal") {
    throw new Error("The generator could not process that description. Try rewording it.");
  }
  const text = response.content.find((b) => b.type === "text");
  if (!text || text.type !== "text") throw new Error("No document was generated. Try again.");
  return JSON.parse(text.text) as DocData;
}
