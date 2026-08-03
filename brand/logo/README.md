# Forever — Brand Logo Kit

> **The Living Loop** — vault ring · infinity · heritage spark

## Concept

| Element | Meaning |
|---------|---------|
| Outer ring | Protective family circle / vault |
| Lemniscate ∞ | Continuity across generations — *forever* |
| Gold spark | Living heritage core (Identity Lock) |

Not a social network mark. Not a book. Distinct from the Read book product.

## Palette

Aligned with `apps/mobile/lib/theme.ts`:

| Token | Hex | Use |
|-------|-----|-----|
| Brand | `#2d4a3e` | Primary field, dark surfaces, splash |
| Accent | `#c4a574` | Heritage spark, taglines |
| Cream | `#f4efe6` | Light fields, mark on dark |
| Ink | `#1c241f` | Mono / print |

## Typography

- **Wordmark:** Noto Serif Display (app UI already uses Georgia as display)
- Tracking: ~0.06–0.10em on lockups
- Tagline (splash): *Két sắt ký ức gia tộc*

## Files

```
brand/logo/
  svg/          source marks, wordmarks, vector lockups
  png/          1024px marks, wordmarks, lockups
  app/          icon, adaptive FG, splash, favicons, favicon.ico, OG banner
apps/mobile/assets/
  icon.png              Expo app icon (brand field — primary)
  icon-light.png        Alt cream-field icon (marketing; not wired in Expo)
  adaptive-icon.png     Android adaptive foreground
  splash.png            Launch screen
  logo-mark.png         Transparent mark (cream stroke) for dark UI
  logo-mark-brand.png   Transparent mark (brand stroke) for light UI
apps/api/static/brand/  Favicon + OG served by API (/favicon.ico, /brand/*)
```

### Key assets

| Asset | Path |
|-------|------|
| Mark (transparent) | `svg/mark.svg`, `png/mark.png` |
| Mark on brand | `png/mark-on-brand.png` |
| Mark on cream | `png/mark-on-cream.png` |
| Loop only (tiny) | `svg/mark-loop-only.svg` |
| Mono | `svg/mark-mono.svg` |
| Wordmark | `svg/wordmark.svg`, `wordmark-on-dark.svg`, `wordmark-on-cream.svg` |
| Horizontal lockup (vector) | `svg/lockup-horizontal*.svg` |
| Horizontal lockup (raster) | `png/lockup-horizontal*.png` |
| Stacked lockup (vector) | `svg/lockup-stacked*.svg` |
| Stacked lockup (raster) | `png/lockup-stacked*.png` |
| App icon | `app/icon.png` (+ `icon-light.png` for cream field) |
| Adaptive FG | `app/adaptive-icon.png` |
| Splash | `app/splash.png` |
| Favicons | `app/favicon-{16,32,48,180,192,512}.png`, `app/favicon.ico` |
| OG / social | `app/og-banner.png` |

### In-app usage

- `apps/mobile/components/BrandLogo.tsx` — mark + wordmark
- Login hero: stacked lockup on brand green
- Home header: horizontal lockup on cream

### API / docs

With no separate web frontend, the API serves brand assets for docs and share previews:

| URL | Asset |
|-----|-------|
| `GET /favicon.ico` | Multi-size ICO |
| `GET /brand/og-banner.png` | Open Graph banner |
| `GET /brand/*` | Other synced files (`icon.png`, PNG favicons, …) |

Swagger UI uses `/favicon.ico` when present.

### `icon-light.png`

Cream-field variant for marketing / light store listings. Expo `app.config.js` uses the brand-field `icon.png` only (standard for iOS/Android).

## Clear space & sizing

- Keep clear space ≥ ¼ of mark diameter on all sides.
- Prefer full mark (ring + ∞ + spark) at ≥ 48px.
- Below 48px use `mark-loop-only` (no ring) or solid brand tile favicon.
- Do not recolor the spark away from accent gold on primary lockups.
- Do not stretch; scale uniformly.
- Do not place the mark over busy photography without a solid scrim.
- Vector lockups use system/web fonts (`Georgia` / Noto Serif Display) — convert text to outlines before sending to a printer that lacks those faces.

## Regenerate

```bash
python3 -m pip install pillow cairosvg
python3 scripts/generate-logo-kit.py
```

Rewrites `brand/logo/**`, syncs `apps/mobile/assets/{icon,adaptive-icon,splash,logo-mark*}.png`, and `apps/api/static/brand/`.
