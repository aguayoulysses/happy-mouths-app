// Writes a customer's first name onto the blank sign in a business's team
// photo, so the review text arrives with "their" sign held up by real people.
// All code, no image model: the name is drawn flat in a marker font with a
// little per-letter wobble (seeded by the name, so the same customer always
// gets the same image), warped into the sign's four corners, and multiplied
// into the photo so the board's own shading and grain show through the ink.

import { createCanvas, loadImage, GlobalFonts } from "@napi-rs/canvas";
import path from "node:path";
import fs from "node:fs";

export type Pt = [number, number];
export type PosterTemplate = {
  /** File under lib/poster-assets. */
  image: string;
  /** Photo bytes, for templates uploaded in admin (stored in the database, not the repo). */
  data?: Buffer;
  /** "sign" (default) writes the name on a held board. "caption" is a meme: outlined capitals across the bottom of the photo. */
  kind?: "sign" | "caption";
  /** Sign corners in photo pixels: top-left, top-right, bottom-right, bottom-left. */
  quad?: [Pt, Pt, Pt, Pt];
  /** Caption text; {name} becomes the customer's first name. */
  caption?: string;
  font?: keyof typeof FONTS;
  /** Marker colour. Near-black reads as a real marker; pure black reads as pasted on. */
  ink?: [number, number, number];
};

/** Bump when the drawing code changes how an image looks (see lib/poster.ts). */
export const RENDER_VERSION = "3";

const ASSETS = path.join(process.cwd(), "lib", "poster-assets");
const FONTS = {
  gochi: "GochiHand-Regular.ttf",
  marker: "PermanentMarker-Regular.ttf",
  grace: "CoveredByYourGrace.ttf",
  reenie: "ReenieBeanie.ttf",
  anton: "Anton-Regular.ttf",
} as const;

// One entry per sign photo, written by scripts/new-poster-template.py. Adding a client is a
// photo + a line of JSON, never a code change.
import templates from "./poster-assets/templates.json";
export const TEMPLATES = templates as unknown as Record<string, PosterTemplate>;

let fontsReady = false;
function fonts() {
  if (fontsReady) return;
  for (const [family, file] of Object.entries(FONTS)) GlobalFonts.registerFromPath(path.join(ASSETS, "fonts", file), `hm-${family}`);
  fontsReady = true;
}

/** Small deterministic RNG so a name always renders the same way. */
function rng(seed: string) {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  return () => {
    h += 0x6d2b79f5;
    let t = h;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 3x3 homography mapping the unit-less flat sign (w x h) onto the photo quad. Returns the inverse (photo → flat). */
function photoToFlat(quad: [Pt, Pt, Pt, Pt], w: number, h: number): number[] {
  const src: Pt[] = quad;
  const dst: Pt[] = [[0, 0], [w, 0], [w, h], [0, h]];
  const A: number[][] = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = src[i];
    const [u, v] = dst[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y, u]);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y, v]);
  }
  for (let c = 0; c < 8; c++) {
    let p = c;
    for (let r = c + 1; r < 8; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    [A[c], A[p]] = [A[p], A[c]];
    for (let r = 0; r < 8; r++) {
      if (r === c) continue;
      const f = A[r][c] / A[c][c];
      for (let k = c; k < 9; k++) A[r][k] -= f * A[c][k];
    }
  }
  return [...A.map((row, i) => row[8] / row[i]), 1];
}

const dist = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1]);

