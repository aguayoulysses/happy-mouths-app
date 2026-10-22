// Reads a logo and picks the two colors that go on the business's documents.
// Server only (native canvas). The color math itself lives in lib/brand.ts.

import { createCanvas, loadImage } from "@napi-rs/canvas";
import { one, run } from "./db";
import { cleanHex, resolveBrand, toHex, type Brand, type Rgb } from "./brand";

const LOGO_MAX = 480;

type Cluster = { rgb: Rgb; count: number };

function saturation([r, g, b]: Rgb): number {
  const max = Math.max(r, g, b) / 255;
  const min = Math.min(r, g, b) / 255;
  const l = (max + min) / 2;
  if (max === min) return 0;
  return (max - min) / (1 - Math.abs(2 * l - 1));
}

function lightness([r, g, b]: Rgb): number {
  return (Math.max(r, g, b) + Math.min(r, g, b)) / 510;
}

function distance(a: Rgb, b: Rgb): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

/** The logo's colors, biggest first. White and see-through pixels are the background, so they don't count. */
function clusters(pixels: Uint8ClampedArray): Cluster[] {
  const buckets = new Map<number, { sum: [number, number, number]; count: number }>();
  for (let i = 0; i < pixels.length; i += 4) {
    if (pixels[i + 3] < 128) continue;
    const rgb: Rgb = [pixels[i], pixels[i + 1], pixels[i + 2]];
    if (lightness(rgb) > 0.92) continue;
    const key = ((rgb[0] >> 4) << 8) | ((rgb[1] >> 4) << 4) | (rgb[2] >> 4);
    const bucket = buckets.get(key) ?? { sum: [0, 0, 0], count: 0 };
    bucket.sum[0] += rgb[0];
    bucket.sum[1] += rgb[1];
    bucket.sum[2] += rgb[2];
    bucket.count++;
    buckets.set(key, bucket);
  }
  // Neighboring shades fold into the biggest one; its own color stands for the group, so soft
  // edges don't wash it out.
  const sorted = [...buckets.values()].sort((a, b) => b.count - a.count);
  const out: Cluster[] = [];
  for (const bucket of sorted) {
    const rgb: Rgb = [bucket.sum[0] / bucket.count, bucket.sum[1] / bucket.count, bucket.sum[2] / bucket.count];
    const near = out.find((c) => distance(c.rgb, rgb) < 48);
    if (near) near.count += bucket.count;
    else out.push({ rgb, count: bucket.count });
  }
  return out.sort((a, b) => b.count - a.count);
}

export function pickColors(pixels: Uint8ClampedArray): { main: string; accent: string } | null {
  const found = clusters(pixels);
  const total = found.reduce((n, c) => n + c.count, 0);
  if (!total) return null;
  const main = found[0];
  // The accent is the loudest color that is clearly not the main one.
  const accent = found
    .filter((c) => c !== main && c.count / total >= 0.015 && saturation(c.rgb) >= 0.35 && lightness(c.rgb) > 0.22 && lightness(c.rgb) < 0.82 && distance(c.rgb, main.rgb) > 70)
    .sort((a, b) => b.count * saturation(b.rgb) - a.count * saturation(a.rgb))[0];
  return { main: toHex(main.rgb), accent: toHex((accent ?? main).rgb) };
}

/**
 * Gets an uploaded logo ready for documents: reads its colors, shrinks big files, and turns
 * formats the PDF cannot draw (WebP, GIF) into PNG. Null when the file is not a readable picture.
 */
export async function prepareLogo(bytes: Uint8Array, contentType: string): Promise<{ bytes: Uint8Array; contentType: string; main: string; accent: string } | null> {
  try {
    const img = await loadImage(Buffer.from(bytes));
    if (!img.width || !img.height) return null;
    const sample = createCanvas(96, 96);
    sample.getContext("2d").drawImage(img, 0, 0, 96, 96);
    const colors = pickColors(sample.getContext("2d").getImageData(0, 0, 96, 96).data) ?? { main: "", accent: "" };

    const scale = Math.min(1, LOGO_MAX / Math.max(img.width, img.height));
    const pdfSafe = contentType === "image/png" || contentType === "image/jpeg";
    if (scale === 1 && pdfSafe) return { bytes, contentType, ...colors };
    const w = Math.max(1, Math.round(img.width * scale));
    const h = Math.max(1, Math.round(img.height * scale));
    const canvas = createCanvas(w, h);
    canvas.getContext("2d").drawImage(img, 0, 0, w, h);
    return contentType === "image/jpeg"
      ? { bytes: new Uint8Array(canvas.toBuffer("image/jpeg", 90)), contentType: "image/jpeg", ...colors }
      : { bytes: new Uint8Array(canvas.toBuffer("image/png")), contentType: "image/png", ...colors };
  } catch {
    return null;
  }
}

/**
 * The colors for this business's documents. A business that got its logo before colors existed
 * has them read from the logo the first time one of its documents is opened, then saved.
 */
export async function brandFor(b: { id: number; logo_url: string; brand_color: string; brand_accent: string }): Promise<Brand> {
  if (cleanHex(b.brand_color) || !b.logo_url) return resolveBrand(b);
  try {
    const key = b.logo_url.split("/").pop()?.replace(/\.[a-z]+$/, "") ?? "";
    const row = await one<{ data: ArrayBuffer | Uint8Array }>("SELECT data FROM media WHERE key=?", [key]);
    if (!row) return resolveBrand(b);
    const img = await loadImage(Buffer.from(new Uint8Array(row.data as ArrayBuffer)));
    const sample = createCanvas(96, 96);
    sample.getContext("2d").drawImage(img, 0, 0, 96, 96);
    const colors = pickColors(sample.getContext("2d").getImageData(0, 0, 96, 96).data);
    if (!colors) return resolveBrand(b);
    await run("UPDATE businesses SET brand_color=?, brand_accent=? WHERE id=? AND brand_color=''", [colors.main, colors.accent, b.id]);
    return resolveBrand({ brand_color: colors.main, brand_accent: colors.accent });
  } catch {
    return resolveBrand(b);
  }
}
