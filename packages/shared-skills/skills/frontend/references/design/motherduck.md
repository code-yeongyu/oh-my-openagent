# Design System Inspired by MotherDuck

> Category: Backend, Database & DevOps
> Serverless DuckDB data warehouse. Warm cream canvas, duck-yellow brand accent, Aeonik Fono display type.

## 1. Visual Theme & Atmosphere

MotherDuck's website radiates an unexpected warmth for a data warehouse product. Where competitors like Snowflake and BigQuery lean into cold, technical blue-gray palettes, MotherDuck opens on a rich cream canvas (`#F4EFEA`) that feels closer to a premium consumer brand than enterprise infrastructure. The warm foundation says "approachable analytics" before a single word is read — a deliberate contrast to the intimidating complexity that data warehouses usually project.

The brand's defining visual element is Duck Yellow (`#FFDE00`) — a bright, saturated gold that references the DuckDB mascot without being cartoonish. It appears sparingly: as a CTA accent, in the logo, and in decorative moments. The restraint is important — yellow is notoriously difficult to use in interfaces without looking cheap, and MotherDuck succeeds by treating it as a highlight rather than a dominant color. The primary interactive color is actually a soft sky blue (`#6FC2FF`), which carries links, secondary CTAs, and data visualization accents.

Typography is built on the Aeonik type family — a contemporary geometric sans-serif that bridges the gap between the warmth of humanist typefaces and the precision of neo-grotesques. Aeonik Fono handles display headlines with a distinctive mono-width quality that nods to the product's technical nature, while Inter serves as the body workhorse. Aeonik Mono completes the stack for code surfaces and SQL examples, which are central to the product experience.

The overall design philosophy is "the answers company" — every layout decision prioritizes clarity and directness. Hero sections lead with bold claims ("Infrastructure for Answers"), feature grids use generous whitespace, and the color palette keeps saturated hues in supporting roles so the content hierarchy is never ambiguous. Dark text on warm cream creates a reading experience that's comfortable for the long-form technical content (case studies, documentation links, integration lists) that fills the lower sections.

**Key Characteristics:**
- Warm cream canvas (`#F4EFEA`) evoking paper-like comfort, not cold tech surfaces
- Duck Yellow (`#FFDE00`) as a brand signature used with extreme restraint
- Sky blue (`#6FC2FF`) as the primary interactive and link color
- Aeonik type family: Fono for display, Mono for code, Inter for body
- Dark warm gray (`#383838`) for primary text — not black, not cool gray
- Multi-color accent palette (orange, teal, pink, purple) for data visualization and feature differentiation
- Generous whitespace with content-first hierarchy
- Light-mode-only marketing site — no dark mode toggle
- Next.js with Tailwind CSS, image-heavy product showcases

## 2. Color Palette & Roles

### Primary
- **Warm Dark Gray** (`#383838`): Primary heading and body text color. The dominant color on the page (175 occurrences in the HTML). A warm neutral that avoids the heaviness of black while maintaining strong readability on cream.
- **Duck Yellow** (`#FFDE00`): The brand signature — a bright, pure yellow-gold. Used for primary CTAs, logo accent, and decorative brand moments. Applied sparingly to maintain impact.
- **Sky Blue** (`#6FC2FF`): Primary interactive color — links, secondary buttons, hover states, and data visualization primary. A soft, friendly blue that complements the warm palette.

### Secondary & Accent
- **Warm Orange** (`#FF9538`): Secondary accent for feature cards, icons, and warm decorative elements. Also used at reduced opacity (`#FF9538AA`) for subtle backgrounds.
- **Teal Mint** (`#53DBC9`): Tertiary accent — success states, integration highlights, and decorative balance against the warm tones.
- **Blue Accent** (`#2BA5FF`): A deeper, more saturated blue for interactive emphasis and link hover states.
- **Light Sky** (`#97D4FF`): A pale sky blue for tinted surfaces and light decorative accents.
- **Deep Blue** (`#0092D7`): A rich cerulean for high-contrast interactive elements and CTAs on dark surfaces.

