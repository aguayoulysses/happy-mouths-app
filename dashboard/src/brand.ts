// The company name, site and colors come from brand.json at the repo root (shared with the server).
import brand from "../../brand.json";

export const BRAND = brand;
export const NAME = brand.name;
export const SITE = `https://${brand.domain}`;
/** Square mark next to the name (copied here from brand-assets/ by `npm run brand`). */
export const MARK = `${import.meta.env.BASE_URL}mark.png`;

export function applyBrand() {
  const c = brand.colors;
  const root = document.documentElement.style;
  root.setProperty("--color-sun", c.primary);
  root.setProperty("--color-sun-deep", c.primaryDeep);
  root.setProperty("--color-sun-soft", c.primarySoft);
  document.title = brand.name;
}
