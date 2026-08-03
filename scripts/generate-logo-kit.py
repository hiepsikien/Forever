#!/usr/bin/env python3
"""Generate Forever brand logo kit (SVG + PNG) and wire Expo app assets.

Mark concept — The Living Loop:
  vault ring (protective family circle)
  + lemniscate ∞ (continuity across generations)
  + gold spark at the crossing (living heritage / Identity Lock)
"""

from __future__ import annotations

import math
from pathlib import Path

import cairosvg
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
LOGO_ROOT = ROOT / "brand" / "logo"
SVG_DIR = LOGO_ROOT / "svg"
PNG_DIR = LOGO_ROOT / "png"
APP_DIR = LOGO_ROOT / "app"
MOBILE_ASSETS = ROOT / "apps" / "mobile" / "assets"
API_STATIC_BRAND = ROOT / "apps" / "api" / "static" / "brand"

COL_BRAND = "#2d4a3e"
COL_ACCENT = "#c4a574"
COL_CREAM = "#f4efe6"
COL_INK = "#1c241f"

FONT_DISPLAY = "/usr/share/fonts/truetype/noto/NotoSerifDisplay-Regular.ttf"
FONT_SERIF = "/usr/share/fonts/truetype/noto/NotoSerif-Regular.ttf"


def hex_rgb(h: str) -> tuple[int, int, int]:
    h = h.lstrip("#")
    return int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)


def write(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content.strip() + "\n", encoding="utf-8")


def lemniscate_path(*, cx: float = 64, cy: float = 64, scale: float = 42, steps: int = 96) -> str:
    """Bernoulli lemniscate as smooth cubic SVG path (horizontal ∞)."""
    pts: list[tuple[float, float]] = []
    for i in range(steps + 1):
        t = (i / steps) * 2 * math.pi
        den = 1 + math.sin(t) ** 2
        x = math.cos(t) / den
        y = math.sin(t) * math.cos(t) / den
        pts.append((cx + x * scale, cy - y * scale))

    def catmull(p0, p1, p2, p3, tension: float = 1 / 6):
        c1 = (p1[0] + (p2[0] - p0[0]) * tension, p1[1] + (p2[1] - p0[1]) * tension)
        c2 = (p2[0] - (p3[0] - p1[0]) * tension, p2[1] - (p3[1] - p1[1]) * tension)
        return c1, c2

    parts = [f"M{pts[0][0]:.3f} {pts[0][1]:.3f}"]
    n = len(pts)
    for i in range(n - 1):
        p0 = pts[i - 1 if i > 0 else 0]
        p1 = pts[i]
        p2 = pts[i + 1]
        p3 = pts[i + 2 if i + 2 < n else n - 1]
        c1, c2 = catmull(p0, p1, p2, p3)
        parts.append(
            f"C{c1[0]:.3f} {c1[1]:.3f} {c2[0]:.3f} {c2[1]:.3f} {p2[0]:.3f} {p2[1]:.3f}"
        )
    return " ".join(parts)


INFINITY = lemniscate_path(scale=42)
INFINITY_COMPACT = lemniscate_path(scale=48)


def mark_svg(
    *,
    stroke: str,
    spark: str,
    ring: bool = True,
    bg: str | None = None,
    size: int = 128,
) -> str:
    r = size / 2
    ring_r = r - 10
    stroke_w = 5.25 if ring else 7.0
    ring_w = 3.25
    spark_r = 4.75 if ring else 6.0
    path = INFINITY if ring else INFINITY_COMPACT
    # Scale path if size != 128
    if size != 128:
        # regenerate at size center
        path = lemniscate_path(cx=r, cy=r, scale=(42 if ring else 48) * (size / 128))
        ring_r = r - 10 * (size / 128)
        stroke_w *= size / 128
        ring_w *= size / 128
        spark_r *= size / 128
    bg_el = f'<rect width="{size}" height="{size}" fill="{bg}"/>' if bg else ""
    ring_el = (
        f'<circle cx="{r}" cy="{r}" r="{ring_r:.3f}" stroke="{stroke}" '
        f'stroke-width="{ring_w:.3f}" fill="none"/>'
        if ring
        else ""
    )
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {size} {size}" fill="none" role="img" aria-label="Forever">
  <title>Forever</title>
  {bg_el}
  {ring_el}
  <path d="{path}" stroke="{stroke}" stroke-width="{stroke_w:.3f}" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
  <circle cx="{r}" cy="{r}" r="{spark_r:.3f}" fill="{spark}"/>
