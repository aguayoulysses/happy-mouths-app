import { json, fail, preflight } from "@/lib/api";
import { requireBusiness } from "@/lib/guard";
import { listThreads, searchMessages } from "@/lib/conversations";

export const OPTIONS = preflight;

// One thread per customer phone number, newest activity first. ?q= searches names, numbers and texts.
// With ?split=1 the answer is grouped like Messages on the iPhone: `threads` = the people whose name or
// number matches, `hits` = the individual texts whose words match (tap one to land on that text).
export async function GET(req: Request) {
  const { b, res } = await requireBusiness(req);
  if (!b) return res;
  if (!b.feature_messages) return fail("Customer texts are not on for this account.", 404);
  const p = new URL(req.url).searchParams;
  const q = p.get("q") ?? "";
  if (q.trim() && p.get("split") === "1") {
    const [threads, hits] = await Promise.all([listThreads(b.id, q, "contact"), searchMessages(b.id, q)]);
    return json({ threads, hits });
  }
  return json({ threads: await listThreads(b.id, q) });
}
