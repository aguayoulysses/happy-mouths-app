// Everything that names or styles the company lives in brand.json at the repo root, so a
// rebrand is one file plus the images in brand-assets/ (copied into place by `npm run brand`).

import brand from "@/brand.json";

export const BRAND = brand;
export const NAME = brand.name;
/** Square mark used next to the name in headers (brand-assets/mark.png). */
export const MARK = "/brand/mark.png";
/** Production origin, e.g. https://yourbrand.com. BASE_URL wins when set. */
export const SITE = (process.env.BASE_URL || `https://${brand.domain}`).replace(/\/+$/, "");
/** Host of the ops board, used in alert texts ("Open ops.yourbrand.com/admin/12"). */
export const OPS_HOST = `ops.${brand.domain}`;

/** Overrides the highlight color tokens the site, the ops board and the app all read. */
export function brandCss(): string {
  const c = brand.colors;
  return `:root{--color-sun:${c.primary};--color-sun-deep:${c.primaryDeep};--color-sun-soft:${c.primarySoft};--sun:${c.primary};--sun-deep:${c.primaryDeep};--sun-soft:${c.primarySoft}}`;
}
