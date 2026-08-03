#!/usr/bin/env python3
"""Generate the Forever brand kit (SVG + PNG) and sync Expo app assets.

Mark — "Vòng Ký Ức" (The Memory Rings)
    outer arc  living family, open upward — room for the next generation
    inner arc  the heritage line, open downward — turned toward the roots
    gold core  the immutable self (Identity Lock)
    together   a vault dial (két sắt ký ức) · tree rings (cội nguồn) · a voice
               rippling out from its centre (Voice DNA)

Geometry is authored once in a 128x128 unit box (centre 64,64) and emitted to
both SVG (vector source) and PNG (supersampled Pillow raster), so the two never
drift apart.

Usage:
    python3 -m pip install pillow
    python3 scripts/generate-brand-kit.py
"""

from __future__ import annotations

import math
import shutil
from dataclasses import dataclass, replace
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

# ---------------------------------------------------------------- paths

ROOT = Path(__file__).resolve().parents[1]
LOGO = ROOT / "brand" / "logo"
SVG_DIR = LOGO / "svg"
PNG_DIR = LOGO / "png"
APP_DIR = LOGO / "app"
MOBILE_ASSETS = ROOT / "apps" / "mobile" / "assets"
API_BRAND = ROOT / "apps" / "api" / "static" / "brand"

# Served by apps/api/app/main.py at /favicon.ico and /brand/*
API_BRAND_FILES = [
    "favicon.ico",
    "favicon-32.png",
    "favicon-180.png",
    "favicon-192.png",
    "favicon-512.png",
    "og-banner.png",
    "icon.png",
]

# ---------------------------------------------------------------- brand

BRAND = "#2d4a3e"   # colors.brand
ACCENT = "#c4a574"  # colors.accent
CREAM = "#f4efe6"   # colors.bg
INK = "#1c241f"     # colors.ink
CARD = "#fffaf2"    # colors.card

WORDMARK = "Forever"
TAGLINE = "Két sắt ký ức gia tộc"
SUBLINE = "Mái nhà số cho gia đình — kết nối, lưu giữ, trường tồn."

# Georgia is the app's display font (apps/mobile/lib/theme.ts), so the wordmark
# matches in-app headings exactly. Linux fallbacks keep CI able to regenerate.
FONT_CANDIDATES = [
    "/System/Library/Fonts/Supplemental/Georgia.ttf",
    "/Library/Fonts/Georgia.ttf",
    "/usr/share/fonts/truetype/msttcorefonts/Georgia.ttf",
    "/usr/share/fonts/truetype/noto/NotoSerifDisplay-Regular.ttf",
    "/usr/share/fonts/truetype/noto/NotoSerif-Regular.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSerif.ttf",
]

SUPERSAMPLE = 4

# ---------------------------------------------------------------- geometry


@dataclass(frozen=True)
class Mark:
    """The mark, in a 128-unit box centred on (64, 64)."""

    r_out: float = 51.0
    r_in: float = 30.0
    w: float = 9.0
    gap_out: float = 48.0   # degrees of open space, centred on `axis`
    gap_in: float = 64.0    # centred on `axis` + 180°
    axis: float = 0.0       # 0° = 12 o'clock
    # Kept deliberately small: a larger disc turns the concentric arcs into an
    # eye / camera aperture, the wrong signal for a privacy-first vault.
    core_r: float = 8.5
    inner: bool = True      # False → compact mark (single ring + core)

    @property
    def extent(self) -> float:
        """Half-width of the inked artwork."""
        return self.r_out + self.w / 2

    def arcs(self) -> list[tuple[float, float, float]]:
        """[(radius, start_angle, end_angle)] with 0° = 12 o'clock, clockwise."""
        out = []
        so = 360 - self.gap_out
        a0 = self.axis + self.gap_out / 2
        out.append((self.r_out, a0, a0 + so))
        if self.inner:
            si = 360 - self.gap_in
            b0 = self.axis + 180 + self.gap_in / 2
            out.append((self.r_in, b0, b0 + si))
        return out


FULL = Mark()
# Below ~40px the inner arc collapses, so small sizes get a single closed ring
# with a bolder stroke: still the brand's ring + core, just louder.
COMPACT = Mark(r_out=46.0, w=14.0, core_r=15.0, gap_out=0.0, inner=False)