/** The name as a flat alpha mask the size of the sign, supersampled. */
function drawName(name: string, w: number, h: number, family: string): Uint8ClampedArray {
  const rand = rng(name.toLowerCase());
  const canvas = createCanvas(w, h);
  const ctx = canvas.getContext("2d");
  const text = name.trim().slice(0, 18) || "You";

  // Biggest size that fits the writable middle of the board.
  let size = h * (family.endsWith("reenie") ? 0.95 : 0.62);
  const widthAt = (s: number) => {
    ctx.font = `${s}px ${family}`;
    return [...text].reduce((sum, ch) => sum + ctx.measureText(ch).width * 1.02, 0);
  };
  const maxW = w * 0.78;
  if (widthAt(size) > maxW) size *= maxW / widthAt(size);
  size = Math.max(size, h * 0.16);
  const total = widthAt(size);

  ctx.fillStyle = "#000";
  ctx.strokeStyle = "#000";
  ctx.lineJoin = "round";
  ctx.lineWidth = size * (family.endsWith("reenie") ? 0.034 : 0.012); // marker weight: the thin pen fonts need fattening up
  ctx.textBaseline = "alphabetic";

  // People write slightly uphill and a bit off-centre.
  const slope = (rand() - 0.35) * 0.05;
  ctx.translate(w / 2 + (rand() - 0.5) * w * 0.03, h / 2 + size * 0.3 + (rand() - 0.5) * h * 0.04);
  ctx.rotate(-slope);
  let x = -total / 2;
  for (const ch of text) {
    ctx.font = `${size}px ${family}`;
    const adv = ctx.measureText(ch).width * 1.02;
    ctx.save();
    ctx.translate(x + adv / 2, (rand() - 0.5) * size * 0.05);
    ctx.rotate((rand() - 0.5) * 0.09);
    const s = 1 + (rand() - 0.5) * 0.08;
    ctx.scale(s, s * (1 + (rand() - 0.5) * 0.06));
    ctx.fillText(ch, -adv / 2, 0);
    ctx.strokeText(ch, -adv / 2, 0);
    ctx.restore();
    x += adv + (rand() - 0.5) * size * 0.03;
  }
  const px = ctx.getImageData(0, 0, w, h).data;
  const alpha = new Uint8ClampedArray(w * h);
  for (let i = 0; i < w * h; i++) alpha[i] = px[i * 4 + 3];
  return alpha;
}

/** Meme layout: classic white capitals with a black outline, printed on the photo itself.
 *  Bottom of the frame, because in these photos the face is at the top. No bars or frames:
 *  chat apps round and crop the image edges, which mangles anything drawn along them. */
async function renderCaption(name: string, tpl: PosterTemplate): Promise<Buffer> {
  const photo = await loadImage(tpl.data ?? path.join(ASSETS, tpl.image));
  const W = photo.width;
  const H = photo.height;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(photo, 0, 0);
  // An emoji in the caption (one we have a picture for in poster-assets/emoji) is drawn above the words.
  const raw = tpl.caption ?? "When {name} hasn't left me a review";
  const emoji = [...raw].map((c) => c.codePointAt(0)!.toString(16)).find((cp) => fs.existsSync(path.join(ASSETS, "emoji", `${cp}.png`)));
  const text = raw.replace(/\p{Extended_Pictographic}\uFE0F?/gu, "").replace(/\s+/g, " ").trim().replace(/\{name\}/g, name.trim().slice(0, 18) || "you").toUpperCase();
  let size = Math.round(W * 0.092);
  const side = Math.round(W * 0.07); // chat bubbles clip the edges; keep the words well inside
  ctx.font = `${size}px hm-anton`;
  // Two even lines is the look. Long names shrink the type a little before a third line is
  // allowed, and break points are chosen to make the lines most equal (no lonely word).
  const words = text.split(/\s+/);
  const maxW = W - side * 2;
  const width = (a: number, b: number) => ctx.measureText(words.slice(a, b).join(" ")).width;
  const split = (n: number): string[] | null => {
    let best: { cuts: number[]; cost: number } | null = null;
    const walk = (start: number, left: number, cuts: number[], cost: number) => {
      if (left === 1) {
        const w = width(start, words.length);
        if (w <= maxW && (!best || cost + w * w < best.cost)) best = { cuts, cost: cost + w * w };
        return;
      }
      for (let end = start + 1; end <= words.length - (left - 1); end++) {
        const w = width(start, end);
        if (w > maxW) break;
        walk(end, left - 1, [...cuts, end], cost + w * w);
      }
    };
    walk(0, n, [], 0);
    if (!best) return null;
    const cuts = [0, ...(best as { cuts: number[] }).cuts, words.length];
    return cuts.slice(1).map((c, i) => words.slice(cuts[i], c).join(" "));
  };
  let lines: string[] | null = null;
  for (const [n, k] of [[1, 1], [2, 1], [2, 0.9], [2, 0.82], [3, 0.9], [4, 0.82]] as const) {
    size = Math.round(W * 0.092 * k);
    ctx.font = `${size}px hm-anton`;
    lines = split(n);
    if (lines) break;
  }
  lines = lines ?? [text];
  const lineH = Math.round(size * 1.16);
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.lineJoin = "round";
  ctx.strokeStyle = "#000";
  ctx.lineWidth = size * 0.16;
  ctx.fillStyle = "#fff";
  const bottom = H - Math.round(H * 0.06);
  lines.forEach((l, i) => {
    const y = bottom - (lines.length - 1 - i) * lineH;
    ctx.strokeText(l, W / 2, y);
    ctx.fillText(l, W / 2, y);
  });
  if (emoji) {
    const e = Math.round(size * 1.5);
    const top = bottom - (lines.length - 1) * lineH - size;
    ctx.drawImage(await loadImage(path.join(ASSETS, "emoji", `${emoji}.png`)), (W - e) / 2, top - e - Math.round(size * 0.25), e, e);
  }
  return canvas.toBuffer("image/jpeg", 88);
}

