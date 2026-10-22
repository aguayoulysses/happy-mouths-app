import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { Group, Row, Stars, Skeleton, EmptyRow, Masthead } from "../ui/bits";
import { Sheet } from "../ui/Sheet";
import { tap } from "../lib/native";
import { MARK, NAME } from "../brand";

type R = { id: number; star_rating: number; comment: string; reviewer_name: string; create_time: string; reply_comment: string; reply_time: string };

export function Reviews({ business }: { business: { review_link: string; gbp_linked: boolean } }) {
  const [data, setData] = useState<{ reviews: R[]; linked: boolean } | null>(null);
  const [sel, setSel] = useState<R | null>(null);

  useEffect(() => {
    api<{ reviews: R[]; linked: boolean }>("/api/v1/reviews").then(setData);
  }, []);

  const fmt = (s: string) => (s ? new Date(s).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "");
  const avg = data && data.reviews.length ? data.reviews.reduce((a, r) => a + r.star_rating, 0) / data.reviews.length : 0;
  const recent = data?.reviews.filter((r) => Date.now() - new Date(r.create_time).getTime() < 30 * 86400_000).length ?? 0;

  const item = (r: R) => (
    <Row key={r.id} onClick={() => { tap(); setSel(r); }}>
      <div className="min-w-0 flex-1 py-1">
        <div className="flex items-center justify-between gap-3">
          <span className="truncate text-[15px] font-semibold">{r.reviewer_name || "Anonymous"}</span>
          <span className="shrink-0 text-[12px] text-ink-mute">{fmt(r.create_time)}</span>
        </div>
        <div className="mt-0.5 flex items-center gap-2">
          <Stars n={r.star_rating} size={13} />
          <span className="text-[12px] font-medium text-ink-mute">{r.reply_comment ? "Replied" : "Reply on the way"}</span>
        </div>
        {r.comment && <p className="mt-1 line-clamp-2 text-[14px] leading-snug text-ink-soft">{r.comment}</p>}
      </div>
    </Row>
  );

  return (
    <>
      <Masthead />
      <div className="mt-5 flex items-center justify-between gap-3 md:mt-3">
        <h1 className="h-page">Reviews</h1>
        {business.review_link && <a href={business.review_link} target="_blank" rel="noreferrer" className="btn btn-ghost btn-sm">Your Google page</a>}
      </div>

      {data && !data.linked && (
        <Group className="mt-5 p-5">
          <p className="text-[15px] font-semibold">Reviews aren&rsquo;t syncing yet</p>
          <p className="mt-1 text-[14px] leading-relaxed text-ink-soft">Once your Google Business Profile is connected, every review shows up here and we answer each one for you.</p>
        </Group>
      )}

      {!data && <Group className="mt-5">{[0, 1, 2].map((i) => <Row key={i}><div className="flex-1"><Skeleton h={14} w="30%" /><Skeleton h={12} w="80%" className="mt-2" /></div></Row>)}</Group>}

      {data?.linked && (
        <>
          {data.reviews.length > 0 && (
            <Group className="mt-5 px-5 py-4">
              <div className="flex items-baseline gap-3">
                <span className="text-[34px] font-bold leading-none tracking-[-0.03em]">{avg.toFixed(1)}</span>
                <Stars n={avg} size={16} />
              </div>
              <p className="mt-2 text-[14px] text-ink-soft"><span className="font-semibold text-ink">{data.reviews.length} reviews</span>, {recent} in the last 30 days.</p>
              <div className="mt-3 flex items-center gap-2.5 rounded-2xl bg-ground px-3.5 py-2.5">
                <img src={MARK} alt="" width={26} height={26} />
                <span className="text-[13px] font-medium text-ink-soft">{NAME} replies to every review for you, usually within the hour.</span>
              </div>
            </Group>
          )}
          <Group className="mt-4">
            {data.reviews.map(item)}
            {data.reviews.length === 0 && <EmptyRow title="No reviews yet" body="They'll show up here within an hour of being posted on Google." />}
          </Group>
        </>
      )}

      <Sheet open={!!sel} onClose={() => setSel(null)} title={sel ? `${sel.reviewer_name || "Anonymous"}` : ""}>
        {sel && (
          <div className="mt-1">
            <div className="flex items-center gap-2"><Stars n={sel.star_rating} /><span className="text-[12px] text-ink-mute">{fmt(sel.create_time)}</span></div>
            {sel.comment && <p className="mt-3 text-[15px] leading-relaxed">{sel.comment}</p>}
            {sel.reply_comment ? (
              <div className="mt-4 rounded-2xl bg-ground p-4 text-[14px]">
                <p className="text-[12px] font-semibold text-ink-soft">Our reply, {fmt(sel.reply_time)}</p>
                <p className="mt-1 leading-relaxed">{sel.reply_comment}</p>
              </div>
            ) : (
              <p className="mt-4 text-[14px] text-ink-soft">We&rsquo;ll post a reply within the hour.</p>
            )}
          </div>
        )}
      </Sheet>
    </>
  );
}