def hex_rgb(h: str) -> tuple[int, int, int]:
    h = h.lstrip("#")
    return int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)


def rgba(h: str, a: int = 255) -> tuple[int, int, int, int]:
    return hex_rgb(h) + (a,)


def polar(cx: float, cy: float, r: float, a_deg: float) -> tuple[float, float]:
    a = math.radians(a_deg)
    return cx + r * math.sin(a), cy - r * math.cos(a)


# ---------------------------------------------------------------- raster


class Pen:
    """Supersampled painter for 128-unit-box geometry."""

    def __init__(self, size: int, bg: tuple[int, int, int, int], box: float = 128.0):
        self.size = size
        self.k = size * SUPERSAMPLE / box
        self.img = Image.new("RGBA", (size * SUPERSAMPLE, size * SUPERSAMPLE), bg)
        self.d = ImageDraw.Draw(self.img)

    def arc(self, cx, cy, r, a0, a1, w, color, caps=True):
        # Pillow strokes arcs *inward* from the bounding ellipse, so the box is
        # grown by w/2 to put the stroke centreline exactly on radius r (which is
        # what the SVG path does, and what the round caps below assume).
        k = self.k
        cx, cy, r, w = cx * k, cy * k, r * k, w * k
        rr = r + w / 2
        if a1 - a0 >= 359.999:
            self.d.ellipse([cx - rr, cy - rr, cx + rr, cy + rr], outline=color,
                           width=max(1, int(round(w))))
            return
        self.d.arc([cx - rr, cy - rr, cx + rr, cy + rr], a0 - 90, a1 - 90,
                   fill=color, width=max(1, int(round(w))))
        if caps:
            for a in (a0, a1):
                px, py = polar(cx, cy, r, a)
                self.d.ellipse([px - w / 2, py - w / 2, px + w / 2, py + w / 2], fill=color)

    def dot(self, cx, cy, r, color):
        k = self.k
        cx, cy, r = cx * k, cy * k, r * k
        self.d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=color)

    def out(self) -> Image.Image:
        return self.img.resize((self.size, self.size), Image.LANCZOS)


def render_mark(
    size: int,
    *,
    stroke: str,
    core: str,
    bg: str | None = None,
    spec: Mark = FULL,
    fill: float = 1.0,
) -> Image.Image:
    """Render the mark. `fill` = inked diameter as a fraction of the canvas."""
    box = spec.extent * 2 / max(fill, 1e-6)
    p = Pen(size, rgba(bg) if bg else (0, 0, 0, 0), box=box)
    c = box / 2
    off = c - 64  # re-centre the 128-unit artwork inside the wider box
    sc = rgba(stroke)
    for r, a0, a1 in spec.arcs():
        p.arc(64 + off, 64 + off, r, a0, a1, spec.w, sc)
    p.dot(64 + off, 64 + off, spec.core_r, rgba(core))
    return p.out()


# ---------------------------------------------------------------- vector


def svg_arc_path(cx: float, cy: float, r: float, a0: float, a1: float) -> str:
    if a1 - a0 >= 359.999:
        return (f"M{cx:.3f} {cy - r:.3f}"
                f"A{r:.3f} {r:.3f} 0 1 1 {cx:.3f} {cy + r:.3f}"
                f"A{r:.3f} {r:.3f} 0 1 1 {cx:.3f} {cy - r:.3f}Z")
    x0, y0 = polar(cx, cy, r, a0)
    x1, y1 = polar(cx, cy, r, a1)
    large = 1 if (a1 - a0) % 360 > 180 else 0
    return f"M{x0:.3f} {y0:.3f}A{r:.3f} {r:.3f} 0 {large} 1 {x1:.3f} {y1:.3f}"


