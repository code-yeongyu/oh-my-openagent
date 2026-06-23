---
name: responsive-patterns
description: Use when designing complex responsive layouts — breakpoint strategy, layout shifts, content reflow, responsive typography, container queries, and ensuring the experience works across the full device spectrum
---

# Responsive Patterns

Responsive design is not "make it fit on a phone." It is designing for every context — one-handed on a bus, zoomed to 200% on a desktop, on a tablet in sunlight.

## When to Use

- When `ui-composition` defines a layout that spans breakpoints
- When the design-critic flags responsive issues
- When building anything more complex than single-column

## Breakpoint Strategy

Content drives breakpoints, not devices. Do not use 768px because "that's tablet." Use the width where your content breaks.

1. Start at 320px
2. Widen slowly
3. When the layout looks wrong — that's a breakpoint
4. Name by behaviour, not device

```css
--bp-stack: 0;
--bp-sidebar: 640px;
--bp-columns: 900px;
--bp-wide: 1200px;
```

## Content Priority Shifting

At narrow widths, decide what gets:
- **Kept** — essential for the task
- **Collapsed** — behind a toggle
- **Deferred** — lower in scroll order
- **Hidden** — removed (last resort)

Document these decisions.

## Responsive Typography

```css
--font-size-body: clamp(1rem, 0.9rem + 0.5vw, 1.125rem);
--font-size-h1: clamp(1.75rem, 1.5rem + 1.25vw, 2.5rem);
```

Body text minimum 16px. Line length 45-75 characters. At 200% zoom, no horizontal scroll (WCAG 1.4.10).

## Container Queries vs Media Queries

| Use case | Use |
|----------|-----|
| Page-level layout | `@media` |
| Component adaptation | `@container` |

## Touch Targets

44x44px minimum at mobile. 8px minimum gap between adjacent targets.

## Testing

Test at: 320px, one pixel below each breakpoint, 200% zoom at 1280px, landscape phone, and real devices.

## What You Deliver

- Breakpoint definitions with rationale
- Layout behaviour at each breakpoint
- Content priority decisions
- Typography scale with clamp() values
- Touch target verification

## Integration

- **Informed by:** `ui-composition`, `design-discovery`
- **Feeds into:** `design-builder`, `accessibility-reviewer`