### Decorative (Multi-Color System)
- **Pink** (`#FF92C3`): Decorative accent for illustrations and feature differentiation.
- **Coral Red** (`#FF7169`): Warm red accent for visual variety in multi-color compositions.
- **Deep Orange** (`#FF7800`): A more saturated orange variant for emphasis.
- **Purple** (`#9F78DF`): Cool accent for data visualization and category differentiation.
- **Cyan** (`#63C2EE`): A light cyan for subtle visual variety.
- **Royal Blue** (`#0019D2`): Deep blue for dark-surface emphasis moments.

### Surface & Background
- **Cream Canvas** (`#F4EFEA`): Primary page background. A warm cream with subtle pink-beige undertone — the emotional foundation of the design.
- **Off White** (`#F8F8F7`): Secondary surface — cards, elevated containers. Barely cooler than the canvas.
- **Pure White** (`#FFFFFF`): Card surfaces, input backgrounds, maximum contrast elements. Also used at high opacity (`#FFFFFFEE`) for translucent overlays.
- **White** (`#fff`): Standard white for contained elements.

### Neutrals & Text
- **Primary Text** (`#383838`): All headings and primary body text.
- **Body Gray** (`#666666`): Secondary body text, descriptions, metadata.
- **Muted Gray** (`#818181`): Tertiary text, placeholders, de-emphasized content.
- **Gray** (`#9ca3af`): Tailwind gray-400, used for border and disabled states.
- **Black** (`#000000`): Used sparingly for maximum-contrast elements like the logo and specific icons.
- **Border Subtle** (`#38383815`): Primary text color at ~8% opacity — creates ultra-light borders that separate without drawing attention.

### Semantic
- **Error Red** (`#D90000`): Error states and destructive actions.
- **Success Green** (`#187108`): Success indicators and positive states.
- **Warning Brown** (`#66370D`): Warning states — a warm brown rather than typical amber, consistent with the warm palette.

## 3. Typography Rules

### Font Family
- **Display**: `Aeonik Fono`, fallback: `Segoe UI`, sans-serif. A geometric sans with mono-width characteristics that give headlines a technical, engineered feel.
- **Body / UI**: `Inter`, fallback: `system-ui`, sans-serif. The modern web standard for readable body text.
- **Monospace**: `Aeonik Mono`, fallback: `monospace`. Brand-consistent code font for SQL examples and technical content.
- **System fallback**: `ui-sans-serif, system-ui, sans-serif, Apple Color Emoji, Segoe UI Emoji, Segoe UI Symbol, Noto Color Emoji`

### Hierarchy

| Role | Font | Size | Weight | Line Height | Letter Spacing | Notes |
|------|------|------|--------|-------------|----------------|-------|
| Display Hero | Aeonik Fono | 56px (3.5rem) | 500–600 | 1.05 (tight) | -0.02em | Maximum impact, hero headlines |
| Display Large | Aeonik Fono | 48px (3rem) | 500 | 1.10 (tight) | -0.015em | Secondary hero, section openers |
| Section Heading | Aeonik Fono | 36px (2.25rem) | 500 | 1.15 | -0.01em | Feature section titles |
| Sub-heading Large | Aeonik Fono | 28px (1.75rem) | 500 | 1.20 | -0.005em | Card titles, sub-sections |
| Sub-heading | Inter | 22px (1.375rem) | 600 | 1.25 | normal | Small section heads |
| Body Large | Inter | 18px (1.125rem) | 400 | 1.60 | normal | Intro text, hero subtitles, feature descriptions |
| Body | Inter | 16px (1rem) | 400 | 1.60 | normal | Standard body text |
| Body Small | Inter | 14px (0.875rem) | 400–500 | 1.50 | normal | Compact content, navigation |
| Button | Inter | 14px (0.875rem) | 500–600 | 1.00 | normal | CTA buttons |
| Button Large | Inter | 16px (1rem) | 500–600 | 1.00 | 0.01em | Hero CTAs |
| Label | Inter | 12px (0.75rem) | 600 | 1.33 | 0.05em | Uppercase nav labels ("PRODUCT", "COMMUNITY") |
| Code | Aeonik Mono | 14px (0.875rem) | 400 | 1.60 | normal | SQL examples, inline code |
| Code Small | Aeonik Mono | 13px (0.8125rem) | 400 | 1.50 | normal | Compact code blocks |