export async function renderPoster(name: string, tpl: PosterTemplate = TEMPLATES.demo): Promise<Buffer> {
  fonts();
  if (tpl.kind === "caption") return renderCaption(name, tpl);
  if (!tpl.quad) throw new Error(`sign template ${tpl.image} has no quad`);
  const photo = await loadImage(tpl.data ?? path.join(ASSETS, tpl.image));
  const W = photo.width;
  const H = photo.height;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(photo, 0, 0);

  const q = tpl.quad;
  const SS = 2; // flat mask is drawn at 2x and sampled down, which also softens edges to match the photo
  const fw = Math.round(((dist(q[0], q[1]) + dist(q[3], q[2])) / 2) * SS);
  const fh = Math.round(((dist(q[0], q[3]) + dist(q[1], q[2])) / 2) * SS);
  const mask = drawName(name, fw, fh, `hm-${tpl.font ?? "reenie"}`);
  const M = photoToFlat(q, fw, fh);

  const x0 = Math.max(0, Math.floor(Math.min(...q.map((p) => p[0]))));
  const x1 = Math.min(W, Math.ceil(Math.max(...q.map((p) => p[0]))));
  const y0 = Math.max(0, Math.floor(Math.min(...q.map((p) => p[1]))));
  const y1 = Math.min(H, Math.ceil(Math.max(...q.map((p) => p[1]))));
  const bw = x1 - x0;
  const bh = y1 - y0;

  // Warp: for every photo pixel in the sign, look up the flat mask (box-averaged over the 2x2 supersample).
  const a = new Float32Array(bw * bh);
  for (let y = 0; y < bh; y++) {
    for (let x = 0; x < bw; x++) {
      const X = x + x0 + 0.5;
      const Y = y + y0 + 0.5;
      const d = M[6] * X + M[7] * Y + M[8];
      const u = (M[0] * X + M[1] * Y + M[2]) / d;
      const v = (M[3] * X + M[4] * Y + M[5]) / d;
      if (u < 1 || v < 1 || u >= fw - 1 || v >= fh - 1) continue;
      const ui = Math.floor(u);
      const vi = Math.floor(v);
      let sum = 0;
      for (let dy = -1; dy <= 0; dy++) for (let dx = -1; dx <= 0; dx++) sum += mask[(vi + dy) * fw + ui + dx];
      a[y * bw + x] = sum / (4 * 255);
    }
  }
  // One light blur pass: phone photos are never as sharp as vector text.
  const soft = new Float32Array(bw * bh);
  for (let y = 1; y < bh - 1; y++) {
    for (let x = 1; x < bw - 1; x++) {
      const i = y * bw + x;
      soft[i] = a[i] * 0.4 + (a[i - 1] + a[i + 1] + a[i - bw] + a[i + bw]) * 0.12 + (a[i - bw - 1] + a[i - bw + 1] + a[i + bw - 1] + a[i + bw + 1]) * 0.03;
    }
  }

  const ink = tpl.ink ?? [30, 30, 36];
  const rand = rng(`${name}:grain`);
  const img = ctx.getImageData(x0, y0, bw, bh);
  const d = img.data;
  for (let i = 0; i < bw * bh; i++) {
    if (soft[i] <= 0.004) continue;
    // Marker ink is slightly uneven; multiply keeps the board's shading and sensor grain under it.
    const k = Math.min(1, soft[i]) * (0.94 + rand() * 0.06);
    for (let c = 0; c < 3; c++) {
      const p = d[i * 4 + c];
      d[i * 4 + c] = p * (1 - k) + ((p * ink[c]) / 235) * k;
    }
  }
  ctx.putImageData(img, x0, y0);
  return canvas.toBuffer("image/jpeg", 88);
}

