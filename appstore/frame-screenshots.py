# Frames raw 1284x2778 captures from screenshots/v1.1 into captioned store shots (same size, 6.5" slot).
#   python3 appstore/frame-screenshots.py
from PIL import Image, ImageDraw, ImageFont
import os
HERE = os.path.dirname(os.path.abspath(__file__))
SRC, OUT = f"{HERE}/screenshots/v1.1", f"{HERE}/screenshots/v1.1/framed"
os.makedirs(OUT, exist_ok=True)
W, H = 1284, 2778
CAPTIONS = {
    "1-home": "See every review\nroll in.",
    "2-customers": "Add a customer\nin two taps.",
    "3-texts": "Every customer text\nin one inbox.",
    "4-conversation": "Reply, or ask\nfor a review.",
    "5-invoices": "Say the job.\nGet the invoice.",
    "6-photos": "Job photos, posted\nfor you.",
    "7-reviews": "Every review\nanswered for you.",
    "8-settings": "Know exactly\nwhat you get.",
}
font = ImageFont.truetype("/System/Library/Fonts/SFNS.ttf", 104)
try: font.set_variation_by_name("Heavy")
except Exception: pass
for name, caption in CAPTIONS.items():
    bg = Image.new("RGB", (W, H), "#f5f5f3")
    d = ImageDraw.Draw(bg)
    for y in range(H - 900, H):  # yellow fade at the bottom, like the 1.0 set
        t = (y - (H - 900)) / 900
        d.line([(0, y), (W, y)], fill=tuple(int(a + (b - a) * t) for a, b in zip((245, 245, 243), (255, 181, 36))))
    d.multiline_text((W // 2, 300), caption, font=font, fill="#111111", anchor="mm", align="center", spacing=20)
    shot = Image.open(f"{SRC}/{name}.png").convert("RGB").crop((0, 0 if name == "4-conversation" else 150, W, 2778 - (150 if name == "4-conversation" else 0)))
    sw = 1000; sh = int(shot.height * sw / shot.width)
    shot = shot.resize((sw, sh), Image.LANCZOS)
    bezel = 22; R = 110
    fw, fh = sw + bezel * 2, sh + bezel * 2
    frame = Image.new("RGB", (fw, fh), "#111111")
    inner = Image.new("L", (sw, sh), 0); ImageDraw.Draw(inner).rounded_rectangle((0, 0, sw, sh), R - bezel, fill=255)
    frame.paste(shot, (bezel, bezel), inner)
    mask = Image.new("L", (fw, fh), 0); ImageDraw.Draw(mask).rounded_rectangle((0, 0, fw, fh), R, fill=255)
    bg.paste(frame, ((W - fw) // 2, 560), mask)
    bg.save(f"{OUT}/{name}.png")
print("framed", len(CAPTIONS))
