# Design System Inspired by Aside

> Category: Developer Tools & IDEs
> AI browser agent. Bright product-app marketing, custom display type, soft squircle controls, agent-browser product framing.

## Provenance

This reference is derived from a live capture of `https://aside.com/` on 2026-06-30, plus a reconnaissance pass following `JCodesMore/ai-website-cloner-template` at commit `8dd9cb47dde0d49fec06ee1d69bedd04840f3c95`.

Reviewer-run evidence artifacts for the source capture were written under `.omo/evidence/20260630-aside-frontend-reference/`:

- `aside-live-extraction.json`
- `aside-home.png`
- `cloner-output-summary.md`
- `cloner-desktop-1440.png`
- `cloner-tablet-768.png`
- `cloner-mobile-390.png`

Those `.omo/evidence` files are local review artifacts, not shipped package assets. Downstream agents should recapture the live site when fidelity to the current Aside page matters. This file carries the stable, reviewer-visible digest from that capture.

### Reviewer-Visible Capture Digest

- **Source page:** `https://aside.com/`
- **Source metadata:** title indicated a browser built to do real work; description framed it as a browser that completes complex work across sites, accounts, and history.
- **Template source:** `JCodesMore/ai-website-cloner-template` at commit `8dd9cb47dde0d49fec06ee1d69bedd04840f3c95`; the template was used as a local reconnaissance workflow, not copied into this repo.
- **Screenshots captured:** live page at 1440px wide; reconstructed reconnaissance screenshots at 1440px, 768px, and 390px widths.
- **Page topology:** compact nav, centered hero, sky/cloud hero wash, large browser-product frame, explanatory intro band, capability sections, benchmark tabs, password/security sections, blue closing CTA band, dense footer.
- **Extracted type signals:** `displayFont` for hero and section display; Geist for body/UI; Geist Mono available for technical specimens.
- **Extracted scale signals:** H1 around 48px / 52px with slight negative tracking; body 16px / 24px; UI labels around 14px / 20px.
- **Extracted surface signals:** white page canvas, ink text around `#090b0c`, soft gray controls around `#f5f5f5`, black-opacity dividers, pill trust badge, rounded/squircle CTA buttons, product-frame shadows.
- **Responsive observations:** desktop preserves full nav and large browser frame; tablet narrows the product frame; mobile crops/stacks the frame while keeping the hero and CTA visible.

Do not treat this file as a license to copy Aside's logo, product screenshots, copy, or proprietary assets. Use it as a token and layout reference for original AI-browser, agent-workflow, and product-app surfaces.

## 1. Visual Theme & Atmosphere

Aside's current site reads as a bright, high-confidence product application rather than a dark developer landing page. The canvas is mostly white with hairline black dividers, dense product UI, large custom display headlines, and pale sky-blue atmospheric bands in the hero and final CTA. It feels closer to a native app launch page than a SaaS template: crisp, controlled, and built around the promise that the browser itself can do real work.

The signature move is the contrast between calm white space, a gentle cloud-like blue wash, and dense browser-product framing. The page opens with a centered hero, a small Y Combinator trust pill, and a large browser/app visual. Below that, sections use full-width bands, thin separators, and app-like capability cards instead of decorative feature-card grids. The tone is practical and confident: precise controls, product screenshots, benchmark pills, password/memory/security stories, and compact navigation.

Rounded elements should feel like soft squircles, not generic `rounded-2xl` blobs. Live capture shows very large pill radii for trust badges and hero CTAs, medium squircle radii around compact action buttons, and square rhythm for structural section boundaries. Depth is created by product frames, soft shadows, white/black opacity borders, and layered screenshot surfaces, not by colorful background decoration.

## 2. Color Palette & Roles

### Core Canvas

