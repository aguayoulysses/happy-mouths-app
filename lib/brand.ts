// A business's own colors on its receipts, invoices and quotes. Two of them: `main` fills the
// header and the total, `accent` is the thin stripe and small marks. Both come from the logo
// (lib/brand-detect.ts) unless someone set them by hand in admin. No logo = plain black.

export type Rgb = [number, number, number];
export type Brand = { main: string; accent: string; onMain: string; onAccent: string; tint: string };

export const DEFAULT_MAIN = "#111111";

export function cleanHex(input: string | null | undefined): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(input ?? "").trim());
  return m ? `#${m[1].toLowerCase()}` : "";
}

export function toRgb(hex: string): Rgb {
  const h = cleanHex(hex) || DEFAULT_MAIN;
  return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
}

export function toHex([r, g, b]: Rgb): string {
  return "#" + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("");
}

function luminance([r, g, b]: Rgb): number {
  const [R, G, B] = [r, g, b].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * R + 0.7152 * G + 0.0722 * B;
}

export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(toRgb(a)), luminance(toRgb(b))].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** White or black type on top of this color. White wins on mid tones (it reads as the brand); black only on light colors like yellow. */
export function inkOn(hex: string): string {
  return contrast(hex, "#ffffff") >= 3 ? "#ffffff" : "#111111";
}

/** The color washed out toward white. amount 0.08 = a faint background. */
export function wash(hex: string, amount: number): string {
  const [r, g, b] = toRgb(hex);
  return toHex([255 + (r - 255) * amount, 255 + (g - 255) * amount, 255 + (b - 255) * amount]);
}

function saturation([r, g, b]: Rgb): number {
  const max = Math.max(r, g, b) / 255;
  const min = Math.min(r, g, b) / 255;
  return max === min ? 0 : (max - min) / (1 - Math.abs(max + min - 1));
}

export function resolveBrand(b: { brand_color?: string | null; brand_accent?: string | null }): Brand {
  const main = cleanHex(b.brand_color) || DEFAULT_MAIN;
  const accent = cleanHex(b.brand_accent) || main;
  // A near-black or gray main color washes out to plain gray, so the panel takes the accent's tone instead.
  const tone = saturation(toRgb(main)) < 0.25 ? accent : main;
  return { main, accent, onMain: inkOn(main), onAccent: inkOn(accent), tint: wash(tone, saturation(toRgb(tone)) < 0.25 ? 0.05 : 0.12) };
}