### Principles
- **Aeonik Fono is display-only**: Its mono-width characteristics work at large sizes where the geometric precision reads as intentional, but would feel awkward at body sizes. 28px is the practical floor.
- **Inter for everything functional**: Body text, buttons, navigation, labels — all Inter. The font is so ubiquitous that it disappears, letting the content and the Aeonik display headlines carry the personality.
- **Uppercase navigation labels**: Navigation categories ("PRODUCT", "COMMUNITY", "COMPANY") use uppercase Inter at 12px with 600 weight and 0.05em tracking — a structural label pattern that signals hierarchy without serif.
- **Generous body line-height**: 1.60 for body text creates a relaxed reading rhythm suited to the technical-but-approachable brand voice.
- **Negative tracking at display sizes**: Aeonik Fono tightens progressively from -0.005em at 28px to -0.02em at 56px, creating dense headline blocks.

## 4. Component Stylings

### Buttons

**Primary Yellow**
- Background: Duck Yellow (`#FFDE00`)
- Text: Dark (`#383838` or `#000000`)
- Padding: 12px 24px
- Radius: 8px
- Font: Inter 14–16px weight 600
- Hover: slightly darkened yellow
- Use: Primary CTA ("Try 7 Days Free", "START FREE")

**Blue Outline / Secondary**
- Background: transparent
- Text: Sky Blue (`#6FC2FF`) or Deep Blue (`#0092D7`)
- Border: `1px solid` current color
- Padding: 12px 24px
- Radius: 8px
- Hover: light blue tinted background
- Use: Secondary actions ("Learn more", "See pricing")

**White Surface**
- Background: White (`#ffffff`)
- Text: Warm Dark Gray (`#383838`)
- Padding: 12px 24px
- Radius: 8px
- Border: `1px solid #38383815` (subtle warm border)
- Hover: light warm gray background
- Use: Tertiary actions, alternative CTAs

**Dark / Nav CTA**
- Background: Dark (`#383838`)
- Text: White (`#ffffff`)
- Padding: 8px 16px
- Radius: 6px
- Font: Inter 14px weight 600
- Use: Navigation CTAs ("LOG IN", "CONTACT US")

### Cards & Containers
- Background: White (`#ffffff`) or Off White (`#F8F8F7`)
- Border: `1px solid #38383815` (ultra-subtle warm border) or no border with shadow
- Radius: 8px standard, 12px featured, 16px hero
- Shadow: `0 1px 3px 0 rgba(0,0,0,0.1), 0 1px 2px -1px rgba(0,0,0,0.1)` for elevated cards
- Internal padding: 24–32px
- Use: Feature cards, case study cards, integration grids

### Inputs & Forms
- Background: White (`#ffffff`)
- Border: `1px solid #9ca3af` (gray-400)
- Radius: 6px
- Focus: `ring-blue-500` / `rgba(59,130,246,0.5)` focus ring
- Text: `#383838`
- Placeholder: `#818181`

### Navigation
- Sticky top navigation with cream/white background
- Logo: MotherDuck duck mark + wordmark
- Eyebrow banner: full-width announcements above nav (e.g., hackathon, livestream)
- Primary nav: dropdown mega-menus ("PRODUCT", "COMMUNITY", "COMPANY")
- Labels: uppercase Inter 12px weight 600, tracking 0.05em
- Link text: `#383838` with hover highlight
- CTA buttons: "LOG IN" (outline) and "START FREE" (filled) right-aligned
- Mobile: hamburger menu

### Distinctive Components

**Hero Section**
- Aeonik Fono headline centered on cream canvas
- Subtitle in Inter 18px body gray
- Dual CTA: Yellow primary + secondary outline
- Product screenshot or illustration below

**Integration Grid**
- Multi-column grid of partner logos/icons
- Clean white cards with subtle borders
- Category sections (Data Integration, BI, AI, etc.)

**Case Study Cards**
- Customer logo + quote + metrics
- Multi-color accent system (each case study gets a color: orange, teal, blue, purple)
- Clean typography with bold metric numbers

**SQL Code Blocks**
- Aeonik Mono on dark or light surface
- Syntax highlighting with the multi-color accent palette
- Generous padding and rounded corners

## 5. Layout Principles

### Spacing System
- Base unit: 4px (Tailwind default)
- Common values: 8px, 12px, 16px, 24px, 32px, 48px, 64px, 96px
- Section vertical spacing: 80–120px between major sections
- Card internal padding: 24–32px
- Button padding: 12px 24px (standard), 8px 16px (compact)

