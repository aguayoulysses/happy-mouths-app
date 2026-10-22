#!/usr/bin/env python3
"""Turn a client's "team holding a blank board" photo into a sign template.

  .venv-poster/bin/python scripts/new-poster-template.py <photo> <key> [--quad x,y,x,y,x,y,x,y] [--rotate 90|180|270]

Finds the board's four corners, crops the photo to a phone-friendly size, saves
lib/poster-assets/<key>.jpg and records the corners in lib/poster-assets/templates.json
(read by lib/poster-render.ts). Also writes <key>-check.jpg with the detected outline
so a wrong guess is obvious; pass --quad (corners in the ORIGINAL photo, TL TR BR BL)
to override it.
"""
import json, sys, argparse
from pathlib import Path
import cv2, numpy as np
from PIL import Image, ImageOps

ASSETS = Path(__file__).resolve().parent.parent / "lib" / "poster-assets"
MAX_W, MAX_H = 1000, 1250  # MMS-friendly: carriers shrink anything much bigger


def order(pts):
    pts = np.array(pts, dtype=np.float32)
    s, d = pts.sum(1), np.diff(pts, axis=1).ravel()
    return np.array([pts[s.argmin()], pts[d.argmin()], pts[s.argmax()], pts[d.argmax()]])  # TL TR BR BL


def find_board(img):
    """Largest bright, flat, four-sided region. Returns 4 corners or None."""
    h, w = img.shape[:2]
    scale = 1000 / max(h, w)
    small = cv2.resize(img, None, fx=scale, fy=scale)
    hsv = cv2.cvtColor(small, cv2.COLOR_BGR2HSV)
    lab = cv2.cvtColor(small, cv2.COLOR_BGR2LAB)
    best, best_score = None, 0
    # A white board is bright and unsaturated; walls often are too, so try several cut-offs
    # and also split on colour temperature (a board rarely matches the wall's tint exactly).
    masks = []
    for v in (150, 170, 190, 210):
        for s in (40, 70):
            masks.append(((hsv[..., 2] > v) & (hsv[..., 1] < s)).astype(np.uint8))
    b = lab[..., 2].astype(int)
    for t in (120, 124, 128):
        masks.append(((b < t) & (hsv[..., 2] > 150)).astype(np.uint8))
        masks.append(((b >= t) & (hsv[..., 2] > 150) & (hsv[..., 1] < 60)).astype(np.uint8))
    for m in masks:
        m = cv2.morphologyEx(m, cv2.MORPH_OPEN, np.ones((7, 7), np.uint8))
        n, labels, stats, cents = cv2.connectedComponentsWithStats(m)
        for i in range(1, n):
            x, y, bw, bh, area = stats[i]
            if area < 0.04 * m.size or area > 0.6 * m.size:
                continue
            if x <= 2 or y <= 2 or x + bw >= m.shape[1] - 2 or y + bh >= m.shape[0] - 2:
                continue  # touches the frame: a wall or ceiling, not a held board
            comp = cv2.morphologyEx((labels == i).astype(np.uint8), cv2.MORPH_CLOSE, np.ones((25, 25), np.uint8))
            cnt = max(cv2.findContours(comp, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)[0], key=cv2.contourArea)
            hull = cv2.convexHull(cnt)
            # Two ways to get corners: polygon simplification (fine for clean edges) and the hull's
            # diagonal extremes (better when an edge is ragged or a hand breaks it). Keep whichever
            # quad overlaps the actual blob best.
            cands = []
            poly = cv2.approxPolyDP(hull, 0.03 * cv2.arcLength(hull, True), True)
            if len(poly) == 4:
                cands.append(poly.reshape(4, 2))
            hp = hull.reshape(-1, 2)
            sm, df = hp.sum(1), hp[:, 0] - hp[:, 1]
            cands.append(np.array([hp[sm.argmin()], hp[df.argmax()], hp[sm.argmax()], hp[df.argmin()]]))
            def iou(qd):
                qm = np.zeros(m.shape, np.uint8); cv2.fillConvexPoly(qm, qd.astype(np.int32), 1)
                return (qm & comp).sum() / max((qm | comp).sum(), 1)
            quad = max(cands, key=iou).astype(np.int32).reshape(4, 1, 2)
            ca, qa = cv2.contourArea(cnt), max(cv2.contourArea(quad), 1)
            fill = min(ca, qa) / max(ca, qa)  # how well four corners explain the blob; spurs and bites both lower it
            qm = np.zeros(m.shape, np.uint8)
            cv2.fillConvexPoly(qm, quad, 1)
            flat = 1 / (1 + lab[..., 0][qm == 1].std() / 12)  # a blank board has even brightness
            cx = abs(cents[i][0] / m.shape[1] - 0.5)
            score = cv2.contourArea(quad) * fill ** 6 * flat * (1 - cx)
            if '--debug' in sys.argv: print(round(score), round(fill,2), round(flat,2), (quad.reshape(4,2)/scale).astype(int).tolist(), file=sys.stderr)
            if fill > 0.9 and score > best_score:
                best, best_score = quad.reshape(4, 2) / scale, score
    return None if best is None else order(best)


