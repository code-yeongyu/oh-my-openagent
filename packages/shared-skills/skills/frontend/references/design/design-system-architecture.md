---
name: design-system-architecture
description: "Mandatory reference for the Design System Gate. Defines DESIGN.md structure, creation workflow, validation rules, and memory management. Loaded automatically when the agent needs to create or update a project's design system."
---

# Design System Architecture

Every frontend project MUST have a `DESIGN.md` at its root. This file is the single source of truth for all visual decisions. No component is written without reading it first.

## When to Create

- **New project**: If the user gave no concrete visual reference, select one Layer A style skill and one Layer B brand/design-system reference first. Treat them as source material for tokens, layout, component anatomy, states, motion, and taste; customize for the user's product without freestyling past the selected references. Then create `DESIGN.md` before UI, with Section 5 primitives and states defined before implementation.
- **Existing project without one, but with implicit patterns/components**: Extract the design system from existing code before continuing work.
- **Existing project without one and without a reusable component layer**: Ask whether to preserve the current look with copy-nearby styling or extract a `DESIGN.md` plus reusable components first. Do not silently choose.
- **Existing project with one**: Read it. Follow it. Update it only when a genuinely new pattern emerges.

## DESIGN.md Structure

The file has 7 sections. Every section is mandatory. Skip nothing.

