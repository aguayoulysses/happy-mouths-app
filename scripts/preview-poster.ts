// See a template with any name on it before a client goes live.
// Usage: npx tsx scripts/preview-poster.ts <template-key> "<Name>" [more names...]
import { renderPoster, TEMPLATES } from "@/lib/poster-render";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execSync } from "node:child_process";

(async () => {
  const [key, ...names] = process.argv.slice(2);
  const tpl = TEMPLATES[key];
  if (!tpl) throw new Error(`No template "${key}". Have: ${Object.keys(TEMPLATES).join(", ")}`);
  for (const name of names.length ? names : ["Anika", "Christopher"]) {
    const out = path.join(os.tmpdir(), `poster-${key}-${name}.jpg`);
    fs.writeFileSync(out, await renderPoster(name, tpl));
    console.log(out);
    if (process.platform === "darwin") execSync(`open "${out}"`);
  }
})();
