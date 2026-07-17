---
name: ulw-map
description: "Turn a ulw-plan work plan into a READ-ONLY visual wave execution map (deterministic Mermaid, optional browser viewer). Use when the user wants to SEE a plan instead of reading it: before approving a plan at the ulw-plan gate, when a non-expert asks what will happen or in what order, or to check progress at a glance (checked todos render as done). Triggers: ulw-map, plan map, show me the plan, visualize the plan, draw the plan, what's the execution order, 계획 보여줘, 플랜 그림으로. NOT for creating or editing plans (use ulw-plan) and NOT for executing them (use start-work)."
metadata:
  short-description: Visual wave execution map for ulw-plan work plans
---

# ulw-map

You render an existing `.omo/plans/<slug>.md` work plan as a **wave execution map** so a human - expert or not - can see at a glance what will run, in what order, and what runs in parallel. You are a VIEWER: you never create, edit, or execute plans, and you never modify the plan file.

Everything is derived **deterministically** from the plan text by a script - no LLM anywhere in the parse/emit path, so the diagram cannot hallucinate structure the plan does not contain. Identical plan bytes + identical source path and options → identical map bytes.

## RUN THE SCRIPT - do not hand-draw the diagram

```
node "<skill-root>/scripts/plan-map.mjs" <plan-file-or-slug> [--html] [--open] [--check] [--stdout] [--out-dir <dir>]
```

(Replace `<skill-root>` with this skill's own directory; `bun` is an accepted substitute for `node`.) Never write the Mermaid by hand - a hand-drawn diagram can drift from the plan, which defeats the point.

- Default: writes `.omo/maps/<slug>.md` (Mermaid + a "how to read this" legend + diagnostics).
- `--html`: also writes `.omo/maps/<slug>.html`, a self-written viewer page. The Mermaid **source** is the page content; the renderer loads from a pinned CDN URL at view time (nothing vendored). Offline, the page still shows the source.
- `--open`: opens the HTML viewer in the default browser (implies `--html`). Use it when the user asks to *see* the map; do not open a browser unprompted - plans can contain paths and commands the user may not want on screen.
- `--stdout`: prints the map Markdown instead of writing files (useful to show the Mermaid inline).
- `--check`: parses and reports diagnostics without writing anything.

## What the map claims (honesty contract)

- It parses only the mandated plan grammar: column-zero `- [ ] N. <title>` rows in `## Todos` and `- [ ] F<n>. <title>` rows in `## Final verification wave`.
- Wave grouping ladder, most-canonical first: (1) the per-todo `Parallelization: Wave <N>` metadata line the ulw-plan template mandates; (2) column-zero `###` headings inside `## Todos`; (3) neither → a document-order chain, labeled as such. Tasks inside one group are lanes that may run concurrently; groups are barriers. The map states which ladder rung produced the grouping.
- **Arrows mean plan document order, never inferred per-task dependencies.** Do not present the map as a dependency graph.
- The final verification wave renders as a parallel fan-out joining at "All approve → complete" - that is the upstream contract, not an inference.
- `✓` marks checkboxes already checked off, so re-running after execution shows progress.

## Fail-soft contract

The script never guesses. Exit 0 = map generated (diagnostics, if any, are embedded in the output and printed as `warning:` lines - relay them to the user). Exit 1 = unsupported plan structure (missing `## Todos`, or no rows matching the grammar) with a human-fixable message. Exit 2 = usage or IO errors. On exit 1, tell the user what the script looked for; offer `$ulw-plan` if they don't have a real work plan yet.

## Typical moments to offer the map

1. **At the approval gate** - after `$ulw-plan` presents a plan and before the user approves it, offer: "want to see this as a map?" Then run with `--open` if they say yes.
2. **Mid-execution** - "how far along are we?" Re-run the script; checked boxes render as done.
3. **Explaining a plan to someone else** - `--html` produces a single file that can be viewed anywhere.

## Boundaries

- Never edit the plan file or write outside `.omo/` (or the explicit `--out-dir`, which must stay inside the working directory).
- Never substitute an image-generation model for the script - the map must stay deterministic.
- Creating or changing plans is `$ulw-plan`; executing them is `$start-work`; this skill only shows them.
