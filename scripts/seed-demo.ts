import { getDb } from "../lib/db.ts";
import { seedDemo } from "../lib/seed-demo.ts";

getDb()
  .then(seedDemo)
  .then((msg) => console.log(msg))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