</svg>'''


def wordmark_svg(
    *,
    fill: str,
    width: int = 520,
    height: int = 120,
    font_size: int = 72,
    bg: str | None = None,
) -> str:
    bg_el = f'<rect width="{width}" height="{height}" fill="{bg}"/>' if bg else ""
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width} {height}" role="img" aria-label="Forever">
  <title>Forever</title>
  {bg_el}
  <text x="50%" y="58%" text-anchor="middle" dominant-baseline="middle"
        font-family="Georgia, 'Noto Serif Display', 'Noto Serif', serif"
        font-size="{font_size}" fill="{fill}" letter-spacing="0.08em">Forever</text>
</svg>'''


def mark_inner(*, stroke: str, spark: str, ring: bool = True) -> str:
    """Mark geometry for embedding inside lockup SVGs (128×128 space)."""
    path = INFINITY if ring else INFINITY_COMPACT
    stroke_w = 5.25 if ring else 7.0
    spark_r = 4.75 if ring else 6.0
    ring_el = (
        '<circle cx="64" cy="64" r="54" stroke="{stroke}" stroke-width="3.25" fill="none"/>'.format(
            stroke=stroke
        )
        if ring
        else ""
    )
    return f'''{ring_el}
  <path d="{path}" stroke="{stroke}" stroke-width="{stroke_w}" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
  <circle cx="64" cy="64" r="{spark_r}" fill="{spark}"/>'''


def lockup_horizontal_svg(
    *,
    stroke: str,
    spark: str,
    text: str,
    bg: str | None = None,
) -> str:
    bg_el = f'<rect width="720" height="160" fill="{bg}"/>' if bg else ""
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 720 160" fill="none" role="img" aria-label="Forever">
  <title>Forever</title>
  {bg_el}
  <g transform="translate(16,16)">
    {mark_inner(stroke=stroke, spark=spark, ring=True)}
  </g>
  <text x="180" y="102" font-family="Georgia, 'Noto Serif Display', 'Noto Serif', serif"
        font-size="64" fill="{text}" letter-spacing="0.06em">Forever</text>
</svg>'''


def lockup_stacked_svg(
    *,
    stroke: str,
    spark: str,
    text: str,
    bg: str | None = None,
) -> str:
    bg_el = f'<rect width="360" height="360" fill="{bg}"/>' if bg else ""
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 360 360" fill="none" role="img" aria-label="Forever">
  <title>Forever</title>
  {bg_el}
  <g transform="translate(116,48)">
    {mark_inner(stroke=stroke, spark=spark, ring=True)}
  </g>
  <text x="180" y="260" text-anchor="middle"
        font-family="Georgia, 'Noto Serif Display', 'Noto Serif', serif"
        font-size="48" fill="{text}" letter-spacing="0.08em">Forever</text>
</svg>'''


def svg_to_png(
    svg: str | Path,
    out: Path,
    width: int | None = None,
    height: int | None = None,
) -> None:
    out.parent.mkdir(parents=True, exist_ok=True)
    kwargs: dict = {"write_to": str(out)}
    if width:
        kwargs["output_width"] = width
    if height:
        kwargs["output_height"] = height
    if isinstance(svg, Path):
        cairosvg.svg2png(url=str(svg), **kwargs)
    else:
        cairosvg.svg2png(bytestring=svg.encode("utf-8"), **kwargs)


def draw_tracked_text(
    draw: ImageDraw.ImageDraw,
    *,
    text: str,
    font: ImageFont.FreeTypeFont,
    fill: tuple[int, int, int, int],
    anchor_x: int,
    y: int,
    tracking: float,
    center: bool = True,
) -> int:
    glyphs = list(text)
    advances = []
    for g in glyphs:
        bbox = draw.textbbox((0, 0), g, font=font)
        advances.append(bbox[2] - bbox[0])
    extra = int(font.size * tracking)
    total_w = sum(advances) + extra * max(0, len(glyphs) - 1)
    x = anchor_x - total_w // 2 if center else anchor_x
    for g, adv in zip(glyphs, advances):
        draw.text((x, y), g, font=font, fill=fill)
        x += adv + extra
    return total_w


