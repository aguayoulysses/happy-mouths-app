// Turn the review gate on for one business and put the link on its own domain.
// Usage: set -a; source .env.turso.local; set +a; SLUG=<slug> GATE_URL=https://theirsite.com/review npx tsx scripts/gate-on.ts
// The site has to rewrite GATE_URL/:code to https://<your domain>/r/:code (in the client site's vercel.json).
import { one, run } from "../lib/db";

const slug = process.env.SLUG ?? "sample-landscaping";
const gateUrl = (process.env.GATE_URL ?? "").replace(/\/$/, "");
const off = process.env.OFF === "1";

(async () => {
  const b = await one<{ id: number; name: string }>("SELECT id, name FROM businesses WHERE slug=?", [slug]);
  if (!b) throw new Error(`no business ${slug}`);
  await run("UPDATE businesses SET gate_enabled=?, gate_url=? WHERE id=?", [off ? 0 : 1, off ? "" : gateUrl, b.id]);
  console.log(`${b.name}: gate ${off ? "OFF" : "ON"}${gateUrl && !off ? `, link ${gateUrl}/<code>` : ""}`);
})();
