// Rebuilds the App Review / sales demo account (see lib/seed-review-demo.ts), with the job photos in data/demo-photos.
//
//   set -a; source .env.turso.local; set +a
//   BASE_URL=https://yourbrand.com npx tsx scripts/seed-review-demo.ts

import fs from "node:fs";
import { seedReviewDemo, DEMO_EMAIL } from "@/lib/seed-review-demo";

(async () => {
  const dir = "data/demo-photos";
  const photos = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith(".jpg")).sort().map((f) => new Uint8Array(fs.readFileSync(`${dir}/${f}`))) : [];
  console.log(await seedReviewDemo(photos), `Login: ${DEMO_EMAIL}`);
})();
