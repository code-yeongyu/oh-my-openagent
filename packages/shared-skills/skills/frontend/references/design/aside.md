# Design System Inspired by Aside

> Category: Developer Tools & IDEs
> AI browser agent. Dark-mode squircle UI, AsideDisplay variable font, sky-blue brand accent.

## 1. Visual Theme & Atmosphere

Aside's website presents a polished, app-like experience that mirrors the product itself — an AI-powered browser built to do real work. The design is dark-mode-first, opening on a near-black canvas (`#0a0a0a`) with carefully calibrated warm grays that avoid the cold, sterile feel of typical developer tools. The overall impression is of a premium native application rather than a marketing site, reinforced by the hero section's browser-frame mockup that blurs the line between product and page.

The most distinctive visual element is the squircle border-radius system. Rather than standard CSS `border-radius`, Aside applies `corner-shape: superellipse()` to all rounded elements, producing the iOS-like continuous curvature that feels softer and more organic than circular arcs. This single detail — applied consistently from buttons to cards to the browser frame showcase — gives the entire interface a cohesive, platform-native quality that most web experiences lack.

Typography is anchored by AsideDisplay, a custom variable font used exclusively for display headlines at tight tracking (`-0.0125em`). Body text and UI elements use Geist (Vercel's open-source sans-serif), while code surfaces use Geist Mono. The three-font stack creates a clear hierarchy: AsideDisplay commands attention, Geist handles utility, and Geist Mono signals technical content. All three are variable fonts supporting weight 100–900, giving the system fine-grained control without loading multiple font files.

The color system uses a shadcn/ui-derived token architecture with full light and dark palettes, though the site presents exclusively in dark mode. A custom `mist` color scale (`#090b0c` at 950, `#22292b` at 800) replaces pure neutral black with a barely perceptible teal-green undertone — the foreground color in light mode is `#090b0c` (mist-950), not `#000000`. The brand accent is sky blue (`#00bcfe`), used sparingly for the `--brand` token but never as a primary CTA color. Instead, the primary button inverts the foreground/background relationship: dark text on light surface in dark mode, dark surface with light text in light mode.

**Key Characteristics:**
- Dark-mode-first presentation with warm mist-toned blacks (`#090b0c`, `#22292b`)
- Squircle/superellipse border-radius on all rounded elements — iOS-like continuous curvature
- AsideDisplay custom variable font for headlines, Geist for body, Geist Mono for code
- Sky blue brand accent (`#00bcfe`) used as a signal color, not a CTA color
- shadcn/ui token architecture with `--primary`, `--secondary`, `--muted`, `--accent` semantic tokens
- Full light/dark dual palette, though the marketing site shows dark mode only
- Browser-frame product showcase as the central hero element with glass morphism
- Y Combinator-backed badge as a trust signal
- Tailwind CSS v4 with `color-mix()` and `oklch` color space support

## 2. Color Palette & Roles

### Primary (Dark Theme — site default)
- **Near Black** (`#0a0a0a`): `--background`. Page canvas. A pure neutral-950 — warm but not tinted.
- **Off White** (`#fafafa`): `--foreground`. Primary text in dark mode. Neutral-50.
- **Light Gray** (`#e5e5e5`): `--primary`. Primary interactive surface in dark mode — buttons, links. Neutral-200.
- **Dark Gray** (`#171717`): `--primary-foreground`. Text on primary surfaces. Neutral-900.

### Primary (Light Theme)
- **White** (`#ffffff`): `--background`. Page canvas.
- **Mist Black** (`#090b0c`): `--foreground` and `--primary`. A custom near-black with subtle teal undertone (not pure `#000`).
- **Near White** (`#fafafa`): `--primary-foreground`. Text on primary surfaces.

### Brand & Accent
- **Sky Blue** (`#00bcfe`): `--brand` (mapped from `--color-sky-400`). The signature accent — used for brand moments, hover highlights, and decorative elements. Not used for primary CTAs.
- **Sky Light** (`#f0f9ff`): `--color-sky-50`. Tinted surface for sky-themed elements.

### Surface & Background
- **Card Dark** (`#171717`): `--card`. Card and container surfaces in dark mode. Neutral-900.
- **Card Light** (`#ffffff`): `--card`. Light-mode card surface.
- **Muted Dark** (`#262626`): `--muted`. Subdued surface for de-emphasized areas. Neutral-800.
- **Muted Light** (`#f5f5f5`): `--muted`. Light-mode subdued surface. Neutral-100.
- **Popover Dark** (`#171717`): `--popover`. Dropdown/overlay surface. Neutral-900.
- **Glass Surface**: `color-mix(in oklab, var(--background) 80%, transparent)`. Browser-frame web content background — translucent with backdrop blur.

### Neutrals & Text
- **Muted Foreground** (`#a1a1a1`): `--muted-foreground`. Secondary text, placeholders. Neutral-500.
- **Ring** (`#737373` dark / `#a1a1a1` light): `--ring`. Focus ring color. Neutral-500/400.
- **Border Dark** (`rgba(255,255,255,0.1)`): `--border`. Dark-mode borders — white at 10% opacity.
- **Border Light** (`#e5e5e5`): `--border`. Light-mode borders. Neutral-200.
- **Surface Border** (`rgba(250,250,250,0.15)`): `--border-surface`. Subtle surface separation.
- **Surface Border Strong** (`rgba(250,250,250,0.2)`): `--border-surface-strong`. Emphasized surface borders.

### Status Colors
- **Destructive Dark** (`#ff6568`): `--destructive`. Error in dark mode — a soft coral-red. `--color-red-400`.
- **Destructive Light** (`#e40014`): `--destructive`. Error in light mode — a deeper, more serious red.
- **Success** (`#00bb7f`): `--color-emerald-500`. Success indicators.
- **Warning** (`#f99c00`): `--color-amber-500`. Warning accents.
- **Orange** (`#fe6e00`): `--color-orange-500`. Warm informational accent.
- **Rose** (`#ff2357`): `--color-rose-500`. Decorative hot pink accent.

### Custom Colors
- **Mist 950** (`#090b0c`): The defining custom color — a near-black with a barely perceptible cool teal-green cast. Used as `--foreground` in light mode, distinguishing Aside from brands that use pure black.
- **Mist 800** (`#22292b`): A dark teal-gray for elevated dark surfaces.

## 3. Typography Rules

### Font Family
- **Display**: `AsideDisplay Variable` (CSS: `displayFont`), fallback: `Arial`
- **Body / UI**: `Geist` (variable, weight 100–900), fallback: `Arial`
- **Monospace**: `Geist Mono` (variable, weight 100–900), fallback: `Arial`
- **CSS custom properties**: `--font-display`, `--font-sans`, `--font-mono`

### Hierarchy

| Role | Font | Size | Weight | Line Height | Letter Spacing | Notes |
|------|------|------|--------|-------------|----------------|-------|
| Display Hero | AsideDisplay | 48px (3rem) | 400–500 | 1.08 (tight) | -0.0125em | `font-display tracking-display`, xl: text-5xl |
| Display Medium | AsideDisplay | 36px (2.25rem) | 400–500 | 1.10 (tight) | -0.0125em | Section headlines |
| Section Heading | AsideDisplay | 30px (1.875rem) | 400 | 1.15 (tight) | -0.0125em | Feature section titles |
| Sub-heading | Geist | 20px (1.25rem) | 500–600 | 1.20 | normal | Card titles, sub-sections |
| Body Large | Geist | 18px (1.125rem) | 400 | 1.50 | normal | Intro text, hero subtitle |
| Body | Geist | 16px (1rem) | 400 | 1.50 | normal | Standard reading text |
| Body Small | Geist | 14px (0.875rem) | 400–500 | 1.43 | normal | Compact body, nav links |
| Button | Geist | 14px (0.875rem) | 500 | 1.00 | normal | Primary/secondary buttons, `text-sm font-medium` |
| Button Large | Geist | 16px (1rem) | 500 | 1.00 | normal | `md:text-base` size-up |
| Caption | Geist | 12px (0.75rem) | 400–550 | 1.33 | 0.01em | Badges, labels, YC pill |
| Code | Geist Mono | 14px (0.875rem) | 400 | 1.50 | normal | Inline code, terminal text |

### Principles
- **AsideDisplay is display-only**: Never used for body text, buttons, or UI chrome. Reserved for headlines where its custom letterforms create brand presence.
- **Geist carries all functional weight**: Navigation, buttons, labels, body text — all Geist. The variable font makes weight transitions seamless.
- **Tight tracking on display**: `-0.0125em` letter-spacing on all AsideDisplay text creates dense, engineered headlines that feel confident without being aggressive.
- **Font-weight as hierarchy signal**: Display uses 400–500 (medium), UI elements use 500 (medium), body uses 400 (regular). No bold (700) in the primary hierarchy.
- **`font-semimedium` utility**: A custom weight designation (`font-[550]` or `font-[450]`) for badge/pill text — between regular and medium.

## 4. Component Stylings

### Buttons

**Primary (Dark Mode)**
- Background: `#e5e5e5` (`--primary`)
- Text: `#171717` (`--primary-foreground`)
- Padding: 0 10px (h-8 px-2.5) or 0 12px (h-9 px-3, md)
- Radius: squircle `rounded-xl` (0.75rem superellipse)
- Hover: `bg-primary/80` (80% opacity)
- Font: 14px Geist weight 500
- Active: `scale(0.95)` transform
- Use: Primary CTA ("Download", "Try it")

**Primary Pill (Hero CTA)**
- Same as Primary but `rounded-full` (pill shape with squircle)
- Larger: h-11 on mobile, h-9/h-10 on desktop
- Includes leading icon (download arrow)
- Use: Hero section download button

**Ghost / Icon**
- Background: transparent
- Text: `--muted-foreground`
- Hover: `bg-muted text-foreground`
- Size: 36px square (`size-9`) or 44px (`size-11`)
- Radius: squircle `rounded-xl`
- Use: Icon-only actions, search, compose

**Badge / Pill**
- Background: transparent
- Text: `text-primary/70` (70% opacity primary)
- Border: `border-primary/20` (20% opacity)
- Padding: 0 10px (h-6 px-2.5)
- Radius: `rounded-full`
- Font: 12px weight 550, tracking 0.01em
- Use: Trust badges ("Backed by Y Combinator")

### Cards & Containers
- Background: `--card` (`#171717` dark)
- Border: `--border-surface` (`rgba(250,250,250,0.15)`) or `--border-surface-strong` for emphasis
- Radius: squircle `rounded-xl` (0.75rem) standard, `rounded-2xl` (1rem) featured, `rounded-3xl` (1.5rem) hero
- Shadow: `shadow-xl` on the browser frame showcase
- Glass variant: `bg-web-content-background/80` with backdrop blur for the browser frame

### Browser Frame (Distinctive Component)
- Full browser mockup with macOS traffic light dots (red `bg-red-400`, amber `bg-amber-400`, green `bg-green-500`)
- Sidebar with bookmark items (favicons + labels)
- Glass morphism web content area
- Border: `border-glass` token
- Responsive scaling via CSS `transform: scale()` at breakpoints
- Min width 1200px, max width 1320px, centered

### Inputs & Forms
- Border: `--input` (`rgba(255,255,255,0.15)` dark / `#e5e5e5` light)
- Focus: `--ring` focus ring
- Radius: squircle `rounded-xl`
- Text: `--foreground`
- Placeholder: `--muted-foreground`

### Navigation
- Sticky top bar, transparent on hero background
- Logo: Aside SVG wordmark, `h-9`, `#090b0c` fill in light / `currentColor` in dark
- Links: Geist 14px weight 500, `font-sans text-sm font-medium`
- Dropdowns via Base UI (`@base-ui/dropdown-menu`)
- CTA: Primary button right-aligned ("Download")
- Mobile: Hamburger toggle, `size-9` button
- Height: `h-14` (56px)

## 5. Layout Principles

### Spacing System
- Base unit: 4px (Tailwind `--spacing` default)
- Scale: 0.5 (2px), 1 (4px), 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10, 12, 14, 16, 20, 24, 32, 40, 64
- Page padding: `p-2 md:p-4` (8px mobile, 16px desktop) outer wrapper
- Section padding: `py-16` (64px) for hero sections
- Card spacing: `--card-spacing: calc(var(--spacing) * 4)` (16px)

### Grid & Container
- No explicit max-width container — content width controlled by component sizing
- Browser frame: min 1200px, max 1320px, centered with 120px horizontal inset
- Hero: centered text with generous padding, `max-sm:px-8 max-sm:text-left`
- Feature sections: likely 2–3 column grids
- Responsive scaling: browser frame scales from 1.0 (desktop) to 0.5 (mobile) via CSS transforms

### Whitespace Philosophy
- **App-like density**: Tighter than typical marketing sites — the interface mimics the product's native-app feel rather than luxurious editorial spacing.
- **Hero breathes, UI compresses**: The hero section has generous `py-16` padding, but UI components within the browser showcase are densely packed (8px sidebar items, compact navigation).
- **Responsive scaling over reflow**: The browser-frame hero uses CSS `transform: scale()` at breakpoints rather than reflowing content, maintaining visual fidelity across viewport sizes.

### Border Radius Scale
- Standard: `rounded-md` (6px squircle) — small interactive elements
- Comfortable: `rounded-lg` (8px squircle) — sidebar items, small buttons, traffic light dots area
- Generous: `rounded-xl` (12px squircle) — buttons, inputs, cards, primary radius
- Large: `rounded-2xl` (16px squircle) — browser frame, featured containers
- Hero: `rounded-3xl` (24px squircle) — hero wrapper, largest containers
- Pill: `rounded-full` — badges, hero CTA, circular elements
- **All with `corner-shape: superellipse(var(--squircle-factor))`** — the defining detail

## 6. Depth & Elevation

| Level | Treatment | Use |
|-------|-----------|-----|
| Flat (Level 0) | No shadow | Page background, inline text |
| Subtle (Level 1) | `0 1px 2px rgba(0,0,0,0.15)` (`--drop-shadow-sm`) | Subtle element lift |
| Glass (Level 2) | `color-mix(in oklab, var(--background) 80%, transparent)` + backdrop-blur | Browser frame content area, translucent overlays |
| Elevated (Level 3) | `shadow-xl` (Tailwind default xl shadow) | Browser frame showcase, modals |
| Border-as-depth | `--border-surface` (15–20% opacity white/black) | Cards, containers — border creates perceived elevation without shadow |

**Shadow Philosophy**: Aside communicates depth primarily through **opacity-based borders and glass morphism** rather than traditional drop shadows. The `--border-surface` (15% opacity) and `--border-surface-strong` (20% opacity) tokens create subtle containment lines that separate layers without the visual weight of shadows. The glass surface (`color-mix` with 80% background opacity) on the browser frame showcase is the most dramatic depth effect — a frosted-glass plane that suggests the product UI hovering above the marketing page.

## 7. Do's and Don'ts

### Do
- Use squircle/superellipse `corner-shape` on all rounded elements — this IS the Aside identity
- Use mist-950 (`#090b0c`) for foreground in light mode instead of pure black — the teal undertone matters
- Keep AsideDisplay exclusive to display-size headlines — never use it for body or UI text
- Apply sky-blue (`#00bcfe`) as a brand signal sparingly — it's not a CTA color
- Use opacity-based borders (`rgba(255,255,255,0.1–0.2)`) for dark-mode containment
- Invert the primary button in dark mode: light surface (`#e5e5e5`) with dark text (`#171717`)
- Match the product's native-app density — tighter spacing than typical marketing sites
- Use `color-mix(in oklab, ...)` for glass/translucent surfaces

### Don't
- Don't use circular `border-radius` — always apply the squircle superellipse factor
- Don't use pure black (`#000000`) for text — use mist-950 (`#090b0c`) or neutral-950 (`#0a0a0a`)
- Don't use sky-blue for primary buttons — it's a decorative/brand accent only
- Don't use AsideDisplay below 24px — it's not designed for small sizes
- Don't use warm-toned grays — Aside's neutrals are pure (neutral scale) with the only warmth in the custom mist colors
- Don't apply heavy drop shadows — depth comes from opacity borders and glass morphism
- Don't use weight 700+ on Geist for UI elements — keep to 400–550 range
- Don't introduce pill-shaped buttons except for the hero CTA and badges — standard CTAs use `rounded-xl`

## 8. Responsive Behavior

### Breakpoints
| Name | Width | Key Changes |
|------|-------|-------------|
| Mobile | <640px | Single column, hamburger nav, hero text left-aligned, browser frame scales to 0.5x |
| Tablet | 640–768px | Slightly wider content, nav still collapsed |
| Small Desktop | 768–1024px | Full horizontal nav appears, browser frame at 0.7–0.8x scale |
| Desktop | 1024–1280px | Full layout, browser frame at 0.9x |
| Large Desktop | >1280px | Browser frame at 1.0x (1200–1320px), maximum hero height (832px) |

### Touch Targets
- Buttons: minimum h-8 (32px) compact, h-9 (36px) standard, h-11 (44px) hero CTA on mobile
- Navigation links: adequate spacing in horizontal nav with dropdown triggers
- Mobile hamburger: 36px (`size-9`) touch target
- Sidebar items: 32px (`h-8`) minimum height

### Collapsing Strategy
- **Navigation**: Full horizontal with dropdowns → hamburger toggle on mobile
- **Hero**: Centered text → left-aligned (`text-left`) on mobile, hero CTA gains full padding
- **Browser frame**: CSS `transform: scale()` — 1.0x desktop → 0.9x → 0.8x → 0.7x → 0.5x mobile — no reflow, pure scaling
- **Hero height**: 832px → 720px → 700px → 620px → 460px across breakpoints
- **Page padding**: 16px desktop (`p-4`) → 8px mobile (`p-2`), with `pb-0` to allow content flush

### Image Behavior
- Browser frame showcase maintains squircle radius at all sizes via scaled container
- Product screenshots within the browser frame scale proportionally
- Background image on hero section via CSS `background-image`, covers full section
- Favicon/bookmark icons maintain 16px (`size-4`) at all sizes

## 9. Agent Prompt Guide

### Quick Color Reference
- Page background (dark): Near Black (`#0a0a0a`)
- Page background (light): White (`#ffffff`)
- Primary text (dark): Off White (`#fafafa`)
- Primary text (light): Mist Black (`#090b0c`)
- Primary button (dark): Light Gray (`#e5e5e5`) bg, Dark (`#171717`) text
- Primary button (light): Mist Black (`#090b0c`) bg, Off White (`#fafafa`) text
- Brand accent: Sky Blue (`#00bcfe`)
- Muted surface (dark): Dark Gray (`#262626`)
- Muted text: Medium Gray (`#a1a1a1`)
- Border (dark): White 10% (`rgba(255,255,255,0.1)`)
- Card (dark): Charcoal (`#171717`)
- Error (dark): Coral (`#ff6568`)
- Success: Emerald (`#00bb7f`)

### Example Component Prompts
- "Create a hero section on near-black (#0a0a0a) background. Headline in AsideDisplay at 48px weight 400, line-height 1.08, letter-spacing -0.0125em, color #fafafa. Subtitle in Geist 18px weight 400, #a1a1a1. Primary pill CTA: #e5e5e5 bg, #171717 text, rounded-full with superellipse, h-10 px-3. Include a download icon."
- "Design a card on #171717 with rgba(250,250,250,0.15) border, squircle rounded-xl (12px superellipse). Title in Geist 20px weight 500, #fafafa. Body in 16px weight 400, #a1a1a1. No box-shadow — border is the depth signal."
- "Build a navigation bar: transparent bg on hero, h-14. Geist 14px weight 500 for links, #fafafa text. Primary button right-aligned: #e5e5e5 bg, #171717 text, rounded-xl, h-8 px-2.5. Logo SVG left-aligned, h-9."
- "Create a badge/pill: transparent bg, border at 20% primary opacity, rounded-full. Text in 12px Geist weight 550 at 70% primary opacity. Padding h-6 px-2.5. Include a trailing chevron icon at 50% opacity."
- "Design a glass-morphism browser frame: #171717 base with border-glass, rounded-2xl squircle. Traffic light dots (red-400, amber-400, green-500) at 12px. Web content area uses color-mix(in oklab, #0a0a0a 80%, transparent) for frosted glass. Shadow-xl."

### Iteration Guide
1. Always apply `corner-shape: superellipse()` to any `border-radius` — this is the brand's most distinctive visual detail
2. Use `#090b0c` (mist-950) for foreground in light mode, never `#000000`
3. Primary buttons invert in dark mode: light surface, dark text — the opposite of most dark-mode systems
4. Sky blue (`#00bcfe`) is decorative only — never use it for CTAs or primary buttons
5. Borders use opacity (10–20%) rather than solid colors in dark mode — `rgba(255,255,255,0.1)`
6. Glass surfaces use `color-mix(in oklab, background 80%, transparent)` — a modern CSS approach
7. AsideDisplay only at display sizes (24px+) with tight tracking (-0.0125em)
8. Geist at 500 weight for all UI elements (buttons, nav, labels) — 400 for body text
9. Spacing follows the product's native-app density: tighter than typical marketing, generous in hero sections
