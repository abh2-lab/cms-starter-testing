# PING responsive design system — spec for the WordPress rebuild

Everything here is taken from the **live theme's applied CSS** (`theme.css` tokens +
every block component on the 8 pages) and **measured in a browser** at real widths —
nothing is assumed. Hand this to the WordPress project and implement it as-is.

---

## 1. How the responsiveness works (the whole idea in 4 points)

1. **Type is fluid, not stepped.** Every font size is a `clamp(floor, linear, max)`.
   The linear part runs from the size's floor at **~320px** to its full desktop value
   at **1024px**, so the whole scale grows *in proportion* and there are **no jumps at
   breakpoints**. A 360px phone, a 600px tablet and a 900px window each get type sized
   for their own width.
2. **Above 1024px, type stops growing.** 1024px is the top anchor — H1 is 50px at
   1024px and stays 50px at 1920px. Desktop is the ceiling.
3. **The small sizes have floors** (for legibility): body/lead hold at 17px and H4 at
   18px across the phone range, then rejoin the ratio higher up. So the *top* of the
   scale (display/H1/H2/H3) is exactly proportional everywhere; the *bottom* is
   proportional only above ~700–900px.
4. **Spacing is a fixed 8px scale, with ONE fluid exception:** `--section-y` (the top/
   bottom padding of every colour band) is the only spacing value that scales with the
   screen (48px on phones → 80px on desktop). Everything else (`--space-1..12`) is a
   fixed step; blocks just **drop down a step or two at the 768px breakpoint** for gaps
   and paddings.

It's **plain CSS custom properties** — drop the `:root` block into the theme stylesheet
and it works in any WordPress theme, no framework needed.

---

## 2. Copy-paste CSS (tokens + the only media queries that touch tokens)

```css
:root {
  --font: 'Figtree', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto,
          'Helvetica Neue', Arial, sans-serif;

  /* ── Fluid type scale ──────────────────────────────────────────────
     clamp(floor, <line from floor@320 to max@1024>, desktop-max).
     The px comment shows the phone→desktop range. */
  --fs-display: calc(clamp(57.6px, 42.873px + 4.602vw, 90px) - 16px); /* 41.6 → 74  */
  --fs-h1:   clamp(32px,    23.818px + 2.557vw, 50px);   /* 32   → 50  */
  --fs-h2:   clamp(24.32px, 18.102px + 1.943vw, 38px);   /* 24.3 → 38  */
  --fs-h3:   clamp(19.2px,  14.291px + 1.534vw, 30px);   /* 19.2 → 30  */
  --fs-h4:   clamp(18px,    10.48px  + 1.125vw, 22px);   /* 18   → 22  (floor 18) */
  --fs-lead: clamp(17px,    9.527px  + 1.023vw, 20px);   /* 17   → 20  (floor 17) */
  --fs-body: clamp(17px,    8.575px  + 0.92vw,  18px);   /* 17   → 18  (floor 17) */
  --fs-sm: 16px;   /* fixed — never scales */
  --fs-xs: 14px;   /* fixed — never scales */

  --lh-tight: 1.15;   /* headings */
  --lh-snug:  1.3;    /* short multi-line titles */
  --lh-body:  1.55;   /* paragraphs */

  --fw-regular: 400; --fw-medium: 500; --fw-semibold: 600; --fw-bold: 700;

  /* ── Spacing — fixed 8px scale ── */
  --space-1: 4px;  --space-2: 8px;  --space-3: 12px; --space-4: 16px;
  --space-5: 24px; --space-6: 32px; --space-7: 40px; --space-8: 48px;
  --space-9: 64px; --space-10: 80px; --space-12: 96px;

  /* ── The ONE fluid spacing token: vertical padding of every band ── */
  --section-y: clamp(48px, 33.455px + 4.545vw, 80px);   /* 48 → 80 */

  /* ── Layout ── */
  --container: 1200px;   /* max content width, centred */
  --gutter: 24px;        /* min side margin below the container width */
  --header-h: 100px;     /* sticky header height (→ 68px on phones, below) */

  /* ── Pill buttons ── */
  --pill-font: calc(var(--fs-sm) + 1px);   /* 17px (→ 15px on phones, below) */
  /* NOTE: --pill-pad-* are intentionally NOT set here. On desktop each pill uses
     its OWN padding via a fallback (see §6). The media queries below DEFINE the
     vars only for tablet/phone, which is what makes every pill snap to one
     compact size there. */
}

/* Pills go compact + uniform on tablet and down */
@media (max-width: 1024px) {
  :root { --pill-pad-y: 8px; --pill-pad-x: 28px; }
}
/* Sticky header shrinks on phones */
@media (max-width: 768px) {
  :root { --header-h: 68px; }
}
/* Pills tightest on small phones */
@media (max-width: 480px) {
  :root { --pill-pad-y: 6px; --pill-pad-x: 20px; --pill-font: 15px; }
}

body { font-family: var(--font); font-size: var(--fs-body); line-height: var(--lh-body); }
```

