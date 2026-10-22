/** "(714) 555-1234" / "714.555.1234" / "+1 714 555 1234" → "+17145551234". */
export function normalizePhone(raw: string): string {
  const digits = String(raw ?? "").replace(/[^\d+]/g, "");
  if (!digits) return "";
  if (digits.startsWith("+")) return digits;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return `+${digits}`;
}

export function isValidUsPhone(e164: string): boolean {
  return /^\+1[2-9]\d{9}$/.test(e164);
}

/** "714-555-1234, (949) 555-0000" → ["+17145551234", "+19495550000"]: split on commas, normalized, no repeats. */
export function phoneList(raw: string): string[] {
  const out: string[] = [];
  for (const part of String(raw ?? "").split(/[,;\n]+/)) {
    const p = normalizePhone(part.trim());
    if (p && !out.includes(p)) out.push(p);
  }
  return out;
}

/** "+17145551234,+19495550000" → "(714) 555-1234, (949) 555-0000". */
export function prettyPhoneList(raw: string): string {
  return phoneList(raw).map(prettyPhone).join(", ");
}

/** "+17145551234" → "(714) 555-1234"; anything else passes through. */
export function prettyPhone(e164: string): string {
  const m = String(e164).match(/^\+1(\d{3})(\d{3})(\d{4})$/);
  return m ? `(${m[1]}) ${m[2]}-${m[3]}` : e164;
}
