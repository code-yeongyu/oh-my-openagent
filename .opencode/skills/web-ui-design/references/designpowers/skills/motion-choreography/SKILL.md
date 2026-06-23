---
name: motion-choreography
description: Use when designing animation sequences, page transitions, micro-interactions, loading states, or any motion that communicates meaning — ensures motion is purposeful, performant, and safe for motion-sensitive users
---

# Motion Choreography

Motion is communication. Every animation answers a question the user didn't know they had. If it doesn't answer one, cut it.

## The Three Questions

Before adding any animation:
1. **What changed?** — the animation makes it visible
2. **What should I look at next?** — directs attention
3. **How are these related?** — shows spatial/hierarchical relationship

Can't answer at least one? The animation is decoration. Cut it.

## Duration Guide

| Context | Duration |
|---------|----------|
| Micro-interaction (button, toggle) | 100-200ms |
| State change (card expand, tab) | 200-300ms |
| Screen transition | 250-400ms |
| Complex choreography | 400-700ms total |

Nothing over 1 second unless it's a loading indicator.

## Easing Reference

| Context | Easing |
|---------|--------|
| Entering | ease-out (decelerate) |
| Leaving | ease-in (accelerate) |
| State change | ease-in-out |
| Micro-interaction | spring (stiffness 300-500) |

## Stagger Patterns

- 50-80ms delay between items
- Maximum 5 items staggered, rest appear instantly
- Follow reading order
- Reveal hierarchy — important items first

## Reduced Motion

`prefers-reduced-motion: reduce` means reduce, not remove.

| Standard | Reduced alternative |
|----------|-------------------|
| Slide in | Fade in |
| Scale with bounce | Instant appearance |
| Parallax scroll | Static |
| Staggered reveal | Simultaneous fade |
| Continuous pulse | Static state |

**Every animation must have a reduced-motion alternative. No exceptions.**

## What NOT to Animate

- Text colour changes (photosensitive risk)
- Layout properties in performance paths (use transform)
- Anything that delays task completion
- Decorative loops without user control

## Performance

Only animate: `transform`, `opacity`, `filter`. These are GPU-composited.

## What You Deliver

- Animation specs with durations, easings, triggers
- Reduced-motion alternatives for every animation
- Performance annotations
- Sequence diagrams for complex choreography

## Integration

- **Informed by:** `design-lead`, `interaction-design`
- **Feeds into:** `motion-designer` agent, `accessibility-reviewer`, `design-builder`
