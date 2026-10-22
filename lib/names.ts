// Comparing the name a business has on file with a Google display name.
// Google only exposes the display name, so a match is first name + last initial when we have one.

export function norm(s: string): string {
  return String(s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z\s]/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .join(" ");
}

export function namesMatch(customer: string, reviewer: string): boolean {
  const c = norm(customer).split(" ");
  const r = norm(reviewer).split(" ");
  if (!c[0] || !r[0] || c[0].length < 2) return false;
  if (c[0] !== r[0]) return false;
  const cl = c[1]?.[0];
  const rl = r[1]?.[0];
  if (cl && rl) return cl === rl;
  return true;
}

/** Only a first name on file: enough to suspect a match, never enough to be sure of one. */
export function firstNameOnly(name: string): boolean {
  return norm(name).split(" ").length < 2;
}