```markdown
# [Project Name] Design System

## 1. Atmosphere & Identity

One paragraph. What this product FEELS like. Not what it does — how it feels to use.
Name the signature — the one visual idea that makes this product recognizable.

Example: "A quiet command center. Dense when needed, spacious when not.
The signature is muted depth — surfaces separated by subtle tonal shifts
rather than borders, creating layers you feel more than see."

### Aesthetic Intent Brief

Every non-trivial visual surface must turn user intent into observable design targets before component budgeting starts.

| Field | Required answer | Why it matters |
| --- | --- | --- |
| Surface intent | `operational`, `commercial`, `campaign`, or `translation` | Sets how strictly reusable-component governance applies. |
| Target emotion | 2-3 words such as calm authority, kinetic urgency, luxurious trust | Prevents generic "nice UI" decisions. |
| Signature visual idea | One memorable visual metaphor or spatial system | Creates a recognizable design instead of interchangeable AI output. |
| Attention path | First 3 seconds: what the eye sees first, second, and third | Makes hierarchy measurable during QA. |
| Motion role | none, state feedback, spatial orientation, storytelling, or spectacle | Distinguishes useful motion from decoration. |
| Bespoke visual layer | Custom 3D, illustration, shader-like background, scroll scene, kinetic type, or none | Names what may intentionally sit outside reusable component budgets. |
| Reusable primitive boundary | Which controls, cards, forms, icons, nav, and data displays still follow Section 5 | Keeps expressive surfaces from becoming unmanaged component drift. |

Operational surfaces optimize clarity, speed, and consistency. Commercial surfaces balance conversion and reuse. Campaign surfaces optimize emotion and memorability first, then reuse only the interaction primitives. Translation surfaces start expressive, then collapse repeated controls back into the system.

## 2. Color

### Palette

| Role | Token | Light | Dark | Usage |
|------|-------|-------|------|-------|
| Surface/primary | --surface-primary | #FFFFFF | #0A0A0A | Main background |
| Surface/secondary | --surface-secondary | #F8F8F8 | #141414 | Cards, panels |
| Surface/elevated | --surface-elevated | #FFFFFF | #1A1A1A | Modals, popovers |
| Text/primary | --text-primary | #0A0A0A | #FAFAFA | Headlines, body |
| Text/secondary | --text-secondary | #6B6B6B | #A0A0A0 | Captions, hints |
| Text/tertiary | --text-tertiary | #9B9B9B | #666666 | Disabled, muted |
| Border/default | --border-default | #E5E5E5 | #2A2A2A | Dividers, outlines |
| Border/subtle | --border-subtle | #F0F0F0 | #1E1E1E | Soft separations |
| Accent/primary | --accent-primary | #2563EB | #3B82F6 | CTAs, links, focus |
| Accent/hover | --accent-hover | #1D4ED8 | #60A5FA | Hover state |
| Status/success | --status-success | #16A34A | #22C55E | Confirmations |
| Status/warning | --status-warning | #D97706 | #F59E0B | Cautions |
| Status/error | --status-error | #DC2626 | #EF4444 | Errors, destructive |
| Status/info | --status-info | #2563EB | #3B82F6 | Informational |

### Rules
- Surface hierarchy creates depth without shadows or borders where possible.
- Accent is used ONLY for interactive elements. Never decorative.
- Never introduce a color not in this table. Extend the table first.

## 3. Typography

### Scale

| Level | Size | Weight | Line Height | Tracking | Usage |
|-------|------|--------|-------------|----------|-------|
| Display | 48px / 3rem | 700 | 1.1 | -0.02em | Hero, page title |
| H1 | 36px / 2.25rem | 700 | 1.2 | -0.015em | Section headers |
| H2 | 28px / 1.75rem | 600 | 1.3 | -0.01em | Subsection headers |
| H3 | 22px / 1.375rem | 600 | 1.4 | 0 | Card titles |
| Body/lg | 18px / 1.125rem | 400 | 1.6 | 0 | Lead paragraphs |
| Body | 16px / 1rem | 400 | 1.6 | 0 | Default text |
| Body/sm | 14px / 0.875rem | 400 | 1.5 | 0 | Secondary info |
| Caption | 12px / 0.75rem | 500 | 1.4 | 0.02em | Labels, metadata |
| Overline | 11px / 0.6875rem | 600 | 1.3 | 0.08em | Section labels, uppercase |

### Font Stack
- Primary: [specify — e.g. "Inter, system-ui, -apple-system, sans-serif"]
- Mono: [specify — e.g. "JetBrains Mono, Fira Code, monospace"]
- Serif (if used): [specify]

### Rules
- Max 2 font families per project. 3 only with explicit justification.
- Body text never below 14px.
- Headings that wrap to 4+ lines are too large — use clamp().

## 4. Spacing & Layout

### Base Unit
All spacing derives from a base of **4px**.

| Token | Value | Usage |
|-------|-------|-------|
| --space-1 | 4px | Tight: icon-to-label |
| --space-2 | 8px | Compact: list items, inline groups |
| --space-3 | 12px | Default: form field padding |
| --space-4 | 16px | Standard: card padding, input height context |
| --space-5 | 20px | Comfortable: section inner spacing |
| --space-6 | 24px | Generous: card padding (default) |
| --space-8 | 32px | Separated: between card groups |
| --space-10 | 40px | Sections within a page |
| --space-12 | 48px | Major section breaks |
| --space-16 | 64px | Page-level vertical rhythm |
| --space-20 | 80px | Hero spacing |
| --space-24 | 96px | Maximum section separation |

### Grid
- Max content width: [specify — e.g. 1280px]
- Column system: [specify — e.g. "12-column, 24px gutter, 16px margin at mobile"]
- Breakpoints: sm 640px, md 768px, lg 1024px, xl 1280px, 2xl 1536px

### Rules
- No magic numbers. Every spacing value maps to a token.
- Asymmetric spacing is intentional, not accidental — document why.

## 5. Components

Document reusable patterns before implementation for greenfield work, and as they emerge or are extracted for existing work. Format:

### [Component Name]
- **Budget area**: component reuse budget row this belongs to
- **Structure**: HTML/JSX outline
- **Variants**: list and count
- **Allowed variants**: named variants that can be reused
- **Variant count**: current count against the variant budget
- **Spacing**: which tokens
- **States**: default, hover, active, focus, disabled, loading, empty, error
- **Accessibility**: keyboard, ARIA, contrast
- **Motion**: entry/exit animations
- **Reuse rule**: when to reuse this component instead of creating another

Greenfield starts with the primitives you are about to build, assembled from
the selected references' component anatomy and adapted to the user's product.
Existing projects start with components used 2+ times or already shared in
code; do not invent future components just to fill the section.

### Reuse Budget

The Component reuse budget is part of Section 5, not a separate control file. Use it to prevent uncontrolled design-system growth before code is written. Numbers below are conservative agent-governance defaults: some are backed by published design-system limits, while reuse percentages and per-PR growth caps are pragmatic local controls.

Treat these rows as governance defaults, not literal naming mandates. When a project `DESIGN.md` already names variants such as `panel`, `metric`, or `alert`, those project-local names are authoritative; compare count, behavior, and semantic fit instead of replacing them with the example names below.

Bespoke visual layers declared in Section 1 are not automatically reusable components. A scroll-linked 3D object, hero-only shader, campaign illustration, or kinetic typography treatment stays outside this budget unless it repeats across surfaces, becomes interactive UI, or needs product-state variants.

| Area | Budget | Current | Owner section | Rule |
| --- | ---: | ---: | --- | --- |
| Component reuse budget | 80% semantic/behavior match requires reuse | 0 | Section 5 | Reuse existing primitives when they cover at least 80% of the need; create only for a semantic or behavioral gap. |
| Variant budget | 3 visual variants per component family by default | 0 | Section 5 | A fourth variant requires a documented product need and budget update. |
| Token budget | 3 repeated uses or a documented semantic role before adding a token; review PRs adding 12+ semantic tokens | 0 | Sections 2/3/4/7 | Prefer existing color, type, spacing, radius, shadow, and motion tokens. |
| Color budget | 5 brand/accent families plus neutrals, 6 state families, 26 semantic role aliases maximum without explicit justification | 0 | Section 2 | Add semantic roles, not one-off hex values. |
| Icon budget | 1 primary icon family; size slots 16, 20, 24, 32; max 2 icon sizes per component | 0 | Section 5 | Custom icons require a documented library gap; do not model different glyphs as variants. |
| Button budget | 5 intents, 3 sizes, 3 buttons per action group | 0 | Section 5 | Intents: primary, secondary/default, tertiary/ghost/link, danger/destructive, inverse/special-background. |
| Form budget | 2 columns desktop, 1 mobile; 8 field primitive groups; validation states default/error/success | 0 | Section 5 | Reuse field, label, hint, help, and validation patterns before custom form UI; new input types inside the same field shell do not require a new primitive unless they introduce distinct composite behavior such as a calendar popover or date-range picker. |
| Card budget | 3 card variants | 0 | Section 5 | Elevated, filled, outlined; cards represent one subject and nested cards need justification. |
| Layout budget | 5 shared breakpoints | 0 | Section 4 | Use shared mobile/tablet/desktop/wide regimes instead of page-specific breakpoints. |
| Spacing budget | 2/4/8-derived scale; max 8 component-local values and 12 global steps unless justified | 0 | Section 4 | No ad-hoc px values when a token exists. |
| Radius budget | 3 radius values | 0 | Section 7 | Small/default/full or documented equivalents. |
| Shadow budget | 3 elevation levels | 0 | Section 7 | Must match the chosen depth strategy. |

### reviewer checklist

- [ ] Component reuse budget checked before creating a new component.
- [ ] Variant budget checked before adding another visual or structural variant.
- [ ] Token budget checked before adding color, spacing, radius, shadow, typography, or motion tokens.
- [ ] Icon budget checked before adding a custom SVG or second icon family.
- [ ] Button budget checked before adding a fourth style, fourth size, or crowded action group.
- [ ] Form budget checked before creating custom field, validation, or layout patterns.
- [ ] Card budget checked before adding new card shells or nested cards.
- [ ] Pragmatic thresholds are described as local governance defaults, not universal industry standards.

## 6. Motion & Interaction

### Timing

| Type | Duration | Easing | Usage |
|------|----------|--------|-------|
| Micro | 100-150ms | ease-out | Button press, toggle |
| Standard | 200-300ms | ease-in-out | Panel open, tab switch |
| Emphasis | 400-600ms | cubic-bezier(0.16, 1, 0.3, 1) | Page transition, hero entry |
| Scroll-driven | tied to scroll | linear | Parallax, progress, reveal |

### Rules
- Only animate `transform` and `opacity`. Never animate layout properties.
- Every interactive element has hover + active + focus states.
- Scroll-triggered animations use `IntersectionObserver`, not scroll listeners.
- Reduced motion: respect `prefers-reduced-motion` — disable non-essential animation.
- Motion must match the Section 1 motion role. State feedback stays subtle; spatial orientation may guide navigation; storytelling and spectacle are reserved for commercial, campaign, and translation surfaces.
- 3D, parallax, scroll-linked, or shader-like effects need a fallback that preserves content, hierarchy, and interaction when motion is reduced or unsupported.

## 7. Depth & Surface

### Strategy
Choose ONE and commit: [borders-only | shadows | tonal-shift | mixed]

If shadows:
| Level | Value | Usage |
|-------|-------|-------|
| Subtle | 0 1px 2px rgba(0,0,0,0.04) | Cards at rest |
| Default | 0 2px 8px rgba(0,0,0,0.08) | Elevated cards, dropdowns |
| Prominent | 0 8px 24px rgba(0,0,0,0.12) | Modals, popovers |

If borders:
| Type | Value | Usage |
|------|-------|-------|
| Default | 1px solid var(--border-default) | Cards, dividers |
| Subtle | 1px solid var(--border-subtle) | Soft separations |

If tonal-shift:
Surfaces use progressively lighter/darker shades. No borders, no shadows.
```

