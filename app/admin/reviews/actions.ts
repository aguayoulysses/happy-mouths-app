"use server";

import { redirect } from "next/navigation";
import { one, run, logEvent } from "@/lib/db";
import { isAdmin } from "@/lib/auth";
import { draftReviewReply } from "@/lib/ai";
import { replyToReview } from "@/lib/gbp";
import type { StoredReview } from "@/lib/reviews";

function back(business: string, msg: string) {
  redirect(`/admin/reviews?${business ? `business=${business}&` : ""}msg=${encodeURIComponent(msg)}`);
}

export async function draftReplyAction(form: FormData) {
  if (!(await isAdmin())) redirect("/admin/login");
  const id = Number(form.get("id"));
  const business = String(form.get("business") ?? "");
  const review = await one<StoredReview>("SELECT * FROM reviews WHERE id=?", [id]);
  const biz = review ? await one<{ name: string; owner_name: string }>("SELECT name, owner_name FROM businesses WHERE id=?", [review.business_id]) : null;
  if (!review || !biz) back(business, "Review not found");
  try {
    const draft = await draftReviewReply(biz!, review!);
    await run("UPDATE reviews SET draft_reply=? WHERE id=?", [draft, id]);
    back(business, draft ? `Drafted a reply for ${review!.reviewer_name || "the review"}` : "Claude declined to draft that one");
  } catch (err) {
    back(business, `Draft failed: ${err instanceof Error ? err.message : String(err)}`.slice(0, 200));
  }
}

export async function postReplyAction(form: FormData) {
  if (!(await isAdmin())) redirect("/admin/login");
  const id = Number(form.get("id"));
  const business = String(form.get("business") ?? "");
  const comment = String(form.get("comment") ?? "").trim();
  if (!comment) back(business, "Write the reply first");
  const review = await one<StoredReview>("SELECT * FROM reviews WHERE id=?", [id]);
  if (!review) back(business, "Review not found");
  try {
    await replyToReview(review!.review_name, comment);
  } catch (err) {
    back(business, `Google rejected it: ${err instanceof Error ? err.message : String(err)}`.slice(0, 250));
  }
  await run("UPDATE reviews SET reply_comment=?, reply_time=datetime('now'), draft_reply='' WHERE id=?", [comment, id]);
  await logEvent(review!.business_id, "replied", `We replied to ${review!.reviewer_name || "a review"}`);
  back(business, `Posted the reply to ${review!.reviewer_name || "the review"}`);
}
