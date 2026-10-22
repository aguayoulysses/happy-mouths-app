// Rebrand in one command: `npm run brand`.
//
// Reads brand.json and the images in brand-assets/, then writes every logo, favicon, app icon
// and splash screen the site, the client app, the ops app and both iOS projects use, and sets
// the iOS name, bundle id, URL scheme and team. Run it again after any change to either.
//
//   brand-assets/mark.png        square logo, 1024x1024 or bigger (made from the name if missing)
//   brand-assets/team/<key>.png  photo for each person in brand.json "team" (initials if missing)

import fs from "node:fs";
import path from "node:path";
import { createCanvas, loadImage } from "@napi-rs/canvas";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const at = (...p) => path.join(ROOT, ...p);
const brand = JSON.parse(fs.readFileSync(at("brand.json"), "utf8"));
const initials = (s) => s.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join("");

function write(file, canvas) {
  fs.mkdirSync(path.dirname(at(file)), { recursive: true });
  fs.writeFileSync(at(file), canvas.toBuffer("image/png"));
  console.log("  wrote", file);
}

/** A circle in the brand color with the letters in white: the stand-in until a real logo is added. */
function lettered(text, size, bg) {
  const c = createCanvas(size, size);
  const ctx = c.getContext("2d");
  ctx.fillStyle = bg;
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#ffffff";
  ctx.font = `bold ${Math.round(size * (text.length > 1 ? 0.4 : 0.52))}px sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, size / 2, size / 2 + size * 0.03);
  return c;
}

async function source(file, fallback) {
  if (fs.existsSync(at(file))) return loadImage(fs.readFileSync(at(file)));
  return loadImage(fallback.toBuffer("image/png"));
}

/** The image fitted into a square canvas, on a solid background or transparent. */
function square(img, size, { bg = null, pad = 0 } = {}) {
  const c = createCanvas(size, size);
  const ctx = c.getContext("2d");
  if (bg) { ctx.fillStyle = bg; ctx.fillRect(0, 0, size, size); }
  const inner = size * (1 - pad * 2);
  const k = Math.min(inner / img.width, inner / img.height);
  const w = img.width * k, h = img.height * k;
  ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
  return c;
}

function patch(file, edits) {
  if (!fs.existsSync(at(file))) return;
  let s = fs.readFileSync(at(file), "utf8");
  for (const [re, to] of edits) s = s.replace(re, to);
  fs.writeFileSync(at(file), s);
  console.log("  patched", file);
}

const primary = brand.colors.primary;
console.log(`Branding as "${brand.name}"`);

const mark = await source("brand-assets/mark.png", lettered(initials(brand.name) || "B", 1024, primary));
write("public/brand/mark.png", square(mark, 256));
write("public/favicon.png", square(mark, 64));
write("public/apple-touch-icon.png", square(mark, 180, { bg: "#ffffff", pad: 0.08 }));
write("dashboard/public/mark.png", square(mark, 256));
write("dashboard/public/favicon.png", square(mark, 64));
write("dashboard/public/apple-touch-icon.png", square(mark, 180, { bg: "#ffffff", pad: 0.08 }));
write("ops-app/www/mark.png", square(mark, 256));

// App icons must be opaque; splash screens are the mark small on white.
for (const app of ["dashboard", "ops-app"]) {
  write(`${app}/ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png`, square(mark, 1024, { bg: "#ffffff", pad: 0.12 }));
  for (const n of ["splash-2732x2732.png", "splash-2732x2732-1.png", "splash-2732x2732-2.png"]) {
    write(`${app}/ios/App/App/Assets.xcassets/Splash.imageset/${n}`, square(mark, 2732, { bg: "#ffffff", pad: 0.42 }));
  }
}

for (const p of brand.team) {
  const img = await source(`brand-assets/team/${p.key}.png`, lettered(initials(p.name), 512, "#111111"));
  write(path.join("public", p.photo), square(img, 512));
}

// iOS: display name, bundle id, URL scheme, signing team.
const team = brand.ios.teamId ?? "";
patch("dashboard/ios/App/App/Info.plist", [
  [/(<key>CFBundleDisplayName<\/key>\s*<string>)[^<]*/, `$1${brand.name}`],
  [/(<key>CFBundleURLName<\/key>\s*<string>)[^<]*/, `$1${brand.ios.appId}`],
  [/(<key>CFBundleURLSchemes<\/key>\s*<array>\s*<string>)[^<]*/, `$1${brand.ios.urlScheme}`],
]);
patch("dashboard/ios/App/App.xcodeproj/project.pbxproj", [
  [/PRODUCT_BUNDLE_IDENTIFIER = [^;]+;/g, `PRODUCT_BUNDLE_IDENTIFIER = ${brand.ios.appId};`],
  [/DEVELOPMENT_TEAM = [^;]*;/g, `DEVELOPMENT_TEAM = "${team}";`],
]);
patch("ops-app/ios/App/App.xcodeproj/project.pbxproj", [
  [/PRODUCT_BUNDLE_IDENTIFIER = [^;]+;/g, `PRODUCT_BUNDLE_IDENTIFIER = ${brand.ios.opsAppId};`],
  [/DEVELOPMENT_TEAM = [^;]*;/g, `DEVELOPMENT_TEAM = "${team}";`],
]);
patch("ops-app/ExportOptions.plist", [[/(<key>teamID<\/key>\s*<string>)[^<]*/, `$1${team}`]]);
patch("ops-app/www/index.html", [[/url=https:\/\/[^"]+/, `url=https://ops.${brand.domain}`], [/<title>[^<]*<\/title>/, `<title>${brand.name} Ops</title>`]]);
patch("ops-app/www/offline.html", [[/href="https:\/\/[^"]+"/, `href="https://ops.${brand.domain}"`]]);
patch("dashboard/.env.native", [[/VITE_API_URL=.*/, `VITE_API_URL=https://${brand.domain}`]]);
patch("dashboard/.env.release", [[/VITE_API_URL=.*/, `VITE_API_URL=https://${brand.domain}`]]);

console.log("Done. For iOS, run `npx cap sync ios` in dashboard/ (and ops-app/) next.");