def refine(img, quad):
    """Snap each side of a rough quad onto the board's real edge: sample the strongest
    bright-to-dark step along the side's normal, fit a line through those hits (RANSAC, so
    hands and ragged foam are ignored), then intersect neighbouring lines for the corners."""
    L = cv2.GaussianBlur(cv2.cvtColor(img, cv2.COLOR_BGR2LAB)[..., 0].astype(np.float32), (0, 0), 2)
    h, w = L.shape
    band = int(0.045 * max(h, w))
    centre = quad.mean(0)
    rng = np.random.default_rng(7)
    lines = []
    for i in range(4):
        a, b = quad[i], quad[(i + 1) % 4]
        d = (b - a) / np.linalg.norm(b - a)
        nrm = np.array([-d[1], d[0]])
        if np.dot(nrm, centre - a) > 0:
            nrm = -nrm  # point outward
        hits = []
        for t in np.linspace(0.06, 0.94, 90):
            base = a + (b - a) * t
            offs = np.arange(-band, band + 1)
            pts = base + offs[:, None] * nrm
            xs, ys = pts[:, 0].round().astype(int), pts[:, 1].round().astype(int)
            ok = (xs >= 0) & (xs < w) & (ys >= 0) & (ys < h)
            if ok.sum() < band:
                continue
            prof = L[ys[ok], xs[ok]]
            step = prof[:-6] - prof[6:]  # board (bright, inside) minus whatever is outside
            j = int(step.argmax())
            if step[j] > 6:
                hits.append(pts[ok][j + 3])
        hits = np.array(hits)
        if len(hits) < 12:
            lines.append((a, d)); continue
        best_in, best = 0, (a, d)
        for _ in range(200):
            p, q = hits[rng.choice(len(hits), 2, replace=False)]
            if np.linalg.norm(q - p) < 1:
                continue
            dd = (q - p) / np.linalg.norm(q - p)
            dist = np.abs((hits - p) @ np.array([-dd[1], dd[0]]))
            inl = dist < max(2.5, 0.002 * max(h, w))
            if inl.sum() > best_in:
                best_in = inl.sum()
                vx, vy, x0, y0 = cv2.fitLine(hits[inl].astype(np.float32), cv2.DIST_L2, 0, 0.01, 0.01).ravel()
                best = (np.array([x0, y0]), np.array([vx, vy]))
        lines.append(best)
    out = []
    for i in range(4):  # corner i = side (i-1) x side i
        (p1, d1), (p2, d2) = lines[i - 1], lines[i]
        A = np.array([d1, -d2]).T
        if abs(np.linalg.det(A)) < 1e-6:
            out.append(quad[i]); continue
        t = np.linalg.solve(A, p2 - p1)
        out.append(p1 + d1 * t[0])
    out = np.array(out, dtype=np.float32)
    # A refinement that wandered far from the rough guess is wrong, not better.
    return out if np.abs(out - quad).max() < 2.5 * band else quad


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("photo"); ap.add_argument("key")
    ap.add_argument("--quad"); ap.add_argument("--rotate", type=int, default=0)
    ap.add_argument("--font", default="reenie"); ap.add_argument("--debug", action="store_true")
    a = ap.parse_args()

    pil = ImageOps.exif_transpose(Image.open(a.photo)).convert("RGB")  # phones store rotation in EXIF
    if a.rotate:
        pil = pil.rotate(-a.rotate, expand=True)
    img = cv2.cvtColor(np.array(pil), cv2.COLOR_RGB2BGR)
    H, W = img.shape[:2]

    quad = order(np.array(list(map(float, a.quad.split(","))).copy()).reshape(4, 2)) if a.quad else find_board(img)
    if quad is not None and not a.quad:
        quad = refine(img, quad)
        quad = order(quad + (quad.mean(0) - quad) * 0.012)  # pull in a hair so ink never touches the edge
    if quad is None:
        sys.exit("Couldn't find the board. Re-run with --quad x,y,x,y,x,y,x,y (TL TR BR BL, in the original photo).")

    # Crop: keep everyone in frame but lose dead space, portrait-ish, board comfortably inside.
    bx0, by0, bx1, by1 = quad[:, 0].min(), quad[:, 1].min(), quad[:, 0].max(), quad[:, 1].max()
    bw, bh = bx1 - bx0, by1 - by0
    cw = min(W, max(bw * 1.5, bh * 1.5))
    ch = min(H, cw * MAX_H / MAX_W)
    cx, cy = (bx0 + bx1) / 2, (by0 + by1) / 2 - bh * 0.25  # faces sit above the board
    x0 = int(np.clip(cx - cw / 2, 0, W - cw)); y0 = int(np.clip(cy - ch / 2, 0, H - ch))
    crop = img[y0:y0 + int(ch), x0:x0 + int(cw)]
    k = min(1.0, MAX_W / crop.shape[1])
    crop = cv2.resize(crop, None, fx=k, fy=k, interpolation=cv2.INTER_AREA)
    q = ((quad - [x0, y0]) * k).round().astype(int).tolist()

    ASSETS.mkdir(parents=True, exist_ok=True)
    cv2.imwrite(str(ASSETS / f"{a.key}.jpg"), crop, [cv2.IMWRITE_JPEG_QUALITY, 92])
    check = crop.copy()
    cv2.polylines(check, [np.array(q, np.int32).reshape(-1, 1, 2)], True, (0, 0, 255), 3)
    out_check = Path(a.photo).with_name(f"{a.key}-check.jpg")
    cv2.imwrite(str(out_check), check)

    reg = ASSETS / "templates.json"
    data = json.loads(reg.read_text()) if reg.exists() else {}
    data[a.key] = {"image": f"{a.key}.jpg", "quad": q, "font": a.font}
    reg.write_text(json.dumps(data, indent=2) + "\n")
    print(json.dumps({"key": a.key, "size": [crop.shape[1], crop.shape[0]], "quad": q, "check": str(out_check)}))


if __name__ == "__main__":
    main()