*(Load Figtree — the live site uses Google Fonts weights 400/500/600/700.)*

---

## 3. The type scale — MEASURED px at real widths

Measured in a browser (not computed guesses). Read a column top-to-bottom to see the
whole scale at that width; read a row left-to-right to see how one size shrinks.

| token / role                         | ≤320px | 375px | 768px | **≥1024px** |
|--------------------------------------|:------:|:-----:|:-----:|:-----------:|
| `--fs-display` (stat base)           | 41.6   | 44.1  | 62.2  | **74**      |
| big stat = `display + 16px`          | 57.6   | 60.1  | 78.2  | **90**      |
| `--fs-h1`  (page / hero title)       | 32.0   | 33.4  | 43.5  | **50**      |
| `--fs-h2`  (section title)           | 24.3   | 25.4  | 33.0  | **38**      |
| kicker = `h2 − 4px`                  | 20.3   | 21.4  | 29.0  | **34**      |
| `--fs-h3`  (card title)              | 19.2   | 20.0  | 26.1  | **30**      |
| emphasis body = `h3 − 2px`           | 17.2   | 18.0  | 24.1  | **28**      |
| `--fs-h4`  (small card title)        | 18.0   | 18.0  | 19.1  | **22**      |
| `--fs-lead` (hero subtext, lede)     | 17.0   | 17.0  | 17.4  | **20**      |
| `--fs-body` (all paragraphs)         | 17.0   | 17.0  | 17.0  | **18**      |
| `--fs-sm`  (nav, footer, small)      | 16     | 16    | 16    | **16**      |
| `--fs-xs`  (eyebrow, fine print)     | 14     | 14    | 14    | **14**      |
| `--section-y` (band padding)         | 48.0   | 50.5  | 68.4  | **80**      |

---

## 4. Text roles → exact applied setting

This is the catalogue of every text *type* used across the live pages, with the real
values. "px" is desktop → phone (from the table above). Where weight varies by section
it's noted.

