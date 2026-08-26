# PING page mocks — shared build notes

These are **static, self-contained HTML design references** for the WordPress
rebuild. `home.html` is the finished **gold reference**. Every other page must
match its shell and conventions exactly.

## Hard rules

1. **Copy the SHARED SHELL verbatim from `home.html`:**
   - the whole `<head>` (Google-Fonts link + the `<style>` block from
     `/* ===== SHARED SHELL ... */` down to the end of `/* ===== SITE FOOTER ... */`),
   - the `<input id="navcb">` + `<header class="site-header">…</header>` markup,
   - the `<footer class="site-footer">…</footer>` markup.
   Do **not** re-invent tokens, header or footer. Only the `/* ===== PAGE
   SECTIONS ===== */` CSS block and the `<main>` content change per page.
2. **Self-contained**: no external files except the Google Fonts link already in
   the shell. Inline all CSS and all SVGs.
3. **Faithful**: pull real copy from the fixture content given in your task.
   Match each block's background band, layout, type sizes and colours by reading
   its Vue component (paths given in your task). Reuse the shell's design tokens
   (`var(--fs-h2)`, `var(--space-6)`, colour vars, etc.).
4. **Nav**: keep the header's active link — set `class="nav-link is-active"` on
   the current page's nav item (Home/About Us/Brands/Platforms/Publishing).
   Knowledge and PING Shield are not in the top nav, so none is active there.
5. Set `<title>` to `PING Network — <Page> (design reference)`.

## PING presentation language (from the live theme)

- **Colour bands** alternate down the page (blue `#4295f8`, sky `#92deff`, white,
  navy `#0f2d96`, orange `#ff6a4d`). A band **never** has a border; sections butt
  straight together.
- Text is **left-aligned** by default; section titles like FAQ / logo strip /
  services are **centred**. Copy colour is deep blue `#0f2d96` on light bands,
  white on dark/coloured bands.
- **Cards are borderless** — a fill or a rounded thumbnail, never an outline.
  Radius is generous (18–32px).
- **Big stats**: the hero/impact numbers are ~90px bold (`calc(var(--fs-display)
  + 16px)`), left-aligned, orange or navy, with a smaller label under them.
- **Pill CTAs**: orange `#ff6a4d` rounded-999px. Shell provides `.pill.pill--orange`.
- **Curves sit BEHIND content** (see below).

## Colours

| name | hex | use |
|------|-----|-----|
| deep blue | `#0f2d96` | text, navy bands, footer, cards |
| mid blue | `#4295f8` | hero band, accents |
| sky | `#92deff` | light bands, most curves |
| orange | `#ff6a4d` | pills, stats, orange band, team/snake curves |

## The curve / swoosh system

Host section gets `class="… has-curve"` (adds `position:relative; overflow:hidden`).
Drop the curve `<svg>` as the FIRST child, then the `.container-custom` content.
The shell already defines `.curve`, the placement helpers, the colour classes and
the shared `stroke-width:130`. **Never** set a stroke width on the path yourself —
the shared rule owns it. Paste the exact snippet for your page:

**converging** — Brands page-hero, sky crest along the bottom:
```html
<svg class="curve curve--sky curve--x-bottom" viewBox="0 0 1440 520" preserveAspectRatio="xMidYMax slice" aria-hidden="true"><path d="M-140 430 C420 310, 1020 310, 1580 430"/></svg>
```

**swell** — Publishing page-hero, wide arch whose legs run off the bottom:
```html
<svg class="curve curve--sky curve--x-bottom" viewBox="0 0 1440 520" preserveAspectRatio="xMidYMax slice" aria-hidden="true"><path d="M230 580 C370 400, 630 250, 840 248 C1055 246, 1185 400, 1260 580"/></svg>
```

**arcs** — Platforms page-hero, steep sky band down the right:
```html
<svg class="curve curve--sky curve--y-right" viewBox="900 -80 380 680" preserveAspectRatio="xMaxYMid slice" aria-hidden="true"><path d="M980 560 C1070 375, 1165 175, 1200 -40"/></svg>
```

**crescent** — Brands "outcomes" section, soft sky crescent on the right:
```html
<svg class="curve curve--sky curve--y-right" viewBox="60 -120 300 700" preserveAspectRatio="xMaxYMid meet" aria-hidden="true"><path d="M134.9 -49.8 A330 330 0 0 1 134.9 509.8"/></svg>
```

**rising-line** — Platforms "why-us" section, long sky line rising up the left:
```html
<svg class="curve curve--sky curve--y-left" viewBox="-80 -180 500 820" preserveAspectRatio="xMinYMid meet" aria-hidden="true"><path d="M10 610 C57 492, 150 323, 218 197 C284 43, 313 -47, 340 -150"/></svg>
```

**team-ribbon** — About page, TWO orange curves spanning the hero + team band
(the About hero band is mid-blue `#4295f8`; put this curve on it, anchored top):
```html
<svg class="curve curve--orange curve--x-top" viewBox="0 0 1440 1180" preserveAspectRatio="xMidYMin slice" aria-hidden="true"><path d="M-63.88 301.63 C-63.88 301.63, 606.49 564.36, 1435.1 636.82"/><path d="M494.66 1051.81 C494.66 1051.81, 1449.8 327.52, -30.64 15.63"/></svg>
```

**page-snake** — Publishing only: one faint orange wave running the FULL page
height behind everything. Implement as a repeating background (handles any
height, keeps one weight). Add to your PAGE SECTIONS CSS:
```css
main { position: relative; }
.page-snake { position: absolute; inset: 0; z-index: 0; pointer-events: none;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1440 1440' preserveAspectRatio='none'%3E%3Cpath d='M860 0 C970 120 1290 200 1290 360 C1290 520 970 600 860 720 C750 840 430 920 430 1080 C430 1240 750 1320 860 1440' fill='none' stroke='%23FF6A4D' stroke-width='120' stroke-linecap='round'/%3E%3C/svg%3E");
  background-repeat: repeat-y; background-position: center top; background-size: 100% auto; opacity: .9; }
main > section { position: relative; z-index: 1; }  /* solid bands cover the snake; transparent ones reveal it */
```
Put `<div class="page-snake" aria-hidden="true"></div>` as the FIRST child of
`<main>`. Publishing's "clear" bands (capability-grid, final cta-panel) use
`background: transparent` so the snake shows through; all other bands stay solid.

## Placeholders (dynamic content with no fixed data)

- **Team photos / portfolio thumbnails / studio photos**: borderless rounded box
  filled from the PING palette, cycling `#0f2d96 → #4295f8 → #92deff`. Keep the
  card's real title/name text under it where the block has one.
- **Brand logos**: rounded chip, `rgba(255,255,255,.12)` on navy, the word
  `LOGO` in faint letters (see home's `.bls-logo`).
- **Video**: mid-blue rounded box with the white play button (see home `.impact-video`).

## FAQ accordion

Reuse home's `.fq*` styles and the native `<details>/<summary>` pattern (first
item `open`). Copy the `.fq*` CSS into your PAGE SECTIONS block if the page has
an FAQ.

## Verify before you finish

Your file must open standalone with no console errors, no horizontal scroll
(`document.documentElement.scrollWidth === clientWidth`), every band the right
colour, and every curve visible behind its section at stroke-width 130.
