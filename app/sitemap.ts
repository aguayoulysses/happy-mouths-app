import type { MetadataRoute } from "next";
import { SITE } from "@/lib/whitelabel";

export default function sitemap(): MetadataRoute.Sitemap {
  return ["", "/privacy", "/support"].map((p) => ({ url: SITE + p, changeFrequency: "monthly", priority: p === "" ? 1 : 0.7 }));
}