- **White** (`#ffffff`): primary page background. Use for the main canvas and broad content bands.
- **Ink Black** (`lab(2.93655 -0.435196 -0.608262)`, approximate `#090b0c`): primary text. Use this instead of pure black when possible.
- **Soft Gray Surface** (`lab(96.52 -0.0000298023 0.0000119209)`, approximate `#f5f5f5`): rounded control and panel surface.
- **Hairline Divider** (`rgba(0,0,0,0.06)`): section borders and subtle containment.
- **Muted Text** (`#737373` to `#a1a1a1` range): captions, footer links, secondary product explanations.

### Action Surfaces

- **Primary Button Surface**: light gray or ink-inverted depending on context. Use compact contrast instead of saturated brand color.
- **Primary Button Text**: ink black on light controls; white on dark controls.
- **Hover Surface**: slightly darker neutral fill with 150ms color/background/border transition.
- **Focus Ring**: neutral gray ring. Keep it visible against white and soft gray.

### Accent Use

Aside's live capture does not rely on one dominant neon accent. Accents come from product imagery, benchmark pills, subtle icon color, and carefully placed dark controls. If a project needs a brand color, keep it secondary to the black/white/gray product-app system and apply it only to small signals.

The current page does use pale cyan/sky-blue atmosphere in large image-backed bands. Treat that as an optional Aside signature for AI-browser launches: soft, airy, and product-framing, not a generic blue gradient background.

## 3. Typography Rules

### Font Family

- **Display**: Aside custom display font exposed in capture as `displayFont`, fallback display sans.
- **Body / UI**: Geist, fallback sans.
- **Mono**: Geist Mono for code, benchmark labels, and technical specimens.

### Hierarchy

| Role | Font | Size | Weight | Line Height | Letter Spacing | Use |
|---|---|---:|---:|---:|---:|---|
| Hero Display | displayFont | 48px | 400 | 52px | -0.48px | Primary H1 |
| Section Display | displayFont | 36px-48px | 400-500 | 1.08-1.15 | tight | Major section claims |
| Card Title | displayFont or Geist | 24px-30px | 500 | 1.2 | normal/tight | Product capability cards |
| Body | Geist | 16px | 400 | 24px | normal | General explanation |
| UI Label | Geist | 14px | 500 | 20px | normal | Nav, buttons, menu labels |
| Pill/Caption | Geist | 12px-14px | 500-550 | 1.3 | slight | Badges, metadata, benchmarks |

### Principles

- Use the display font for the claim, not for every word on the page.
- Keep body copy plain, readable, and product-focused.
- Favor medium weights over bold weights; the brand voice is confident but not shouty.
- Avoid negative letter-spacing outside display text. The router's global rule against viewport-scaled font sizing still applies.

## 4. Component Stylings

### Navigation

- Top navigation is compact and product-app-like.
- Logo at left, grouped menu buttons/links in the center, download CTA at right.
- Nav labels use Geist 14px/500 with short 150ms color/background transitions.
- Dropdown triggers can be text buttons with no visible border until hover.
- Mobile should collapse to icon/hamburger controls with the same neutral/squircle treatment.

### Hero Trust Pill

- Pill radius: full pill, visually continuous.
- Border/fill: very subtle neutral contrast against white.
- Text: 12px-14px Geist, medium weight.
- Content: use as a trust or provenance signal, not a decorative chip pile.

### Primary CTA

- Shape: pill for hero CTA, medium squircle for standard nav/action buttons.
- Height: 36px compact nav, 44px hero/mobile.
- Padding: generous horizontal padding for hero; compact in nav.
- Motion: 150ms background/color/border transition; pressed state can scale to 0.97.
- Icon: use SVG icon from the app's icon library; do not use emoji.

### Product Browser Frame

This is the key Aside-inspired primitive.

- Large product/browser mockup below or near the hero claim.
- Use a real screenshot, generated bitmap, or carefully built UI surface. Do not substitute flat rectangles.
- Contain with soft border, rounded/squircle corners, and restrained shadow.
- Internal chrome should show real browser/app affordances: sidebar, tabs, compact controls, content panels.
- The frame can overflow and crop at mobile widths, but the focal content must remain legible.

