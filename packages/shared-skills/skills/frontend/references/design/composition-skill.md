---
name: composition-skill
description: "Project-original page-composition reference for new or substantially restructured multi-section marketing, editorial, portfolio, or discovery pages without a user-supplied exact visual reference. Keeps the content decision path, dominant spatial idea, route comparison, responsive reading order, and proof provenance visible while visual styling evolves. Excludes component-only work, app shells, and exact-reference reproduction; intentional template families may share a documented structure."
---

# Page Composition

Style references shape visual language. This reference keeps information architecture and spatial identity visible so palette, type, material, and decoration do not disguise a generic template.

Use it for a new or substantially restructured multi-section marketing, editorial, portfolio, or discovery page when the user has not supplied an exact visual reference. It is especially useful when a sibling route could become an existing page by changing only copy and color.

## What a resolved composition communicates

A resolved page makes its decision path understandable in the DOM and the rendered result. Approved content has a purpose, such as introducing, explaining, proving, comparing, converting, navigating, or retaining, and its order reflects what the visitor needs next. One spatial relationship carries that path strongly enough to describe without naming a theme: an editorial spine with an evidence rail, for example, rather than "modern SaaS landing page." Navigation opens the journey deliberately, and the footer closes or extends it deliberately.

Derive that outcome from the product's content, audience, and layout grammar found during OMO research. Do not select from a fixed catalog or rotate structures for novelty. Coherent reuse is better than arbitrary difference; unexplained template repetition is the problem.

The visual concept may refine the composition as work develops. Keep `DESIGN.md` current when it does so the recorded intent, DOM order, and captures describe the same page instead of preserving an obsolete one-shot decision.

## Structural variety is comparative

Compare routes only when purpose, audience, and content scale are meaningfully similar. Shared navigation, footer, and primitives do not make two routes structural clones.

When comparable routes share the same content sequence, dominant spatial relationship, and opening or closing voice, the result should either serve a deliberate template or information-architecture convention, or evolve to express the new brief. Record the concrete reason for reuse. A generic "for consistency" is not enough, while a named publishing template, user-tested convention, or exact-reference requirement is.

Changing only color, font, illustration, or copy does not create structural variety. Conversely, do not force each member of an intentional template family to look unfamiliar; one family-level rationale can cover its routes.

## Honest proof

Metrics, adoption counts, rankings, testimonials, customer names or logos, certifications, and case-study outcomes must come from user-supplied or cited inputs. A visual reference containing a claim is comparison data, not permission to publish the claim.

When evidence is unavailable, omit the proof-shaped slot and let process, mechanism, product behavior, or evaluation criteria carry the argument. An explicitly labeled placeholder such as `[verified metric required]` is acceptable only in a non-production design artifact whose production behavior removes the slot until verification. Never invent plausible claims to make a composition feel complete.

## `DESIGN.md` outcome record

For each applicable route or intentional template family, keep a concise structural-intent row in Section 4:

```markdown
### Page Structure

| Route or family | Content decision path | Dominant composition | Nav/footer voice | Proof basis | Reuse rationale |
|-----------------|-----------------------|----------------------|------------------|-------------|-----------------|
| /route | hook > explain > prove > convert | editorial spine with evidence rail | compact utility nav; resource-led footer | cited benchmark and supplied customer quote | distinct from /, or the specific reason for intentional parity |
```

This is an outcome description, not a fixed page catalog or serialized checklist. It should be specific enough to compare with the DOM and responsive captures, brief enough to revise when the design legitimately changes, and grounded in approved content rather than invented sections.

## Boundaries and rendered outcome

Component or primitive work does not need a route record. Application shells, dashboards, settings screens, inboxes, and split panes use `layout-skill.md` for spatial mechanics. Exact reproduction of a user-supplied screenshot, Figma export, mockup, or live reference follows that reference instead of seeking novelty. These boundaries never relax proof provenance.

At rendered QA, the content decision path should survive from desktop through 375px without collapsing every section into the same stacked-card rhythm. The dominant composition should remain perceptible without relying on color alone, and the implemented page should still match the current `DESIGN.md` intent. `visual-qa` owns that evidence-based judgment; this reference does not add a separate preflight.