### Grid & Container
- Max content width: approximately 1200px, centered
- Hero: centered single-column with generous margins
- Feature sections: 2–3 column grids (CSS Grid or Flexbox)
- Integration grids: up to 4–6 columns for logo grids
- Full-width accent sections occasionally break the container for visual drama

### Whitespace Philosophy
- **Cream breathing room**: The warm canvas creates a perception of more whitespace than actually exists — the color is so comfortable that even moderate spacing feels generous.
- **Content-first hierarchy**: Headlines are bold and large (56px hero), but surrounded by so much whitespace that they never feel aggressive. The layout prioritizes scanability over density.
- **Progressive density**: Hero sections are spacious, feature grids are moderately dense, integration lists and footer are tighter. This creates a natural reading rhythm that moves from inspiration to information.

### Border Radius Scale
- Compact (4px): Small inline elements, badges
- Standard (6px): Inputs, compact buttons, small cards
- Comfortable (8px): Standard buttons, primary cards, containers
- Generous (12px): Featured cards, product screenshots
- Large (16px): Hero containers, large media elements
- Full (9999px): Pill badges, rounded avatar containers

## 6. Depth & Elevation

| Level | Treatment | Use |
|-------|-----------|-----|
| Flat (Level 0) | No shadow, cream canvas | Page background, inline content |
| Subtle (Level 1) | `1px solid #38383815` (8% opacity border) | Standard cards, section containers |
| Elevated (Level 2) | `0 1px 3px rgba(0,0,0,0.1), 0 1px 2px -1px rgba(0,0,0,0.1)` | Interactive cards, hover states |
| Featured (Level 3) | Larger shadow + border combination | Product showcases, hero elements |
| Color accent | Multi-color backgrounds (orange, teal, blue, purple) at low opacity | Feature differentiation, case study cards |

**Shadow Philosophy**: MotherDuck uses **minimal shadows with maximum border subtlety**. The primary depth mechanism is the ultra-light border at 8% opacity (`#38383815`) — barely visible on the cream canvas but enough to create containment. When shadows do appear, they're the standard Tailwind `shadow-sm` — functional, not decorative. The real depth in the design comes from the **multi-color accent system**: different sections and features are differentiated by color (orange for one product, teal for another, blue for a third), creating visual layers through hue rather than elevation.

## 7. Do's and Don'ts

### Do
- Use the warm cream canvas (`#F4EFEA`) as the primary background — the warmth IS the brand differentiation
- Use Duck Yellow (`#FFDE00`) only for primary CTAs and logo — scarcity creates impact
- Use `#383838` for all heading text — warm dark gray, never pure black
- Apply the multi-color accent system (orange, teal, blue, purple, pink) for feature and data visualization differentiation
- Use Aeonik Fono for display headlines (28px+) with negative letter-spacing
- Use Inter for all body text and UI elements — reliability over personality at small sizes
- Keep uppercase navigation labels at 12px/600/0.05em tracking
- Apply ultra-light borders (`#38383815`) for card containment
- Maintain generous section spacing (80–120px) for the breathing, approachable feel

### Don't
- Don't use Duck Yellow for body text, borders, or backgrounds — it's strictly a CTA/logo accent
- Don't use pure black (`#000000`) for body text — always `#383838`
- Don't use cool blue-grays for neutrals — the palette is exclusively warm-toned
- Don't use Aeonik Fono below 28px — it loses its display character at body sizes
- Don't apply heavy drop shadows — the design relies on borders and color, not elevation
- Don't introduce a dark mode — the cream canvas is the core brand experience
- Don't use saturated accent colors at full opacity for large surfaces — they're highlights, not backgrounds
- Don't skip the eyebrow banner space — it's part of the nav structure even when empty
- Don't use the multi-color accents randomly — each product/feature should have a consistent assigned color

## 8. Responsive Behavior

### Breakpoints
| Name | Width | Key Changes |
|------|-------|-------------|
| Mobile | <640px | Single column, hamburger nav, reduced heading sizes, stacked CTAs |
| Tablet | 640–1024px | 2-column feature grids, condensed nav |
| Desktop | 1024–1280px | Full layout, mega-menu navigation, 3-column grids |
| Large Desktop | >1280px | Centered content with generous side margins |