| # | Role (what it is) | font-size | weight | line-height | px (desktop→phone) | extra | used on |
|---|---|---|---|---|---|---|---|
| 1 | **Hero / page title** | `--fs-h1` | 600–700* | `--lh-tight` (1.15) | 50 → 32 | `max-width` ~620–820px | every hero H1, the shield final-CTA heading |
| 2 | **Section title** | `--fs-h2` | 600–700* | 1.15 (some 1.3) | 38 → 24 | often centred; `white-space: pre-line` on some | services, FAQ, studio, capability titles, shield how/cost/stats/model titles, cta panel |
| 3 | **Kicker / section opener** | `calc(--fs-h2 - 4px)` | 700 | 1.15 | 34 → 20 | — | work-grid / capability / why-us / outcomes / property kickers; shield model-number & cost/stats "eyebrows" |
| 4 | **Eyebrow (caps label)** | `--fs-xs` (14px) | 600 | — | 14 (fixed) | `text-transform: uppercase; letter-spacing: .04em` | small label above home-section headings (marketing hero, about-intro, services, impact) |
| 5 | **Card title (large)** | `--fs-h3` | 600–700* | `--lh-snug` (1.3) | 30 → 19 | work-preview caps at `min(--fs-h3, 1.4rem)` ≈22.4px | service / work / insight cards, outcome & property row titles, model bullets |
| 6 | **Card title (small)** | `--fs-h4` | 600–700* | 1.3 | 22 → 18 | — | capability card title, team member name, footer column headings |
| 7 | **Lead / hero subtext** | `--fs-lead` | 400 (tagline 700) | `--lh-body` (1.55) | 20 → 17 | `max-width` ~480–640px | hero subtexts, contact lede, cta-panel subtext, page-hero tagline |
| 8 | **Body paragraph** | `--fs-body` | 400 | 1.55 | 18 → 17 | `max-width` ~54–62ch | every description / subtitle / FAQ Q&A / form field / knowledge-hero body |
| 9 | **Emphasis body / big label** | `calc(--fs-h3 - 2px)` | 500–700* | 1.3–1.55 | 28 → 17 | — | about-intro body, the stat *labels* (about-intro, impact, property, shield-stats), shield-how item title |
| 10 | **Big stat number** | `calc(--fs-display + 16px)` | 700 | 1 | 90 → 58 | some add `tabular-nums` for count-up | the "12+", "202+", "$250K+" figures |
| 11 | **Small text** | `--fs-sm` (16px) | 400–700* | — | 16 (fixed) | — | nav links (700), footer text, property category (700), team role (400), chart bar labels (500) |
| 12 | **Fine print** | `--fs-xs` (14px) | 700 | — | 14 (fixed) | footer bottom: `uppercase; letter-spacing: .1em` | footer legal / copyright bar |
| 13 | **Button / pill label** | `--pill-font` (17px→15px) | 600 (some 500) | — | 17 → 15 | see §6 | every orange/blue CTA |
| 14 | **Text link** | `--fs-body` | 700 | 1.55 | 18 → 17 | `border-bottom: 2px solid currentColor` (or underline) | "See more" / property links / footer & contact links |

\* **Weight varies per section, not by size** — the *sizes* are consistent, but the same
size may be semibold (600) in one band and bold (700) in another; it's a per-band design
choice, not a rule you can derive from the band colour. The only firm patterns across the
live pages: **kickers (row 3) are always bold (700)**; the five main **hero H1s lean
semibold (600)** (marketing, about, brands, platforms, publishing) while the **knowledge &
shield hero titles are bold (700)**. For section and card titles it's roughly half-and-half
— follow the per-element weight in the table, and when authoring something new, default to
**700 for kickers and white-band titles, 600 for hero titles**.

**Line-height rule:** headings `1.15`, short multi-line titles `1.3`, paragraphs `1.55`.
Big numbers use `1`.

---

## 5. Spacing — the applied rules

**Band padding (vertical rhythm).** Almost every section is:
```css
.section { padding: var(--section-y) 0; }   /* fluid 48 → 80px */
```
Exceptions seen live: the tall heroes use `var(--space-12) 0` (96px) on desktop and
switch to `var(--section-y) 0` at ≤768px; the shield "model" cards sit on a tight
`var(--space-6) 0` (32px); split-panel sections (shield how/cost) use asymmetric
`--space-9` paddings that collapse to `--space-7/8` at ≤768px.

**The scale is fixed** (`--space-1..12` = 4 / 8 / 12 / 16 / 24 / 32 / 40 / 48 / 64 / 80 / 96px).
These **do not scale with the viewport** — instead blocks step down one notch at 768px.

**Element rhythm actually used** (all fixed tokens):

| between | value |
|---|---|
| eyebrow → heading | `--space-2` / `--space-3` (8–12px) |
| heading → body | `--space-4` / `--space-5` (16–24px) |
| body → CTA | `--space-6` (32px) |
| section title → grid/list | `--space-7` / `--space-8` (40–48px) |
| stat number → its label | `--space-2` / `--space-3` (8–12px) |
| card title → card description | `--space-3` / `--space-4` (12–16px) |
| card interior padding | `--space-6` (32px) — shield model cards `--space-8`/`--space-9` |

**Grid / flex gaps** and the **768px step-down** (the consistent pattern):

| context | desktop gap | at ≤768px |
|---|---|---|
| two-column layouts (why-us, property, shield split) | `--space-9` (64px) | `--space-7` (40px) |
| card grids (work, knowledge, team) | `--space-7` (40px) | `--space-6` (32px) |
| tight rows (services carousel, stat rows, outcome rows) | `--space-6` (32px) | `--space-4` / `--space-2` (16 / 8px) |

