// Each business has an ordered list of texts. Step 1 goes out `delay_minutes`
// after the customer is added; every later step goes out `delay_minutes` after
// the previous one. The sequence stops the moment we see the review on Google
// (hourly sync), the customer texts STOP, or the steps run out. Owners never
// edit this; it is set up by us in admin.

import { all, run } from "./db";

export type Step = { id: number; business_id: number; position: number; delay_minutes: number; body: string; poster_template: string };

// The house default wording: step 1 rides with the sign photo, step 2 with the
// sad meme ("we're not okay"), step 3 is words only. Tweak per client in ops (e.g. "your car", "your yard").
export const DEFAULT_STEPS: { delay_minutes: number; body: string }[] = [
  { delay_minutes: 120, body: "Hi {name}, {business} here. Thank you for trusting us. One quick Google review helps our small business more than you'd think: {link}" },
  { delay_minutes: 3 * 24 * 60, body: "{name}, we're not okay over here at {business}. A quick review would cheer us up. Takes 30 seconds: {link}" },
  { delay_minutes: 7 * 24 * 60, body: "Last one from us, {name}. If you were happy with {business}, a short review would mean a lot: {link}" },
];

export async function getSteps(businessId: number): Promise<Step[]> {
  const rows = await all<Step>("SELECT * FROM sequence_steps WHERE business_id=? ORDER BY position", [businessId]);
  if (rows.length) return rows;
  await run("DELETE FROM sequence_steps WHERE business_id=?", [businessId]);
  for (let i = 0; i < DEFAULT_STEPS.length; i++) {
    await run("INSERT INTO sequence_steps (business_id, position, delay_minutes, body) VALUES (?,?,?,?)", [businessId, i + 1, DEFAULT_STEPS[i].delay_minutes, DEFAULT_STEPS[i].body]);
  }
  return all<Step>("SELECT * FROM sequence_steps WHERE business_id=? ORDER BY position", [businessId]);
}

/** Replace the whole sequence. Bodies without {link} get it appended so the request is never link-less. */
export async function saveSteps(businessId: number, steps: { delay_minutes: number; body: string; poster_template?: string }[]) {
  await run("DELETE FROM sequence_steps WHERE business_id=?", [businessId]);
  let pos = 1;
  for (const st of steps) {
    const body = st.body.trim();
    if (!body) continue;
    await run("INSERT INTO sequence_steps (business_id, position, delay_minutes, body, poster_template) VALUES (?,?,?,?,?)", [
      businessId, pos++, Math.max(0, Math.round(st.delay_minutes) || 0), /\{link\}/i.test(body) ? body : `${body} {link}`, (st.poster_template ?? "").trim(),
    ]);
  }
}