## Creation Workflow

### For New Projects

1. **Select references before taste** — no visual reference means `_INDEX.md` shortlist of 2-3 Layer B candidates, then exactly one Layer A style skill and one Layer B brand/design-system reference. Use `open-design` only when the curated set has no fit.
2. **Assemble from references** — extract tokens, layout grammar, component anatomy, states, motion, and taste decisions, then recombine them into project-specific primitives. Customize for the user's product; never copy logos, trademarked assets, or brand-specific copy.
3. **Define the system** — atmosphere, palette, typography, spacing, and one depth strategy, grounded in the selected references and product semantics.
4. **Document initial primitives** — only components you are about to build, including variants and states.
5. **Write it to `DESIGN.md`** at project root.
6. **Build a primitive showcase first** — exercise each primitive's default, hover, active, focus, disabled, loading, empty, and error states at mobile/tablet/desktop widths before composing product screens.

### For Existing Projects (Extraction)

1. **Read all CSS/styling files** — find the actual tokens in use.
2. **Identify the implicit system** — what colors, fonts, spacing values, components, and states repeat?
3. **If no reusable component layer exists**, ask whether to preserve the current look with copy-nearby edits or extract reusable components first.
4. **Codify it** — write the `DESIGN.md` reflecting what EXISTS, not what you wish existed.
5. **Flag inconsistencies** — note where the code deviates from its own patterns.
6. **Propose consolidation** — but do not apply it until approved.

