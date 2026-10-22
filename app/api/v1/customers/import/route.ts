import { json, fail, preflight, body } from "@/lib/api";
import { requireBusiness } from "@/lib/guard";
import { addCustomerAndQueue } from "@/lib/requests";
import { normalizePhone, isValidUsPhone } from "@/lib/phone";

export const OPTIONS = preflight;

type Parsed = { name: string; phone: string; email: string };

/** Accepts CSV or pasted lines. Finds name/phone/email columns by header or by shape. */
export function parseCustomerList(text: string): { rows: Parsed[]; skipped: number } {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const rows: Parsed[] = [];
  let skipped = 0;
  let nameIdx = -1, phoneIdx = -1, emailIdx = -1;
  const first = lines[0]?.toLowerCase() ?? "";
  const hasHeader = /name|phone|mobile|cell|email/.test(first) && !/\d{7}/.test(first);
  if (hasHeader) {
    const cols = splitCsv(lines[0]).map((c) => c.toLowerCase());
    nameIdx = cols.findIndex((c) => /name|customer|client/.test(c));
    phoneIdx = cols.findIndex((c) => /phone|mobile|cell|tel/.test(c));
    emailIdx = cols.findIndex((c) => /email/.test(c));
    lines.shift();
  }
  for (const line of lines) {
    const cols = splitCsv(line);
    let phone = "", name = "", email = "";
    if (phoneIdx >= 0) {
      phone = normalizePhone(cols[phoneIdx] ?? "");
      name = cols[nameIdx] ?? "";
      email = cols[emailIdx] ?? "";
    } else {
      for (const c of cols) {
        const p = normalizePhone(c);
        if (!phone && isValidUsPhone(p)) phone = p;
        else if (!email && /@/.test(c)) email = c;
        else if (!name && /[a-z]/i.test(c)) name = c;
      }
    }
    if (!isValidUsPhone(phone)) {
      skipped++;
      continue;
    }
    rows.push({ name: name.trim(), phone, email: email.trim() });
  }
  return { rows, skipped };
}

function splitCsv(line: string): string[] {
  const out: string[] = [];
  let cur = "", inQ = false;
  for (const ch of line) {
    if (ch === '"') inQ = !inQ;
    else if ((ch === "," || ch === "\t" || ch === ";") && !inQ) {
      out.push(cur.trim());
      cur = "";
    } else cur += ch;
  }
  out.push(cur.trim());
  return out;
}

export async function POST(req: Request) {
  const { b, res } = await requireBusiness(req);
  if (!b) return res;
  const { text, dry } = await body<{ text?: string; dry?: boolean }>(req);
  if (!text?.trim()) return fail("Paste or upload a list first");
  const { rows, skipped } = parseCustomerList(text);
  if (dry) return json({ preview: rows.slice(0, 50), total: rows.length, skipped });
  const tally = { queued: 0, already_active: 0, already_reviewed: 0, opted_out: 0, do_not_contact: 0, invalid_phone: skipped };
  for (const r of rows.slice(0, 1000)) {
    const out = await addCustomerAndQueue(b, { name: r.name, phone: r.phone, email: r.email, source: "csv" });
    tally[out.outcome]++;
  }
  return json({ ...tally, total: rows.length });
}