def mark_svg(*, stroke: str, core: str, bg: str | None = None, spec: Mark = FULL,
             fill: float = 1.0, label: str = "Forever") -> str:
    box = spec.extent * 2 / max(fill, 1e-6)
    c = box / 2
    off = c - 64
    body = []
    if bg:
        body.append(f'<rect width="{box:.3f}" height="{box:.3f}" fill="{bg}"/>')
    for r, a0, a1 in spec.arcs():
        body.append(
            f'<path d="{svg_arc_path(64 + off, 64 + off, r, a0, a1)}" '
            f'stroke="{stroke}" stroke-width="{spec.w:.3f}" stroke-linecap="round" fill="none"/>'
        )
    body.append(
        f'<circle cx="{64 + off:.3f}" cy="{64 + off:.3f}" r="{spec.core_r:.3f}" fill="{core}"/>'
    )
    inner = "\n  ".join(body)
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {box:.3f} {box:.3f}" '
        f'role="img" aria-label="{label}">\n'
        f'  <title>{label}</title>\n  {inner}\n</svg>'
    )


def wordmark_svg(*, fill: str, bg: str | None = None) -> str:
    w, h = 620, 150
    rect = f'<rect width="{w}" height="{h}" fill="{bg}"/>\n  ' if bg else ""
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" '
        f'role="img" aria-label="{WORDMARK}">\n'
        f'  <title>{WORDMARK}</title>\n  {rect}'
        f'<text x="{w / 2}" y="{h / 2}" text-anchor="middle" dominant-baseline="central" '
        f'font-family="Georgia, \'Noto Serif Display\', \'Times New Roman\', serif" '
        f'font-size="88" letter-spacing="6.2" fill="{fill}">{WORDMARK}</text>\n</svg>'
    )


def lockup_svg(*, stroke: str, core: str, text: str, bg: str | None = None,
               stacked: bool = False) -> str:
    """Lockups keep the mark as live vector and the wordmark as system serif text."""
    spec = FULL
    d = spec.extent * 2
    if stacked:
        w, h = 520, 400
        mx, my, ms = (w - d) / 2, 40.0, d
        tx, ty, fs, tracking = w / 2, my + ms + 78, 76, 7.6
        anchor = "middle"
    else:
        w, h = 760, 220
        ms = 132.0
        mx, my = 44.0, (h - ms) / 2
        tx, ty, fs, tracking = mx + ms + 44, h / 2, 84, 6.0
        anchor = "start"
    scale = ms / d
    off = (d / 2) - 64
    body = []
    if bg:
        body.append(f'<rect width="{w}" height="{h}" fill="{bg}"/>')
    body.append(f'<g transform="translate({mx:.3f} {my:.3f}) scale({scale:.5f})">')
    for r, a0, a1 in spec.arcs():
        body.append(
            f'  <path d="{svg_arc_path(64 + off, 64 + off, r, a0, a1)}" stroke="{stroke}" '
            f'stroke-width="{spec.w:.3f}" stroke-linecap="round" fill="none"/>'
        )
    body.append(
        f'  <circle cx="{64 + off:.3f}" cy="{64 + off:.3f}" r="{spec.core_r:.3f}" fill="{core}"/>'
    )
    body.append("</g>")
    body.append(
        f'<text x="{tx:.3f}" y="{ty:.3f}" text-anchor="{anchor}" dominant-baseline="central" '
        f'font-family="Georgia, \'Noto Serif Display\', \'Times New Roman\', serif" '
        f'font-size="{fs}" letter-spacing="{tracking}" fill="{text}">{WORDMARK}</text>'
    )
    inner = "\n  ".join(body)
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" '
        f'role="img" aria-label="{WORDMARK}">\n'
        f'  <title>{WORDMARK}</title>\n  {inner}\n</svg>'
    )


# ---------------------------------------------------------------- type


def font_path() -> str:
    for c in FONT_CANDIDATES:
        if Path(c).exists():
            return c
    raise SystemExit(
        "No serif font found. Install Georgia or Noto Serif, or add a path to "
        "FONT_CANDIDATES in scripts/generate-brand-kit.py."
    )


FONT = font_path()