### Capability Sections

- Full-width horizontal bands separated by `border-b border-black/6` style dividers.
- Section structure: one major claim, one explanatory block, one app-like visual or metric module.
- Avoid three generic feature cards unless the product genuinely has three peer capabilities.
- Link rows and "Learn more" controls stay quiet and text-forward.

### Benchmark Pills / Tabs

- Medium squircle radius around compact tabs.
- Neutral backgrounds with dark text.
- Hover/active states should be visible through fill, border, or text contrast.
- Useful for agent benchmarks, model comparisons, task modes, and product states.

## 5. Layout Principles

### Structure

- Full page uses stacked bands rather than isolated floating cards.
- Hero centers the brand claim and then gives the product visual real space.
- Sections often span full width with internal max-width constraints.
- Footer is link-dense and calm, with grouped columns.

### Spacing

- Outer page padding: 8px mobile, 16px desktop.
- Hero vertical rhythm: generous, but not editorially sparse; the product visual arrives quickly.
- Section padding: 56px-96px depending on density.
- Dense UI inside product frames can use 8px-16px rhythm.

### Responsive Behavior

- Desktop: full nav, large browser/product visual, multi-column footer.
- Tablet: preserve product framing but reduce visual width and section padding.
- Mobile: collapse nav, make hero text more compact, crop or stack the product frame deliberately.
- Avoid horizontal overflow; if a browser mockup is wider than the viewport, scale or crop from a stable container.

## 6. Depth, Motion & Interaction

### Depth

- Use hairline borders and product-frame shadows as the primary elevation language.
- Prefer subtle neutral shadow over colored glows.
- Layer product screenshots or UI panels to create depth.
- Keep broad backgrounds flat white unless a product visual, hero, or closing CTA needs the current Aside-like pale sky-blue atmospheric wash.

### Motion

- Use short transitions for controls: color, background-color, border-color, opacity, transform.
- Keep motion in the 150ms-200ms range with standard cubic-bezier easing.
- Product demos may use scroll or time-based state changes, but document the interaction model in `DESIGN.md` before building.
- Animate transform/opacity/filter only.

### Interaction States

Every primitive must define default, hover, active, focus-visible, disabled, loading, empty, and error states before implementation. Aside-like surfaces are quiet, so missing states are obvious.

## 7. Do's and Don'ts

### Do

- Do use a bright canvas with crisp ink typography for the current Aside-inspired look.
- Do use a custom display face or distinctive display substitute for hero and section claims.
- Do preserve the product-browser frame as the memorable focal object.
- Do use soft squircle or pill corners intentionally by component role.
- Do build dense, useful product UI inside the hero visual.
- Do use thin black-opacity dividers to make sections feel engineered.
- Do keep CTA colors neutral and high contrast.
- Do cite live screenshots or extracted design tokens when claiming Aside fidelity.

### Don't

- Don't resurrect the older dark-only Aside reference without checking the live site.
- Don't copy Aside's logo, text, screenshots, or proprietary product assets.
- Don't replace the product-browser focal object with flat geometric decoration.
- Don't make the page a purple-blue gradient SaaS layout.
- Don't use saturated sky blue as a giant primary CTA color; if using Aside's current atmosphere, keep it pale, cloud-like, and subordinate to the product frame.
- Don't over-round every component equally; distinguish pills, squircles, and structural edges.
- Don't hide visual QA behind tests. Aside-like work needs screenshots at mobile, tablet, and desktop widths.

## Agent Prompt

When building an Aside-inspired surface, first create or update `DESIGN.md` with: bright white product-app atmosphere, display/body/mono font roles, ink/neutral token ramp, squircle/pill component rules, a product-browser focal primitive, dense capability bands, and responsive crop/scale behavior for the product frame. Use original content and assets. Verify with screenshots at 375px, 768px, and 1280px or wider, and compare against the live-reference evidence before declaring visual fidelity.