## Validation Rules

After every component implementation, check:

- [ ] All colors reference tokens from Section 2. No raw hex outside `DESIGN.md`.
- [ ] All font sizes match Section 3 scale. No arbitrary sizes.
- [ ] All spacing values are multiples of `--space-1` (4px). No magic numbers.
- [ ] Interactive elements have all required states from Section 5 and Section 6.
- [ ] Depth treatment matches the chosen strategy from Section 7.
- [ ] Component reused 2+ times? Documented in Section 5.
- [ ] Component reuse budget, Variant budget, Token budget, Icon budget, Button budget, Form budget, and Card budget checked before adding new primitives.
- [ ] No second icon family, fourth button variant, fourth card variant, new semantic color, new radius, new shadow, or new spacing step without a documented Section 5 budget update.
- [ ] Motion follows the timing table. No arbitrary durations.
- [ ] Component visual QA passed for each primitive and required state before product screens were composed.
- [ ] Section 1 aesthetic intent is visible: target emotion, signature visual idea, attention path, motion role, bespoke visual layer, and reusable primitive boundary all match the implementation.

## Memory Management

### When to UPDATE DESIGN.md

- New reusable component emerges (used 2+ times) → add to Section 5
- Budget expansion is required by a real product need → update Section 5 with the new number, rationale, and whether the number is externally supported or a pragmatic local default
- Color added to serve a genuine new semantic role → add to Section 2
- Spacing token insufficient for a real need → add to Section 4
- User explicitly changes direction ("make it warmer", "go brutalist")

### When NOT to Update

- One-off styling for a unique section — use inline override, don't pollute the system
- "I might need this later" — you won't. Add it when you do.
- Temporary experiment — experiments don't get tokens

### Discipline

The design system that grows every week is dying. The one that holds its size or shrinks is getting sharper. Every addition must justify itself by removing ambiguity, not adding options. Budgets should hold steady or shrink through consolidation; expanding them is a design decision that requires evidence, not a convenience for one screen.