So on phones: `--section-y` auto-shrinks (fluid), multi-column layouts stack to one
column, and their gaps/paddings drop one step. That's the whole spacing responsiveness.

---

## 6. Buttons (pills) & links

**Pill CTAs** (the orange `#ff6a4d` and blue buttons):
```css
.pill {
  display: inline-flex; align-items: center;
  border-radius: 999px;
  font-size: var(--pill-font);          /* 17px → 15px on small phones */
  font-weight: var(--fw-semibold);      /* 600 (a couple use 500) */
  /* Desktop padding is written as the FALLBACK so each button can size itself;
     the :root media queries override the vars on tablet/phone to one compact size. */
  padding: var(--pill-pad-y, 11px) var(--pill-pad-x, 52px);
}
```
- **Desktop:** `--pill-pad-*` are unset, so the **fallback** wins. Vertical is ~**11px**
  everywhere; horizontal varies by where the button sits — **28px** inside a card, up to
  **52px** for a standalone hero CTA. (Live values: `calc(--space-3 - 1px)` = 11px vertical;
  `calc(--space-6 + 4px)` = 36px or `calc(--space-8 + 4px)` = 52px horizontal.)
- **≤1024px:** every pill becomes `8px / 28px` (uniform).
- **≤480px:** `6px / 20px` and the label drops to **15px**.

*(Simplest faithful WP version: give `.pill` a desktop `padding: 11px 52px` and let the
two media queries in §2 tighten it. The per-button horizontal variation on desktop is
minor.)*

**Header "Join Our Network" pill** is the same recipe at `--pill-font`, weight 400.

**Text links** (e.g. "See more →", property links): `--fs-body`, weight **700**, with a
`border-bottom: 2px solid currentColor` (or `text-decoration: underline` in the footer/
contact). Deep-blue `#0f2d96`, turning orange `#ff6a4d` on hover.

**Nav links:** `--fs-sm` (16px), weight **700**, deep blue, orange on hover/active.

---

## 7. Breakpoints — what each one does

The scale itself is continuous (no breakpoint), so these only handle **layout, header,
and pills**:

| width | what changes |
|---|---|
| **1199px** | Desktop nav collapses to a hamburger drawer. *(This is the site's ONE breakpoint exception — everything else uses 1024/768. Six nav links + the pill don't fit under ~1130px.)* |
| **1024px** | Pills go compact & uniform (`8px/28px`); 3-column grids → 2 columns (capability, team); footer 4 → 2 columns. |
| **900px** | Services & work-preview grids 3 → 2 columns. |
| **768px** | Header height 100 → **68px**; most two-/three-column sections **stack to one column** and **drop gaps/paddings one step**; tall heroes switch `--space-12` padding → `--section-y`. (Type keeps flowing continuously — no size jump here.) |
| **600px** | Services & work-preview card rows become **horizontal swipe** strips. |
| **480px** | Pills tightest (`6px/20px`), label → **15px**. |

---

## 8. Implementing in WordPress

- Drop the `:root` + media-query block from **§2** into the theme's main stylesheet
  (`style.css`, a block-theme `theme.json` `custom` map, or an enqueued file). It's
  vanilla CSS custom properties — no build step.
- Map your markup to the **roles in §4**: give each heading/paragraph/button the token
  from its row (`font-size: var(--fs-h2)` etc.). Don't hard-code px — always reference a
  token, so the responsiveness comes for free.
- For headings, pick weight by the §4 rule (coloured band → 600, white band / kicker → 700).
- Use `padding: var(--section-y) 0` on every section band; use the fixed `--space-*`
  tokens for everything else and add the `@media (max-width: 768px)` step-downs from §5.
- If you use `theme.json`: put these under `settings.custom` (they become
  `--wp--custom--*` vars) **or** just enqueue the raw CSS above — the raw route keeps the
  exact names (`--fs-h2`, `--space-6`) so this doc's tokens line up 1:1.
- Test by resizing a page from 320px to 1440px: the type should grow **smoothly** with no
  sudden jumps, hit its ceiling at 1024px, and never dip below the 16px body floor.
