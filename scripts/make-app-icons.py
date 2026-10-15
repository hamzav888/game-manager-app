#!/usr/bin/env python3
"""Build the home-screen icons, splash screens and in-app logos from the logo.

    python3 scripts/make-app-icons.py

Reads branding/poker-ledger-logo.png (transparent, drawn for a dark background)
and writes everything into public/. Needs Pillow (pip install pillow).
Run it again whenever the logo changes, then commit the results.
"""
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "branding" / "poker-ledger-logo.png"
PUBLIC = ROOT / "public"

BG = (13, 13, 11)          # --color-bg
GLOW = (44, 38, 27)        # warm graphite in the middle of the icon


def load_logo() -> Image.Image:
    im = Image.open(SRC).convert("RGBA")
    # The export carries faint noise across the whole canvas; drop it.
    r, g, b, a = im.split()
    a = a.point(lambda v: 0 if v < 10 else v)
    return Image.merge("RGBA", (r, g, b, a))


def trim(im: Image.Image, pad: int = 0) -> Image.Image:
    l, t, rgt, btm = im.getchannel("A").point(lambda v: 255 if v > 24 else 0).getbbox()
    return im.crop((max(0, l - pad), max(0, t - pad), min(im.width, rgt + pad), min(im.height, btm + pad)))


def split_logo(im: Image.Image) -> tuple[Image.Image, Image.Image]:
    """(mark, full): the cards-and-ledger mark alone, and mark + wordmark."""
    alpha = im.getchannel("A")
    rows = [y for y in range(im.height) if alpha.crop((0, y, im.width, y + 1)).getextrema()[1] > 40]
    # the mark is the first block of rows; the wordmark starts after a gap
    end = rows[0]
    for y in rows[1:]:
        if y - end > 12:
            break
        end = y
    mark = trim(im.crop((0, 0, im.width, end + 8)), pad=6)
    full = trim(im, pad=6)
    return mark, full


def backdrop(w: int, h: int) -> Image.Image:
    """Dark, softly lit background (radial glow, like the table lamp)."""
    bg = Image.new("RGB", (w, h), BG)
    glow = Image.new("L", (w, h), 0)
    d = ImageDraw.Draw(glow)
    side = min(w, h)
    r = int(side * 0.55)
    cx, cy = w // 2, int(h * 0.46)
    d.ellipse((cx - r, cy - r, cx + r, cy + r), fill=255)
    glow = glow.filter(ImageFilter.GaussianBlur(side * 0.18))
    return Image.composite(Image.new("RGB", (w, h), GLOW), bg, glow)


def place(canvas: Image.Image, art: Image.Image, width: int, center_y: float = 0.5) -> Image.Image:
    art = art.resize((width, round(art.height * width / art.width)), Image.LANCZOS)
    out = canvas.convert("RGBA")
    x = (out.width - art.width) // 2
    y = round(out.height * center_y - art.height / 2)
    out.alpha_composite(art, (x, y))
    return out.convert("RGB")


def icon(mark: Image.Image, size: int, scale: float) -> Image.Image:
    return place(backdrop(size, size), mark, round(size * scale), 0.5)


# iPhone portrait screens: (pixel width, pixel height, css width, css height, dpr)
SPLASH = [
    (1320, 2868, 440, 956, 3),  # 16/17 Pro Max
    (1206, 2622, 402, 874, 3),  # 16/17 Pro, 17
    (1260, 2736, 420, 912, 3),  # Air
    (1290, 2796, 430, 932, 3),  # 14 Pro Max, 15 Plus/Pro Max, 16 Plus
    (1179, 2556, 393, 852, 3),  # 14 Pro, 15, 15 Pro, 16
    (1284, 2778, 428, 926, 3),  # 12/13 Pro Max, 14 Plus
    (1170, 2532, 390, 844, 3),  # 12, 13, 14 (+ Pro)
    (1125, 2436, 375, 812, 3),  # X, XS, 11 Pro, 12/13 mini
    (1242, 2688, 414, 896, 3),  # XS Max, 11 Pro Max
    (828, 1792, 414, 896, 2),   # XR, 11
    (1242, 2208, 414, 736, 3),  # 6/7/8 Plus
    (750, 1334, 375, 667, 2),   # SE, 6/7/8
]


def main() -> None:
    logo = load_logo()
    mark, full = split_logo(logo)

    (PUBLIC / "icons").mkdir(parents=True, exist_ok=True)
    (PUBLIC / "splash").mkdir(parents=True, exist_ok=True)
    (PUBLIC / "brand").mkdir(parents=True, exist_ok=True)

    icon(mark, 512, 0.68).save(PUBLIC / "icons" / "icon-512.png", optimize=True)
    icon(mark, 192, 0.68).save(PUBLIC / "icons" / "icon-192.png", optimize=True)
    # Android crops maskable icons to a circle: keep the art inside the safe zone.
    icon(mark, 512, 0.54).save(PUBLIC / "icons" / "maskable-512.png", optimize=True)
    # iOS rounds the corners itself and wants an opaque square.
    icon(mark, 180, 0.68).save(PUBLIC / "apple-touch-icon.png", optimize=True)
    icon(mark, 48, 0.84).save(PUBLIC / "favicon-48.png", optimize=True)
    icon(mark, 32, 0.86).save(PUBLIC / "favicon-32.png", optimize=True)

    # In-app artwork (transparent).
    m = mark.resize((192, round(mark.height * 192 / mark.width)), Image.LANCZOS)
    m.save(PUBLIC / "brand" / "mark.webp", quality=92, method=6)
    f = full.resize((640, round(full.height * 640 / full.width)), Image.LANCZOS)
    f.save(PUBLIC / "brand" / "logo.webp", quality=92, method=6)

    for w, h, *_ in SPLASH:
        shot = place(backdrop(w, h), full, round(w * 0.56), 0.46)
        # 256 dithered colours: a third of the size, no visible banding.
        shot = shot.quantize(256, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.FLOYDSTEINBERG)
        shot.save(PUBLIC / "splash" / f"iphone-{w}x{h}.png", optimize=True)

    print("Wrote icons, splash screens and logos to public/.")
    print("\nSplash <link> tags for index.html:")
    for w, h, cw, ch, dpr in SPLASH:
        print(
            f'    <link rel="apple-touch-startup-image" href="/splash/iphone-{w}x{h}.png" '
            f'media="(device-width: {cw}px) and (device-height: {ch}px) and (-webkit-device-pixel-ratio: {dpr}) and (orientation: portrait)" />'
        )


if __name__ == "__main__":
    main()