### Touch Targets
- Buttons: 44px minimum height for mobile CTAs
- Navigation: adequately spaced dropdown triggers
- Cards: full-surface touch targets on mobile
- Integration logos: minimum 48px tap area

### Collapsing Strategy
- **Navigation**: Mega-menu dropdowns → hamburger with accordion sections
- **Hero**: 56px headline → 36px on mobile, dual CTAs stack vertically
- **Feature grids**: 3-column → 2-column → single column stacked
- **Integration grids**: 4–6 columns → 3 columns → 2 columns
- **Case study cards**: Horizontal → vertical stack
- **Section spacing**: 96px+ → 64px → 48px on mobile
- **Typography scale compresses**: 56px → 36px → 28px hero across breakpoints

### Image Behavior
- Product screenshots scale proportionally with maintained aspect ratio
- Partner/integration logos maintain consistent sizing in grid
- Illustrations scale with container width
- Background decorative elements may be hidden on mobile

## 9. Agent Prompt Guide

### Quick Color Reference
- Page Background: Cream Canvas (`#F4EFEA`)
- Card Surface: White (`#FFFFFF`) or Off White (`#F8F8F7`)
- Primary Text: Warm Dark Gray (`#383838`)
- Secondary Text: Body Gray (`#666666`)
- Muted Text: Gray (`#818181`)
- Primary CTA: Duck Yellow (`#FFDE00`) bg, Dark text
- Link / Interactive: Sky Blue (`#6FC2FF`)
- Border: Subtle (`#38383815` — 8% dark opacity)
- Accent Orange: (`#FF9538`)
- Accent Teal: (`#53DBC9`)
- Accent Blue: (`#2BA5FF`)
- Error: Red (`#D90000`)
- Success: Green (`#187108`)

### Example Component Prompts
- "Create a hero section on cream (#F4EFEA) canvas. Headline in Aeonik Fono at 56px weight 500, line-height 1.05, letter-spacing -0.02em, color #383838. Subtitle in Inter 18px weight 400, #666666, line-height 1.60. Yellow CTA (#FFDE00, #383838 text, 8px radius, 12px 24px padding) and blue outline secondary (transparent bg, #6FC2FF text/border, 8px radius)."
- "Design a feature card on white with 1px solid rgba(56,56,56,0.08) border, 12px radius. Title in Aeonik Fono 28px weight 500, letter-spacing -0.005em, #383838. Body in Inter 16px weight 400, #666666, line-height 1.60. Orange (#FF9538) accent icon at 24px."
- "Build a navigation bar: cream (#F4EFEA) background, sticky. Eyebrow banner full-width above nav. Duck logo left. Uppercase labels 'PRODUCT', 'COMMUNITY' in Inter 12px weight 600, tracking 0.05em, #383838. CTAs right: 'LOG IN' (#383838 outline) and 'START FREE' (#FFDE00 bg, dark text)."
- "Create an integration grid on off-white (#F8F8F7): 4-column grid of partner cards (white bg, subtle border, 8px radius). Each card: 48px logo + partner name in Inter 14px weight 500. Category headers in Inter 12px weight 600 uppercase."
- "Design a case study card: white surface, 12px radius, subtle border. Customer logo top, quote in Inter 18px italic #383838, metric number in Aeonik Fono 36px weight 600 with teal (#53DBC9) accent color. CTA link in Sky Blue (#6FC2FF)."

### Iteration Guide
1. Canvas is ALWAYS warm cream (`#F4EFEA`) — never white, never cool gray
2. Primary text is `#383838` — warm dark gray, not black
3. Duck Yellow (`#FFDE00`) is CTA-only — if you're using it on anything other than a button or the logo, stop
4. Sky Blue (`#6FC2FF`) is the everyday interactive color — links, secondary CTAs, hover states
5. Borders use 8% opacity of the primary text color (`#38383815`) — ultra-subtle containment
6. Aeonik Fono at 28px+ only, with progressively tighter tracking at larger sizes
7. Inter handles everything else at 400 weight (body) or 500–600 (UI/buttons)
8. The multi-color accent system (orange, teal, blue, purple, pink) differentiates features — assign one per category
9. Shadows are minimal — most depth comes from borders and color differentiation
10. Uppercase labels at 12px/600/0.05em for navigation categories and section markers
