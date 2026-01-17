---
name: codex-mcp-collaboration
description: Use to enforce Codex MCP participation at analysis, prototype-before-code, and post-change review; all three checkpoints are mandatory and parallel, not optional sequencing.
---

# Codex MCP Collaboration

Always ask: “How can Codex help right now?” Codex MCP assists with requirement analysis, pre-implementation prototypes (unified diff only), and post-change review. Codex is advisory—you must still reason independently.

## When to Use

- Any coding work: features, fixes, refactors, tests, infra scripts.
- Immediately after first-pass requirement analysis.
- Right before writing code.
- Immediately after coding (before declaring done).

## Not For / Boundaries

- Purely administrative/status updates without code impact.
- Delegating edits to Codex (keep `sandbox: "read-only"`).
- Skipping checkpoints because “simple” or “already reviewed.”

## Obligations (parallel checkpoints)

1) **Analysis refinement:** After your initial analysis, ask Codex to refine needs/plan and surface risks.  
2) **Prototype before code:** Before editing, request a unified diff prototype (read-only). Rewrite the implementation yourself.  
3) **Post-change review:** After coding, ask Codex to review diff vs requirements and highlight risks.

All three fire when their triggers occur; none can be skipped.

## How to Work With Codex

- Use `mcp_codex_codex` with `sandbox: "read-only"`; capture and reuse `SESSION_ID`.
- Treat output as reference only; document what you accept/reject and why.
- If Codex guidance conflicts with your judgment, choose the safer, reasoned path and note it.
- See `reference.md` for prompt templates and parameter guardrails.

## Quick Reminders

- Codex cannot modify files; prototypes are unified diffs for thinking only.
- Do not implement anything when feedback is unclear—clarify first.
- Run tests after your changes before asking Codex to review.

## Completion Check

- All three Codex checkpoints executed at their triggers.
- Decisions and deviations from Codex captured.
- Tests run where applicable; no delegated edits.