def render_wordmark_png(
    out: Path,
    *,
    fill: str,
    bg: str | None,
    width: int,
    height: int,
    font_size: int = 96,
    tracking: float = 0.06,
) -> None:
    img = Image.new("RGBA", (width, height), hex_rgb(bg) + (255,) if bg else (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    font = ImageFont.truetype(FONT_DISPLAY, font_size)
    ascent, descent = font.getmetrics()
    y = (height - (ascent + descent)) // 2
    draw_tracked_text(
        draw,
        text="Forever",
        font=font,
        fill=hex_rgb(fill) + (255,),
        anchor_x=width // 2,
        y=y,
        tracking=tracking,
        center=True,
    )
    out.parent.mkdir(parents=True, exist_ok=True)
    img.save(out, "PNG")


def render_mark_png(
    out: Path,
    *,
    stroke: str,
    spark: str,
    bg: str | None,
    size: int,
    ring: bool = True,
) -> Image.Image:
    svg = mark_svg(stroke=stroke, spark=spark, ring=ring, bg=None)
    tmp = out.with_suffix(".tmp.png")
    art = int(size * (0.86 if bg else 1.0))
    svg_to_png(svg, tmp, width=art, height=art)
    mark = Image.open(tmp).convert("RGBA")
    img = Image.new("RGBA", (size, size), hex_rgb(bg) + (255,) if bg else (0, 0, 0, 0))
    img.alpha_composite(mark, ((size - art) // 2, (size - art) // 2))
    tmp.unlink(missing_ok=True)
    out.parent.mkdir(parents=True, exist_ok=True)
    img.save(out, "PNG")
    return img


def paste_centered(base: Image.Image, overlay: Image.Image) -> None:
    x = (base.width - overlay.width) // 2
    y = (base.height - overlay.height) // 2
    base.alpha_composite(overlay, (x, y))


def lockup_horizontal_png(
    out: Path,
    *,
    stroke: str,
    spark: str,
    text: str,
    bg: str | None,
    width: int = 1600,
    height: int = 360,
) -> None:
    img = Image.new("RGBA", (width, height), hex_rgb(bg) + (255,) if bg else (0, 0, 0, 0))
    mark_size = int(height * 0.72)
    mark = render_mark_png(
        APP_DIR / "_lock_mark.png",
        stroke=stroke,
        spark=spark,
        bg=None,
        size=mark_size,
        ring=True,
    )
    mx = int(width * 0.06)
    my = (height - mark_size) // 2
    img.alpha_composite(mark, (mx, my))

    draw = ImageDraw.Draw(img)
    font = ImageFont.truetype(FONT_DISPLAY, int(height * 0.38))
    ascent, descent = font.getmetrics()
    ty = (height - (ascent + descent)) // 2
    draw_tracked_text(
        draw,
        text="Forever",
        font=font,
        fill=hex_rgb(text) + (255,),
        anchor_x=mx + mark_size + int(width * 0.04),
        y=ty,
        tracking=0.07,
        center=False,
    )
    out.parent.mkdir(parents=True, exist_ok=True)
    img.save(out, "PNG")


def lockup_stacked_png(
    out: Path,
    *,
    stroke: str,
    spark: str,
    text: str,
    bg: str | None,
    size: int = 1024,
) -> None:
    img = Image.new("RGBA", (size, size), hex_rgb(bg) + (255,) if bg else (0, 0, 0, 0))
    mark_size = int(size * 0.42)
    mark = render_mark_png(
        APP_DIR / "_stack_mark.png",
        stroke=stroke,
        spark=spark,
        bg=None,
        size=mark_size,
        ring=True,
    )
    mx = (size - mark_size) // 2
    my = int(size * 0.18)
    img.alpha_composite(mark, (mx, my))

    draw = ImageDraw.Draw(img)
    font = ImageFont.truetype(FONT_DISPLAY, int(size * 0.11))
    ascent, descent = font.getmetrics()
    ty = my + mark_size + int(size * 0.06)
    _ = ascent, descent
    draw_tracked_text(
        draw,
        text="Forever",
        font=font,
        fill=hex_rgb(text) + (255,),
        anchor_x=size // 2,
        y=ty,
        tracking=0.1,
        center=True,
    )
    out.parent.mkdir(parents=True, exist_ok=True)
    img.save(out, "PNG")


def make_app_icon(size: int = 1024, *, dark: bool = True) -> Image.Image:
    bg = COL_BRAND if dark else COL_CREAM
    stroke = COL_CREAM if dark else COL_BRAND
    return render_mark_png(
        APP_DIR / "_icon_build.png",
        stroke=stroke,
        spark=COL_ACCENT,
        bg=bg,
        size=size,
        ring=True,
    ).convert("RGB")


def make_adaptive_foreground(size: int = 1024) -> Image.Image:
    art = int(size * 0.58)
    mark = render_mark_png(
        APP_DIR / "_fg_build.png",
        stroke=COL_CREAM,
        spark=COL_ACCENT,
        bg=None,
        size=art,
        ring=True,
    )
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    paste_centered(img, mark)
    return img


def make_splash(width: int = 1284, height: int = 2778) -> Image.Image:
    img = Image.new("RGBA", (width, height), hex_rgb(COL_BRAND) + (255,))
    mark_size = int(min(width, height) * 0.26)
    mark = render_mark_png(
        APP_DIR / "_splash_mark.png",
        stroke=COL_CREAM,
        spark=COL_ACCENT,
        bg=None,
        size=mark_size,
        ring=True,
    )
    mark_y = int(height * 0.38) - mark_size // 2
    img.alpha_composite(mark, ((width - mark_size) // 2, mark_y))

    draw = ImageDraw.Draw(img)
    font = ImageFont.truetype(FONT_DISPLAY, int(width * 0.085))
    ascent, descent = font.getmetrics()
    ty = mark_y + mark_size + int(height * 0.028)
    draw_tracked_text(
        draw,
        text="Forever",
        font=font,
        fill=hex_rgb(COL_CREAM) + (255,),
        anchor_x=width // 2,
        y=ty,
        tracking=0.1,
        center=True,
    )

    tag_font = ImageFont.truetype(FONT_SERIF, int(width * 0.032))
    tag = "Két sắt ký ức gia tộc"
    tb = draw.textbbox((0, 0), tag, font=tag_font)
    tw = tb[2] - tb[0]
    draw.text(
        ((width - tw) // 2, ty + ascent + descent + int(height * 0.012)),
        tag,
        font=tag_font,
        fill=hex_rgb(COL_ACCENT) + (255,),
    )
    return img.convert("RGB")


def make_og_banner(width: int = 1200, height: int = 630) -> Image.Image:
    img = Image.new("RGBA", (width, height), hex_rgb(COL_BRAND) + (255,))
    mark = render_mark_png(
        APP_DIR / "_og_mark.png",
        stroke=COL_CREAM,
        spark=COL_ACCENT,
        bg=None,
        size=220,
        ring=True,
    )
    img.alpha_composite(mark, (80, (height - 220) // 2))
    draw = ImageDraw.Draw(img)
    font = ImageFont.truetype(FONT_DISPLAY, 92)
    draw_tracked_text(
        draw,
        text="Forever",
        font=font,
        fill=hex_rgb(COL_CREAM) + (255,),
        anchor_x=340,
        y=height // 2 - 100,
        tracking=0.06,
        center=False,
    )
    sub = ImageFont.truetype(FONT_SERIF, 28)
    draw.text(
        (340, height // 2 + 24),
        "Private family memory · living heritage",
        font=sub,
        fill=hex_rgb(COL_ACCENT) + (255,),
    )
    return img.convert("RGB")


def make_favicon(size: int) -> Image.Image:
    return render_mark_png(
        APP_DIR / f"_fav_{size}.png",
        stroke=COL_CREAM,
        spark=COL_ACCENT,
        bg=COL_BRAND,
        size=size,
        ring=size >= 48,
    ).convert("RGB")


def make_favicon_ico(out: Path) -> None:
    """Multi-resolution favicon.ico (16 / 32 / 48)."""
    sizes = (16, 32, 48)
    frames = [make_favicon(s) for s in sizes]
    out.parent.mkdir(parents=True, exist_ok=True)
    frames[-1].save(
        out,
        format="ICO",
        sizes=[(s, s) for s in sizes],
        append_images=frames[:-1],
    )


def write_all_svgs() -> None:
    write(SVG_DIR / "mark.svg", mark_svg(stroke=COL_BRAND, spark=COL_ACCENT, ring=True))
    write(SVG_DIR / "mark-on-dark.svg", mark_svg(stroke=COL_CREAM, spark=COL_ACCENT, ring=True))
    write(
        SVG_DIR / "mark-on-cream.svg",
        mark_svg(stroke=COL_BRAND, spark=COL_ACCENT, ring=True, bg=COL_CREAM),
    )
    write(
        SVG_DIR / "mark-on-brand.svg",
        mark_svg(stroke=COL_CREAM, spark=COL_ACCENT, ring=True, bg=COL_BRAND),
    )
    write(SVG_DIR / "mark-loop-only.svg", mark_svg(stroke=COL_BRAND, spark=COL_ACCENT, ring=False))
    write(SVG_DIR / "mark-mono.svg", mark_svg(stroke=COL_INK, spark=COL_INK, ring=True))
    write(SVG_DIR / "wordmark.svg", wordmark_svg(fill=COL_BRAND))
    write(SVG_DIR / "wordmark-on-dark.svg", wordmark_svg(fill=COL_CREAM))
    write(
        SVG_DIR / "wordmark-on-cream.svg",
        wordmark_svg(fill=COL_BRAND, bg=COL_CREAM),
    )
    write(
        SVG_DIR / "lockup-horizontal.svg",
        lockup_horizontal_svg(stroke=COL_BRAND, spark=COL_ACCENT, text=COL_BRAND),
    )
    write(
        SVG_DIR / "lockup-horizontal-on-cream.svg",
        lockup_horizontal_svg(
            stroke=COL_BRAND, spark=COL_ACCENT, text=COL_BRAND, bg=COL_CREAM
        ),
    )
    write(
        SVG_DIR / "lockup-horizontal-on-dark.svg",
        lockup_horizontal_svg(
            stroke=COL_CREAM, spark=COL_ACCENT, text=COL_CREAM, bg=COL_BRAND
        ),
    )
    write(
        SVG_DIR / "lockup-stacked.svg",
        lockup_stacked_svg(stroke=COL_BRAND, spark=COL_ACCENT, text=COL_BRAND),
    )
    write(
        SVG_DIR / "lockup-stacked-on-cream.svg",
        lockup_stacked_svg(
            stroke=COL_BRAND, spark=COL_ACCENT, text=COL_BRAND, bg=COL_CREAM
        ),
    )
    write(
        SVG_DIR / "lockup-stacked-on-dark.svg",
        lockup_stacked_svg(
            stroke=COL_CREAM, spark=COL_ACCENT, text=COL_CREAM, bg=COL_BRAND
        ),
    )


def rasterize_kit() -> None:
    PNG_DIR.mkdir(parents=True, exist_ok=True)
    APP_DIR.mkdir(parents=True, exist_ok=True)

    render_mark_png(PNG_DIR / "mark.png", stroke=COL_BRAND, spark=COL_ACCENT, bg=None, size=1024)
    render_mark_png(
        PNG_DIR / "mark-on-dark.png",
        stroke=COL_CREAM,
        spark=COL_ACCENT,
        bg=COL_BRAND,
        size=1024,
    )
    render_mark_png(
        PNG_DIR / "mark-on-cream.png",
        stroke=COL_BRAND,
        spark=COL_ACCENT,
        bg=COL_CREAM,
        size=1024,
    )
    render_mark_png(
        PNG_DIR / "mark-on-brand.png",
        stroke=COL_CREAM,
        spark=COL_ACCENT,
        bg=COL_BRAND,
        size=1024,
    )
    render_mark_png(
        PNG_DIR / "mark-loop-only.png",
        stroke=COL_BRAND,
        spark=COL_ACCENT,
        bg=None,
        size=1024,
        ring=False,
    )
    render_mark_png(PNG_DIR / "mark-mono.png", stroke=COL_INK, spark=COL_INK, bg=None, size=1024)

    render_wordmark_png(
        PNG_DIR / "wordmark.png", fill=COL_BRAND, bg=None, width=1200, height=280, font_size=120
    )
    render_wordmark_png(
        PNG_DIR / "wordmark-on-dark.png",
        fill=COL_CREAM,
        bg=COL_BRAND,
        width=1200,
        height=280,
        font_size=120,
    )
    render_wordmark_png(
        PNG_DIR / "wordmark-on-cream.png",
        fill=COL_BRAND,
        bg=COL_CREAM,
        width=1200,
        height=280,
        font_size=120,
    )

    lockup_horizontal_png(
        PNG_DIR / "lockup-horizontal.png",
        stroke=COL_BRAND,
        spark=COL_ACCENT,
        text=COL_BRAND,
        bg=None,
    )
    lockup_horizontal_png(
        PNG_DIR / "lockup-horizontal-on-cream.png",
        stroke=COL_BRAND,
        spark=COL_ACCENT,
        text=COL_BRAND,
        bg=COL_CREAM,
    )
    lockup_horizontal_png(
        PNG_DIR / "lockup-horizontal-on-dark.png",
        stroke=COL_CREAM,
        spark=COL_ACCENT,
        text=COL_CREAM,
        bg=COL_BRAND,
    )
    lockup_stacked_png(
        PNG_DIR / "lockup-stacked.png",
        stroke=COL_BRAND,
        spark=COL_ACCENT,
        text=COL_BRAND,
        bg=None,
    )
    lockup_stacked_png(
        PNG_DIR / "lockup-stacked-on-cream.png",
        stroke=COL_BRAND,
        spark=COL_ACCENT,
        text=COL_BRAND,
        bg=COL_CREAM,
    )
    lockup_stacked_png(
        PNG_DIR / "lockup-stacked-on-dark.png",
        stroke=COL_CREAM,
        spark=COL_ACCENT,
        text=COL_CREAM,
        bg=COL_BRAND,
    )

    make_app_icon(1024, dark=True).save(APP_DIR / "icon.png", "PNG")
    make_app_icon(1024, dark=False).save(APP_DIR / "icon-light.png", "PNG")
    make_adaptive_foreground(1024).save(APP_DIR / "adaptive-icon.png", "PNG")
    make_splash().save(APP_DIR / "splash.png", "PNG")
    make_og_banner().save(APP_DIR / "og-banner.png", "PNG")

    for s in (16, 32, 48, 180, 192, 512):
        make_favicon(s).save(APP_DIR / f"favicon-{s}.png", "PNG")
    make_favicon_ico(APP_DIR / "favicon.ico")

    MOBILE_ASSETS.mkdir(parents=True, exist_ok=True)
    make_app_icon(1024, dark=True).save(MOBILE_ASSETS / "icon.png", "PNG")
    make_adaptive_foreground(1024).save(MOBILE_ASSETS / "adaptive-icon.png", "PNG")
    make_splash().save(MOBILE_ASSETS / "splash.png", "PNG")
    # In-app marks (transparent) — cream stroke for dark UI, brand stroke for light UI
    render_mark_png(
        MOBILE_ASSETS / "logo-mark.png",
        stroke=COL_CREAM,
        spark=COL_ACCENT,
        bg=None,
        size=512,
        ring=True,
    )
    render_mark_png(
        MOBILE_ASSETS / "logo-mark-brand.png",
        stroke=COL_BRAND,
        spark=COL_ACCENT,
        bg=None,
        size=512,
        ring=True,
    )

    # API static brand (favicon + OG for docs / share previews)
    API_STATIC_BRAND.mkdir(parents=True, exist_ok=True)
    for name in (
        "favicon.ico",
        "favicon-32.png",
        "favicon-180.png",
        "favicon-192.png",
        "favicon-512.png",
        "og-banner.png",
        "icon.png",
    ):
        src = APP_DIR / name
        if src.exists():
            (API_STATIC_BRAND / name).write_bytes(src.read_bytes())

    for p in APP_DIR.glob("_*.png"):
        p.unlink(missing_ok=True)


def main() -> None:
    write_all_svgs()
    rasterize_kit()
    print("Forever logo kit generated:")
    print(f"  SVG  → {SVG_DIR}")
    print(f"  PNG  → {PNG_DIR}")
    print(f"  App  → {APP_DIR}")
    print(f"  Expo → {MOBILE_ASSETS}")
    print(f"  API  → {API_STATIC_BRAND}")


if __name__ == "__main__":
    main()
