---
name: token-architecture
description: Use when building or restructuring design token systems — global tokens, semantic tokens, component tokens, naming conventions, theming, and multi-platform token distribution
---

# Token Architecture

Design tokens are the single source of truth for visual decisions. They bridge design intent and code. This skill structures how tokens are named, layered, and distributed.

## When to Use

- When starting a new design system
- When `design-system-alignment` identifies inconsistency
- When adding theming (dark mode, brand variants)
- When shipping across web, iOS, and Android

## The Three-Layer Model

### Layer 1: Global Tokens (the palette)
Raw values. Named by what they are, not what they do.
```
--color-green-500: #2D6B4F;
--space-4: 16px;
--radius-md: 12px;
```
These never appear in component CSS.

### Layer 2: Semantic Tokens (the meaning)
Map global tokens to roles. Named by what they do.
```
--color-surface: var(--color-green-100);
--color-text-primary: var(--color-green-900);
--color-accent: var(--color-green-500);
```
Theming happens here — dark mode swaps semantic mappings, not global values.

### Layer 3: Component Tokens (the specifics)
Map semantic tokens to component contexts. Optional but valuable at scale.
```
--button-bg: var(--color-accent);
--card-bg: var(--color-surface);
```

## Naming Convention

`--{category}-{property}-{variant}-{state}`

Categories: color, space, font, radius, shadow, motion. Never use hex values in names or ambiguous abbreviations.

## Theming

Dark mode is a semantic token remap:
```css
[data-theme="dark"] {
  --color-surface: var(--color-grey-900);
  --color-text-primary: var(--color-grey-100);
}
```
Global tokens stay. Semantic tokens swap. Component tokens inherit.

## Accessibility

- Always define foreground/background pairs together and verify AA contrast
- Motion tokens must include `--motion-duration-none: 0ms` for reduced-motion

## What You Deliver

- Token file (CSS custom properties, JSON, or both) with all three layers
- Naming convention document
- Theme variants if applicable

## Integration

- **Informed by:** `design-lead`, `ui-composition`
- **Feeds into:** `design-builder`, `design-system-alignment`