def font(size: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(FONT, size)


def tracked_width(f: ImageFont.FreeTypeFont, text: str, tracking: float) -> float:
    total = sum(f.getlength(ch) for ch in text)
    return total + tracking * f.size * max(0, len(text) - 1)


def draw_tracked(draw: ImageDraw.ImageDraw, text: str, f: ImageFont.FreeTypeFont,
                 fill, x: float, y: float, tracking: float, center: bool = False) -> float:
    """Draw letter-spaced text. `y` is the vertical centre of the cap height."""
    width = tracked_width(f, text, tracking)
    cx = x - width / 2 if center else x
    ascent, descent = f.getmetrics()
    top = y - (ascent - descent) / 2 - descent / 2
    for ch in text:
        draw.text((cx, top), ch, font=f, fill=fill)
        cx += f.getlength(ch) + tracking * f.size
    return width


def draw_centered(draw: ImageDraw.ImageDraw, text: str, f: ImageFont.FreeTypeFont,
                  fill, cx: float, y: float) -> None:
    w = f.getlength(text)
    ascent, descent = f.getmetrics()
    draw.text((cx - w / 2, y - (ascent - descent) / 2 - descent / 2), text, font=f, fill=fill)


# ---------------------------------------------------------------- composites


def wordmark_png(width: int, height: int, *, fill: str, bg: str | None,
                 font_size: int, tracking: float = 0.07) -> Image.Image:
    img = Image.new("RGBA", (width, height), rgba(bg) if bg else (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    draw_tracked(d, WORDMARK, font(font_size), rgba(fill), width / 2, height / 2,
                 tracking, center=True)
    return img


def lockup_horizontal(*, stroke: str, core: str, text: str, bg: str | None,
                      width: int = 1520, height: int = 440) -> Image.Image:
    img = Image.new("RGBA", (width, height), rgba(bg) if bg else (0, 0, 0, 0))
    ms = int(height * 0.60)
    mark = render_mark(ms, stroke=stroke, core=core)
    f = font(int(height * 0.34))
    gap = int(ms * 0.34)
    text_w = tracked_width(f, WORDMARK, 0.07)
    total = ms + gap + text_w
    x = (width - total) / 2
    img.alpha_composite(mark, (int(x), int((height - ms) / 2)))
    d = ImageDraw.Draw(img)
    draw_tracked(d, WORDMARK, f, rgba(text), x + ms + gap, height / 2, 0.07)
    return img


def lockup_stacked(*, stroke: str, core: str, text: str, bg: str | None,
                   size: int = 1024) -> Image.Image:
    img = Image.new("RGBA", (size, size), rgba(bg) if bg else (0, 0, 0, 0))
    ms = int(size * 0.40)
    mark = render_mark(ms, stroke=stroke, core=core)
    my = int(size * 0.20)
    img.alpha_composite(mark, ((size - ms) // 2, my))
    d = ImageDraw.Draw(img)
    draw_tracked(d, WORDMARK, font(int(size * 0.115)), rgba(text), size / 2,
                 my + ms + int(size * 0.115), 0.10, center=True)
    return img


def app_icon(size: int = 1024, *, dark: bool = True) -> Image.Image:
    bg = BRAND if dark else CREAM
    stroke = CREAM if dark else BRAND
    return render_mark(size, stroke=stroke, core=ACCENT, bg=bg, fill=0.62).convert("RGB")


def adaptive_foreground(size: int = 1024) -> Image.Image:
    """Android foreground: art inside the 66% safe circle."""
    return render_mark(size, stroke=CREAM, core=ACCENT, fill=0.44)


def favicon(size: int) -> Image.Image:
    compact = size <= 32
    spec = COMPACT if compact else FULL
    return render_mark(size, stroke=CREAM, core=ACCENT, bg=BRAND, spec=spec,
                       fill=0.78 if compact else 0.70).convert("RGB")


def splash(width: int = 1284, height: int = 2778) -> Image.Image:
    img = Image.new("RGBA", (width, height), rgba(BRAND))
    ms = int(width * 0.30)
    mark = render_mark(ms, stroke=CREAM, core=ACCENT)
    top = int(height * 0.36) - ms // 2
    img.alpha_composite(mark, ((width - ms) // 2, top))
    d = ImageDraw.Draw(img)
    y = top + ms + int(height * 0.035)
    draw_tracked(d, WORDMARK, font(int(width * 0.088)), rgba(CREAM), width / 2, y, 0.10,
                 center=True)
    draw_centered(d, TAGLINE, font(int(width * 0.033)), rgba(ACCENT), width / 2,
                  y + int(height * 0.040))
    return img.convert("RGB")


def og_banner(width: int = 1200, height: int = 630) -> Image.Image:
    img = Image.new("RGBA", (width, height), rgba(BRAND))
    ms = 232
    mark = render_mark(ms, stroke=CREAM, core=ACCENT)
    img.alpha_composite(mark, (96, (height - ms) // 2))
    d = ImageDraw.Draw(img)
    tx = 96 + ms + 72
    draw_tracked(d, WORDMARK, font(104), rgba(CREAM), tx, height / 2 - 56, 0.07)
    d.text((tx + 2, height / 2 + 16), TAGLINE, font=font(38), fill=rgba(ACCENT))
    d.text((tx + 2, height / 2 + 92), SUBLINE, font=font(26), fill=rgba(CREAM, 200))
    return img.convert("RGB")


def specimen(width: int = 1680) -> Image.Image:
    """One board to review the whole system."""
    height = 1180
    img = Image.new("RGBA", (width, height), rgba(CARD))
    d = ImageDraw.Draw(img)
    pad = 64

    draw_tracked(d, WORDMARK, font(64), rgba(BRAND), pad, 84, 0.07)
    d.text((pad, 130), 'Vòng Ký Ức — bộ nhận diện', font=font(30), fill=rgba(INK))
    d.text((pad, 176), "vòng ngoài: người đang sống · vòng trong: mạch di sản · nhân vàng: bản sắc bất biến",
           font=font(24), fill=rgba(INK, 170))

    # mark on cream / brand / mono
    y = 250
    tiles = [
        ("mark", CREAM, BRAND, ACCENT),
        ("mark-on-brand", BRAND, CREAM, ACCENT),
        ("mark-mono", CREAM, INK, INK),
    ]
    for i, (label, bg, stroke, core) in enumerate(tiles):
        x = pad + i * 336
        img.alpha_composite(render_mark(300, stroke=stroke, core=core, bg=bg, fill=0.78), (x, y))
        d.text((x, y + 312), label, font=font(22), fill=rgba(INK, 190))

    # lockups
    lx = pad + 3 * 336 + 24
    img.alpha_composite(lockup_horizontal(stroke=BRAND, core=ACCENT, text=BRAND,
                                          bg=CREAM, width=560, height=170), (lx, y))
    img.alpha_composite(lockup_horizontal(stroke=CREAM, core=ACCENT, text=CREAM,
                                          bg=BRAND, width=560, height=170), (lx, y + 186))
    lk = lockup_stacked(stroke=BRAND, core=ACCENT, text=BRAND, bg=CREAM, size=300)
    img.alpha_composite(lk, (lx, y + 372))

    # app icons + favicons
    y2 = 700
    d.text((pad, y2 - 44), "app icon · adaptive · favicon", font=font(24), fill=rgba(INK, 190))
    icon = app_icon(232).convert("RGBA")
    img.alpha_composite(icon, (pad, y2))
    light = app_icon(232, dark=False).convert("RGBA")
    img.alpha_composite(light, (pad + 264, y2))
    fg = Image.new("RGBA", (232, 232), rgba(BRAND))
    fg.alpha_composite(adaptive_foreground(232))
    img.alpha_composite(fg, (pad + 528, y2))
    fx = pad + 792
    for s in (180, 48, 32, 16):
        img.alpha_composite(favicon(s).convert("RGBA"), (fx, y2 + 232 - s))
        fx += s + 22

    # small-size legibility strip on both fields
    y3 = 1000
    d.text((pad, y3 - 36), "48 · 40 px full mark  ·  32 · 16 px compact",
           font=font(24), fill=rgba(INK, 190))
    sizes = ((48, FULL), (40, FULL), (32, COMPACT), (16, COMPACT))
    sx = pad
    for s, sp in sizes:
        img.alpha_composite(render_mark(s, stroke=BRAND, core=ACCENT, spec=sp),
                            (sx, y3 + (48 - s) // 2))
        sx += s + 20
    sx += 24
    strip = Image.new("RGBA", (296, 60), rgba(BRAND))
    ox = 12
    for s, sp in sizes:
        strip.alpha_composite(render_mark(s, stroke=CREAM, core=ACCENT, spec=sp),
                             (ox, (60 - s) // 2))
        ox += s + 20
    img.alpha_composite(strip, (sx, y3 - 6))

    # palette
    px = pad + 900
    for name, hexv in (("brand", BRAND), ("accent", ACCENT), ("bg", CREAM), ("ink", INK)):
        d.rectangle([px, y3, px + 120, y3 + 56], fill=rgba(hexv), outline=rgba(INK, 40))
        d.text((px, y3 + 64), f"{name} {hexv}", font=font(18), fill=rgba(INK, 190))
        px += 140
    return img.convert("RGB")


# ---------------------------------------------------------------- emit


def write_text(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content.strip() + "\n", encoding="utf-8")


def save(img: Image.Image, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    img.save(path, "PNG")


def emit_svgs() -> None:
    write_text(SVG_DIR / "mark.svg", mark_svg(stroke=BRAND, core=ACCENT))
    write_text(SVG_DIR / "mark-on-dark.svg", mark_svg(stroke=CREAM, core=ACCENT))
    write_text(SVG_DIR / "mark-on-cream.svg",
               mark_svg(stroke=BRAND, core=ACCENT, bg=CREAM, fill=0.74))
    write_text(SVG_DIR / "mark-on-brand.svg",
               mark_svg(stroke=CREAM, core=ACCENT, bg=BRAND, fill=0.74))
    write_text(SVG_DIR / "mark-mono.svg", mark_svg(stroke=INK, core=INK))
    write_text(SVG_DIR / "mark-mono-reversed.svg", mark_svg(stroke=CREAM, core=CREAM))
    write_text(SVG_DIR / "mark-compact.svg",
               mark_svg(stroke=BRAND, core=ACCENT, spec=COMPACT))
    write_text(SVG_DIR / "mark-compact-on-dark.svg",
               mark_svg(stroke=CREAM, core=ACCENT, spec=COMPACT))
    write_text(SVG_DIR / "wordmark.svg", wordmark_svg(fill=BRAND))
    write_text(SVG_DIR / "wordmark-reversed.svg", wordmark_svg(fill=CREAM))
    write_text(SVG_DIR / "wordmark-on-dark.svg", wordmark_svg(fill=CREAM, bg=BRAND))
    write_text(SVG_DIR / "wordmark-on-cream.svg", wordmark_svg(fill=BRAND, bg=CREAM))
    write_text(SVG_DIR / "lockup-horizontal.svg",
               lockup_svg(stroke=BRAND, core=ACCENT, text=BRAND))
    write_text(SVG_DIR / "lockup-horizontal-on-cream.svg",
               lockup_svg(stroke=BRAND, core=ACCENT, text=BRAND, bg=CREAM))
    write_text(SVG_DIR / "lockup-horizontal-on-dark.svg",
               lockup_svg(stroke=CREAM, core=ACCENT, text=CREAM, bg=BRAND))
    write_text(SVG_DIR / "lockup-stacked.svg",
               lockup_svg(stroke=BRAND, core=ACCENT, text=BRAND, stacked=True))
    write_text(SVG_DIR / "lockup-stacked-on-cream.svg",
               lockup_svg(stroke=BRAND, core=ACCENT, text=BRAND, bg=CREAM, stacked=True))
    write_text(SVG_DIR / "lockup-stacked-on-dark.svg",
               lockup_svg(stroke=CREAM, core=ACCENT, text=CREAM, bg=BRAND, stacked=True))


def emit_pngs() -> None:
    save(render_mark(1024, stroke=BRAND, core=ACCENT), PNG_DIR / "mark.png")
    save(render_mark(1024, stroke=CREAM, core=ACCENT), PNG_DIR / "mark-on-dark.png")
    save(render_mark(1024, stroke=BRAND, core=ACCENT, bg=CREAM, fill=0.74),
         PNG_DIR / "mark-on-cream.png")
    save(render_mark(1024, stroke=CREAM, core=ACCENT, bg=BRAND, fill=0.74),
         PNG_DIR / "mark-on-brand.png")
    save(render_mark(1024, stroke=INK, core=INK), PNG_DIR / "mark-mono.png")
    save(render_mark(1024, stroke=CREAM, core=CREAM), PNG_DIR / "mark-mono-reversed.png")
    save(render_mark(1024, stroke=BRAND, core=ACCENT, spec=COMPACT),
         PNG_DIR / "mark-compact.png")

    save(wordmark_png(1400, 320, fill=BRAND, bg=None, font_size=150),
         PNG_DIR / "wordmark.png")
    save(wordmark_png(1400, 320, fill=CREAM, bg=None, font_size=150),
         PNG_DIR / "wordmark-reversed.png")
    save(wordmark_png(1400, 320, fill=CREAM, bg=BRAND, font_size=150),
         PNG_DIR / "wordmark-on-dark.png")
    save(wordmark_png(1400, 320, fill=BRAND, bg=CREAM, font_size=150),
         PNG_DIR / "wordmark-on-cream.png")

    save(lockup_horizontal(stroke=BRAND, core=ACCENT, text=BRAND, bg=None),
         PNG_DIR / "lockup-horizontal.png")
    save(lockup_horizontal(stroke=BRAND, core=ACCENT, text=BRAND, bg=CREAM),
         PNG_DIR / "lockup-horizontal-on-cream.png")
    save(lockup_horizontal(stroke=CREAM, core=ACCENT, text=CREAM, bg=BRAND),
         PNG_DIR / "lockup-horizontal-on-dark.png")
    save(lockup_stacked(stroke=BRAND, core=ACCENT, text=BRAND, bg=None),
         PNG_DIR / "lockup-stacked.png")
    save(lockup_stacked(stroke=BRAND, core=ACCENT, text=BRAND, bg=CREAM),
         PNG_DIR / "lockup-stacked-on-cream.png")
    save(lockup_stacked(stroke=CREAM, core=ACCENT, text=CREAM, bg=BRAND),
         PNG_DIR / "lockup-stacked-on-dark.png")


def emit_app() -> None:
    save(app_icon(1024), APP_DIR / "icon.png")
    save(app_icon(1024, dark=False), APP_DIR / "icon-light.png")
    save(adaptive_foreground(1024), APP_DIR / "adaptive-icon.png")
    save(splash(), APP_DIR / "splash.png")
    save(og_banner(), APP_DIR / "og-banner.png")
    for s in (16, 32, 48, 180, 192, 512):
        save(favicon(s), APP_DIR / f"favicon-{s}.png")
    ico = APP_DIR / "favicon.ico"
    favicon(256).save(ico, format="ICO", sizes=[(16, 16), (32, 32), (48, 48), (64, 64)])
    save(specimen(), LOGO / "specimen.png")


def sync_mobile() -> None:
    """Expo wiring — app.config.js + components/BrandLogo.tsx consume these names."""
    MOBILE_ASSETS.mkdir(parents=True, exist_ok=True)
    save(app_icon(1024), MOBILE_ASSETS / "icon.png")
    save(adaptive_foreground(1024), MOBILE_ASSETS / "adaptive-icon.png")
    save(splash(), MOBILE_ASSETS / "splash.png")
    # BrandLogo: cream mark on dark surfaces, brand-green mark on light ones.
    save(render_mark(512, stroke=CREAM, core=ACCENT), MOBILE_ASSETS / "logo-mark.png")
    save(render_mark(512, stroke=BRAND, core=ACCENT), MOBILE_ASSETS / "logo-mark-brand.png")
    save(favicon(196), MOBILE_ASSETS / "favicon.png")


def sync_api() -> None:
    """Copy the exact bytes the API serves for docs and share previews."""
    API_BRAND.mkdir(parents=True, exist_ok=True)
    for name in API_BRAND_FILES:
        shutil.copy2(APP_DIR / name, API_BRAND / name)


def main() -> None:
    for d in (SVG_DIR, PNG_DIR, APP_DIR):
        if d.exists():
            shutil.rmtree(d)
    emit_svgs()
    emit_pngs()
    emit_app()
    sync_mobile()
    sync_api()
    print("Forever brand kit — Vòng Ký Ức")
    print(f"  font  {FONT}")
    print(f"  svg   {SVG_DIR.relative_to(ROOT)}")
    print(f"  png   {PNG_DIR.relative_to(ROOT)}")
    print(f"  app   {APP_DIR.relative_to(ROOT)}")
    print(f"  expo  {MOBILE_ASSETS.relative_to(ROOT)}")
    print(f"  api   {API_BRAND.relative_to(ROOT)}")
    print(f"  board {(LOGO / 'specimen.png').relative_to(ROOT)}")


if __name__ == "__main__":
    main()
