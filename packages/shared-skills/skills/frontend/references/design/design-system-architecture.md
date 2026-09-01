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

The file has 8 sections plus a greenfield-only `## 0. Research Log`. Every section is mandatory. Skip nothing.

```markdown
# [Project Name] Design System

## 0. Research Log (greenfield only)

One line per research lane, written before the sections below — a lane with no line did not run:
- Embedded refs: shortlisted [2-3 Layer B candidates] → picked [Layer A] + [Layer B] because [reason]
- Lazyweb: [N] queries, [M] screens viewed → [layout grammar taken]
- Imagen drafts: [paths] → picked [draft] as the reference-fidelity contract
- Skipped lanes: [lane] — [tool/network reason]

## 1. Atmosphere & Identity

One paragraph. What this product FEELS like. Not what it does — how it feels to use.
Name the signature — the one visual idea that makes this product recognizable.

Example: "A quiet command center. Dense when needed, spacious when not.
The signature is muted depth — surfaces separated by subtle tonal shifts
rather than borders, creating layers you feel more than see."

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
- Tokenize design *intent* — spacing steps, content width, gutters, section gaps, density steps. Keep browser *mechanics* raw: `auto`, `%`, `min-content`, `max-content`, `fit-content`, `clamp()`, viewport/container units, intrinsic sizing. A `clamp(1rem, 4vw, 2rem)` gap or a `minmax(min(16rem, 100%), 1fr)` track is mechanics, not a magic number — do not force it into a token.
- Asymmetric spacing is intentional, not accidental — document why.

## 5. Components

Document reusable patterns before implementation for greenfield work, and as they emerge or are extracted for existing work. Format:

### [Component Name]
- **Structure**: HTML/JSX outline
- **Variants**: list
- **Spacing**: which tokens
- **States**: default, hover, active, focus, disabled, loading, empty, error
- **Accessibility**: keyboard, ARIA, contrast
- **Motion**: entry/exit animations
- **Layout**: spatial primitive (stack / cluster / sidebar / grid / shell…) and, if the component scrolls or pins anything, its scroll owner

Greenfield starts with the primitives you are about to build, assembled from
the selected references' component anatomy and adapted to the user's product.
Existing projects start with components used 2+ times or already shared in
code; do not invent future components just to fill the section.

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

## 8. Accessibility Constraints & Accepted Debt

### Constraints
- WCAG target: [e.g. 2.2 AA] — contrast floor [4.5:1 body / 3:1 large text], visible focus on every
  interactive element, full keyboard reachability, `prefers-reduced-motion` respected (Section 6).

### Accepted Debt
| Item | Location | Why accepted | Owner / Exit |
|------|----------|--------------|--------------|
| [debt] | [file/screen] | [reason + user sign-off] | [when it gets fixed] |

New debt is recorded here at the moment it is accepted — never silently.
```

## Creation Workflow

### For New Projects

1. **Select references before taste** — no visual reference means `_INDEX.md` shortlist of 2-3 Layer B candidates, then exactly one Layer A style skill and one Layer B brand/design-system reference. Use `open-design` only when the curated set has no fit.
2. **Assemble from references** — extract tokens, layout grammar, component anatomy, states, motion, and taste decisions, then recombine them into project-specific primitives. Customize for the user's product; never copy logos, trademarked assets, or brand-specific copy.
3. **Define the system** — atmosphere, palette, typography, spacing, and one depth strategy, grounded in the selected references and product semantics. Sanity-check the palette and type pairing with one `ui-ux-db` domain search (CLI in `references/ui-ux-db/README.md`).
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
- [ ] Spacing intent maps to a token (Section 4); browser mechanics (`clamp()`, intrinsic sizing, container units) stay raw. No arbitrary px.
- [ ] Interactive elements have all required states from Section 5 and Section 6.
- [ ] Depth treatment matches the chosen strategy from Section 7.
- [ ] Component reused 2+ times? Documented in Section 5.
- [ ] Motion follows the timing table. No arbitrary durations.
- [ ] Component visual QA passed for each primitive and required state before product screens were composed.
- [ ] Section 8 accessibility constraints hold for the new component; any new debt is recorded in Section 8, not silently accepted.
- [ ] Survives content stress: empty, long label, unbroken string. Reflows to one readable column at 375px with no horizontal scroll of primary content.

## Memory Management

### When to UPDATE DESIGN.md

- New reusable component emerges (used 2+ times) → add to Section 5
- Color added to serve a genuine new semantic role → add to Section 2
- Spacing token insufficient for a real need → add to Section 4
- User explicitly changes direction ("make it warmer", "go brutalist")

### When NOT to Update

- One-off styling for a unique section — use inline override, don't pollute the system
- "I might need this later" — you won't. Add it when you do.
- Temporary experiment — experiments don't get tokens

### Discipline

The design system that grows every week is dying. The one that holds its size or shrinks is getting sharper. Every addition must justify itself by removing ambiguity, not adding options.
