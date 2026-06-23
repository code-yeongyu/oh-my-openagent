---
name: adaptive-interfaces
description: Use when designing for user preferences — motion sensitivity, contrast needs, colour schemes, text sizing, information density, or any interface behaviour that should adapt to individual needs
---

# Adaptive Interfaces

Good design does not force everyone through the same experience. It adapts. This skill ensures interfaces respect user preferences, system settings, and individual needs — not as optional extras, but as fundamental design requirements.

## When to Use

- Designing themes (dark mode, high contrast, custom colour schemes)
- Implementing motion or animation
- Building flexible typography or layout systems
- Designing for varying information density needs
- Any time the interface could benefit from adapting to the user

## Process

### Step 1: Identify Adaptable Properties

Review the design and map what should adapt:

| Property | User Preference | CSS/System Signal |
|----------|----------------|------------------|
| Colour scheme | Light/dark/custom | `prefers-color-scheme` |
| Contrast | Standard/high | `prefers-contrast` |
| Motion | Full/reduced/none | `prefers-reduced-motion` |
| Text size | System font size settings | `rem`/`em` units, viewport scaling |
| Information density | Compact/comfortable/spacious | User setting or breakpoint |
| Transparency | Standard/reduced | `prefers-reduced-transparency` |

### Step 2: Motion Sensitivity

Motion is the most commonly harmful interface property. Handle it rigorously:

**Default behaviour:**
- All animations and transitions are wrapped in a motion preference check
- `prefers-reduced-motion: reduce` disables non-essential animation
- Essential motion (e.g., a progress bar filling) uses reduced, simpler alternatives

**Implementation pattern:**
```css
/* Full motion (default) */
.element { transition: transform 300ms ease-out; }

/* Reduced motion */
@media (prefers-reduced-motion: reduce) {
  .element { transition: none; }
}
```

**Never autoplay:**
- Video, carousel, or animated content must not play automatically
- If autoplay is a business requirement, provide immediate pause/stop controls AND respect prefers-reduced-motion

### Step 3: Colour Scheme Adaptation

Dark mode is not "invert the colours." It is a separate design exercise:

- **Backgrounds:** dark grey (not pure black) reduces eye strain
- **Text:** off-white (not pure white) on dark backgrounds
- **Elevation:** lighter shades indicate higher elevation in dark mode (opposite of light mode shadows)
- **Semantic colours:** error red, success green — these may need different shades in dark mode to maintain contrast
- **Images and illustrations:** may need dark-mode variants or reduced brightness

### Step 4: Typography Flexibility

Text must be resizable without breaking the layout:

- Use `rem` or `em` units, never fixed `px` for font sizes
- Test at 200% browser zoom — content must remain usable
- Support system-level large text settings
- Line spacing, letter spacing, and word spacing should be adjustable (WCAG 1.4.12)
- Do not clip or overflow text when sizes change

### Step 5: Information Density

Different users need different densities:

- **Spacious:** more whitespace, larger touch targets, fewer items visible — beneficial for motor impairments, cognitive load, mobile use
- **Comfortable:** balanced — the default for most users
- **Compact:** denser information, smaller elements — beneficial for power users, large dataset work

If offering density controls:
- Persist the user's choice across sessions
- Ensure all density levels maintain accessibility requirements (touch targets, contrast, readability)

### Step 6: Respect and Persist Preferences

- **System-level preferences** (via media queries) should be respected automatically with no opt-in required
- **Application-level preferences** (density, layout) should be easy to find, easy to change, and persisted
- **Never override system preferences** without explicit user action
- **Never require users to justify** their preferences (no "Are you sure you want dark mode?")

### Step 7: Document Adaptive Behaviour

For each adaptive property, document:
- What adapts and why
- The default behaviour
- The adapted behaviour for each preference
- How the preference is detected and respected
- Fallback behaviour when preference detection is unavailable

## Integration

- **Called by:** `ui-composition`, `interaction-design`
- **Pairs with:** `cognitive-accessibility` (density and simplification), `inclusive-personas` (preference awareness)
- **Reviewed by:** `designpowers-critique`