/** "demo" style keys come from templates.json; "db:<id>" keys are photos uploaded in admin. */
export async function resolveTemplate(key: string): Promise<PosterTemplate | null> {
  if (!key) return null;
  if (!key.startsWith("db:")) return TEMPLATES[key] ?? null;
  const { one } = await import("./db");
  const row = await one<{ id: number; kind: string; image: ArrayBuffer | Uint8Array; quad: string; caption: string }>(
    "SELECT id, kind, image, quad, caption FROM poster_images WHERE id=?", [Number(key.slice(3))]
  );
  if (!row) return null;
  return {
    image: key,
    data: Buffer.from(row.image as ArrayBuffer),
    kind: row.kind === "caption" ? "caption" : "sign",
    quad: row.quad ? (JSON.parse(row.quad) as [Pt, Pt, Pt, Pt]) : undefined,
    caption: row.caption || undefined,
  };
}

/** Short fingerprint of how a template renders, for cache-busting image addresses. */
export async function templateVersion(key: string): Promise<string> {
  const { createHash } = await import("node:crypto");
  const t = await resolveTemplate(key);
  if (!t) return "";
  return createHash("sha1").update(RENDER_VERSION + JSON.stringify({ ...t, data: t.data?.length })).digest("hex").slice(0, 8);
}

/**
 * Turn an uploaded photo into what we store: cropped so a phone shows all of it, at most 1000px
 * wide. Sign photos keep the board comfortably in frame with faces above it; meme photos keep
 * the top (where the face is) and lose floor. Returns the JPEG and the corners in its pixels.
 */
export async function prepareUpload(input: Buffer, kind: "sign" | "caption", quad?: [Pt, Pt, Pt, Pt]): Promise<{ jpeg: Buffer; quad?: [Pt, Pt, Pt, Pt] }> {
  const img = await loadImage(input);
  const W = img.width;
  const H = img.height;
  let x0 = 0, y0 = 0, cw = W, ch = H;
  if (kind === "sign" && quad) {
    const xs = quad.map((p) => p[0]);
    const ys = quad.map((p) => p[1]);
    const bw = Math.max(...xs) - Math.min(...xs);
    const bh = Math.max(...ys) - Math.min(...ys);
    // A tall board on a stand has the team standing beside it, not behind it: widen to keep them in.
    cw = Math.min(W, Math.max(bw * 1.5, bh * 1.5, bh > bw ? bw * 3.6 : 0));
    ch = Math.min(H, cw * 1.25);
    const cx = (Math.max(...xs) + Math.min(...xs)) / 2;
    const cy = (Math.max(...ys) + Math.min(...ys)) / 2 - bh * 0.25;
    x0 = Math.min(Math.max(0, cx - cw / 2), W - cw);
    y0 = Math.min(Math.max(0, cy - ch / 2), H - ch);
  } else if (kind === "caption") {
    ch = Math.min(H, W * 1.05);
  }
  const k = Math.min(1, 1000 / cw);
  const canvas = createCanvas(Math.round(cw * k), Math.round(ch * k));
  canvas.getContext("2d").drawImage(img, x0, y0, cw, ch, 0, 0, canvas.width, canvas.height);
  const out = quad ? (quad.map((p) => [Math.round((p[0] - x0) * k), Math.round((p[1] - y0) * k)]) as [Pt, Pt, Pt, Pt]) : undefined;
  return { jpeg: canvas.toBuffer("image/jpeg", 90), quad: out };
}

/** Any four clicks → top-left, top-right, bottom-right, bottom-left. */
export function orderQuad(pts: Pt[]): [Pt, Pt, Pt, Pt] {
  const bySum = [...pts].sort((a, b) => a[0] + a[1] - (b[0] + b[1]));
  const byDiff = [...pts].sort((a, b) => a[0] - a[1] - (b[0] - b[1]));
  return [bySum[0], byDiff[3], bySum[3], byDiff[0]];
}
