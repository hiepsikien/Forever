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
  svg/          source marks + wordmarks
  png/          1024px marks, wordmarks, lockups
  app/          icon, adaptive FG, splash, favicons, OG banner
apps/mobile/assets/
  icon.png            Expo app icon (brand field)
  adaptive-icon.png   Android adaptive foreground
  splash.png          Launch screen
```

### Key assets

| Asset | Path |
|-------|------|
| Mark (transparent) | `svg/mark.svg`, `png/mark.png` |
| Mark on brand | `png/mark-on-brand.png` |
| Mark on cream | `png/mark-on-cream.png` |
| Loop only (tiny) | `svg/mark-loop-only.svg` |
| Mono | `svg/mark-mono.svg` |
| Horizontal lockup | `png/lockup-horizontal-on-cream.png` |
| Stacked lockup | `png/lockup-stacked-on-dark.png` |
| App icon | `app/icon.png` (+ light variant) |
| Adaptive FG | `app/adaptive-icon.png` |
| Splash | `app/splash.png` |
| Favicons | `app/favicon-{16,32,48,180,192,512}.png` |
| OG / social | `app/og-banner.png` |

## Clear space & sizing

- Keep clear space ≥ ¼ of mark diameter on all sides.
- Prefer full mark (ring + ∞ + spark) at ≥ 48px.
- Below 48px use `mark-loop-only` (no ring) or solid brand tile favicon.
- Do not recolor the spark away from accent gold on primary lockups.
- Do not stretch; scale uniformly.
- Do not place the mark over busy photography without a solid scrim.

## Regenerate

```bash
python3 -m pip install pillow cairosvg
python3 scripts/generate-logo-kit.py
```

Rewrites `brand/logo/**` and syncs `apps/mobile/assets/{icon,adaptive-icon,splash}.png`.
