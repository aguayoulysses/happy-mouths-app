// Drafts a reply to a Google review in the owner's voice. The owner always
// reads and approves before anything is posted. Deliberately short output.

import Anthropic from "@anthropic-ai/sdk";
import type { StoredReview } from "./reviews";

export function aiConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

export async function draftReviewReply(business: { name: string; owner_name: string }, review: StoredReview): Promise<string> {
  const client = new Anthropic();
  const stars = review.star_rating;
  const system =
    `You write short, warm replies to Google reviews on behalf of a local business owner. ` +
    `Sound like a real person who runs the place, not a brand. Two to four sentences. ` +
    `Use the reviewer's first name if there is one. Mention one specific thing from the review when there is one. ` +
    `Never offer discounts or ask them to change the rating. For 1-3 star reviews: apologize once, own it, ` +
    `and invite them to reach out directly so it can be made right. No hashtags, no emojis, no sign-off line. ` +
    `Never use dashes or hyphens of any kind (no "-", no "–", no "—"); use a comma or start a new sentence instead.`;
  const user =
    `Business: ${business.name}\nOwner: ${business.owner_name || "the owner"}\n` +
    `Rating: ${stars} of 5\nReviewer: ${review.reviewer_name || "Anonymous"}\n` +
    `Review: ${review.comment || "(no text, rating only)"}\n\nWrite the reply.`;
  const res = await client.messages.create({
    model: "claude-opus-5",
    max_tokens: 1024,
    output_config: { effort: "low" },
    system,
    messages: [{ role: "user", content: user }],
  });
  if (res.stop_reason === "refusal") return "";
  return stripDashes(
    res.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim()
  );
}

/** Dashes read as machine-written. Turn " - ", " – " and "—" into a comma, and any leftover into a space. */
export function stripDashes(text: string): string {
  return text
    .replace(/\s*[—–]\s*/g, ", ")
    .replace(/\s+-\s+/g, ", ")
    .replace(/(\w)-(\w)/g, "$1 $2")
    .replace(/-/g, " ")
    .replace(/,\s*,/g, ",")
    .replace(/ {2,}/g, " ")
    .trim();
}

/** One customer who was asked for a review, as the matcher sees them. */
export type MatchCandidate = { id: number; name: string; minutesBefore: number | null; stars: number };

/**
 * Which of these customers is the Google reviewer? Names on a client's list are
 * often nicknames or misspellings of the Google display name ("Cathie" for
 * Catherine, "Beto" for Roberto, a spouse's account), and several people tap
 * the review link within the same minutes when a batch goes out, so timing
 * alone can't decide either. Claude weighs both and only answers when sure.
 * Returns the candidate id, or null.
 */
export async function matchReviewer(reviewer: string, candidates: MatchCandidate[]): Promise<{ id: number | null; why: string }> {
  if (!candidates.length || !reviewer.trim()) return { id: null, why: "nothing to compare" };
  const client = new Anthropic();
  const system =
    `You link a Google review to the customer who most likely wrote it. You are given the reviewer's Google display name and a ` +
    `list of customers the business recently texted a review link to. For each customer you get the name the business has on file, ` +
    `how many minutes before the review they tapped the link and rated it (null if they never tapped), and the stars they gave. ` +
    `Names on file are often nicknames, shortened forms, misspellings or Spanish/English variants of the Google name ` +
    `(Cathie/Catherine, Mike/Michael, Beto/Roberto, Yackie/Jacqueline). A Google handle with no real name (Darkninja691) ` +
    `matches nobody by name; then only a single customer who tapped within a few minutes before the review is a safe match. ` +
    `If two or more customers fit about equally, answer null. Reply with JSON only: {"id": <candidate id or null>, "why": "<one short sentence>"}.`;
  const user =
    `Google reviewer: ${JSON.stringify(reviewer)}\n\nCandidates:\n` +
    candidates.map((c) => `- id ${c.id}: name on file ${JSON.stringify(c.name || "(blank)")}, tapped ${c.minutesBefore === null ? "never" : `${c.minutesBefore} min before the review`}, stars ${c.stars || "none"}`).join("\n");
  const res = await client.messages.create({
    model: "claude-opus-5",
    max_tokens: 300,
    output_config: { effort: "low" },
    system,
    messages: [{ role: "user", content: user }],
  });
  if (res.stop_reason === "refusal") return { id: null, why: "refused" };
  const text = res.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map((b) => b.text).join("");
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return { id: null, why: "no answer" };
  try {
    const j = JSON.parse(m[0]) as { id?: unknown; why?: unknown };
    const id = typeof j.id === "number" && candidates.some((c) => c.id === j.id) ? j.id : null;
    return { id, why: typeof j.why === "string" ? j.why.slice(0, 200) : "" };
  } catch {
    return { id: null, why: "unreadable answer" };
  }
}
