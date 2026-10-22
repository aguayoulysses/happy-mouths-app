// Google Business Profile: list reviews and post replies. Uses the agency's
// refresh token (same OAuth app as client-pulse), so it only works for
// locations the agency account manages. A business with no gbp_location_id
// simply has no review sync; its dashboard shows requests and taps only.

export function gbpConfigured(): boolean {
  return Boolean(process.env.GOOGLE_OAUTH_CLIENT_ID && process.env.GOOGLE_OAUTH_CLIENT_SECRET && process.env.GBP_REFRESH_TOKEN);
}

let cached: { token: string; expiresAt: number } | null = null;

async function getAccessToken(): Promise<string> {
  if (cached && Date.now() < cached.expiresAt - 60_000) return cached.token;
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_OAUTH_CLIENT_ID!,
      client_secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET!,
      refresh_token: process.env.GBP_REFRESH_TOKEN!,
      grant_type: "refresh_token",
    }),
  });
  const data = (await res.json()) as { access_token?: string; expires_in?: number; error?: string };
  if (!data.access_token) throw new Error(`GBP token refresh failed: ${data.error ?? "unknown"}`);
  cached = { token: data.access_token, expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000 };
  return cached.token;
}

async function gbpFetch(url: string, init?: RequestInit) {
  const token = await getAccessToken();
  const res = await fetch(url, {
    ...init,
    cache: "no-store",
    headers: { ...init?.headers, authorization: `Bearer ${token}`, "content-type": "application/json" },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`GBP ${res.status} ${url.split("?")[0]}: ${JSON.stringify(body).slice(0, 400)}`);
  return body;
}

export interface GbpReview {
  reviewName: string;
  starRating: number;
  comment: string;
  reviewerName: string;
  createTime: string;
  /** Later than createTime when the customer edited a review they wrote before. */
  updateTime: string;
  replyComment: string;
  replyTime: string;
}

const STARS: Record<string, number> = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 };

export async function listReviews(accountId: string, locationId: string): Promise<GbpReview[]> {
  const out: GbpReview[] = [];
  let pageToken = "";
  do {
    const params = new URLSearchParams({ pageSize: "50" });
    if (pageToken) params.set("pageToken", pageToken);
    const body = (await gbpFetch(`https://mybusiness.googleapis.com/v4/accounts/${accountId}/locations/${locationId}/reviews?${params}`)) as {
      reviews?: { name: string; starRating: string; comment?: string; reviewer?: { displayName?: string }; createTime: string; updateTime?: string; reviewReply?: { comment?: string; updateTime?: string } }[];
      nextPageToken?: string;
    };
    for (const r of body.reviews ?? []) {
      out.push({
        reviewName: r.name,
        starRating: STARS[r.starRating] ?? 0,
        comment: r.comment ?? "",
        reviewerName: r.reviewer?.displayName ?? "",
        createTime: r.createTime,
        updateTime: r.updateTime ?? r.createTime,
        replyComment: r.reviewReply?.comment ?? "",
        replyTime: r.reviewReply?.updateTime ?? "",
      });
    }
    pageToken = body.nextPageToken ?? "";
  } while (pageToken);
  return out;
}

export async function replyToReview(reviewName: string, comment: string) {
  await gbpFetch(`https://mybusiness.googleapis.com/v4/${reviewName}/reply`, { method: "PUT", body: JSON.stringify({ comment }) });
}

/** v4 media create: Google fetches the picture from `sourceUrl` and adds it to the listing. Returns the media name. */
export async function createPhotoFromUrl(accountId: string, locationId: string, sourceUrl: string): Promise<string> {
  const media = (await gbpFetch(`https://mybusiness.googleapis.com/v4/accounts/${accountId}/locations/${locationId}/media`, {
    method: "POST",
    body: JSON.stringify({ mediaFormat: "PHOTO", locationAssociation: { category: "ADDITIONAL" }, sourceUrl }),
  })) as { name?: string };
  return media.name ?? "";
}

export type DailyInsight = { date: string; views: number; calls: number };

/** Google's daily numbers for one profile over [since, until] (YYYY-MM-DD): people who saw it, and taps on Call. */
export async function fetchDailyInsights(locationId: string, since: string, until: string): Promise<DailyInsight[]> {
  const [sy, sm, sd] = since.split("-").map(Number);
  const [uy, um, ud] = until.split("-").map(Number);
  const params = new URLSearchParams({
    "dailyRange.start_date.year": String(sy), "dailyRange.start_date.month": String(sm), "dailyRange.start_date.day": String(sd),
    "dailyRange.end_date.year": String(uy), "dailyRange.end_date.month": String(um), "dailyRange.end_date.day": String(ud),
  });
  for (const m of ["BUSINESS_IMPRESSIONS_DESKTOP_MAPS", "BUSINESS_IMPRESSIONS_DESKTOP_SEARCH", "BUSINESS_IMPRESSIONS_MOBILE_MAPS", "BUSINESS_IMPRESSIONS_MOBILE_SEARCH", "CALL_CLICKS"]) params.append("dailyMetrics", m);
  const body = (await gbpFetch(`https://businessprofileperformance.googleapis.com/v1/locations/${locationId}:fetchMultiDailyMetricsTimeSeries?${params}`)) as {
    multiDailyMetricTimeSeries?: { dailyMetricTimeSeries?: { dailyMetric: string; timeSeries?: { datedValues?: { date: { year: number; month: number; day: number }; value?: string }[] } }[] }[];
  };
  const byDate = new Map<string, DailyInsight>();
  for (const group of body.multiDailyMetricTimeSeries ?? []) {
    for (const series of group.dailyMetricTimeSeries ?? []) {
      for (const dv of series.timeSeries?.datedValues ?? []) {
        const date = `${dv.date.year}-${String(dv.date.month).padStart(2, "0")}-${String(dv.date.day).padStart(2, "0")}`;
        const row = byDate.get(date) ?? { date, views: 0, calls: 0 };
        if (series.dailyMetric === "CALL_CLICKS") row.calls += Number(dv.value ?? 0);
        else row.views += Number(dv.value ?? 0);
        byDate.set(date, row);
      }
    }
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}
