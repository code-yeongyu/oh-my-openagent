---
schema: agentcontrol-handoff/v1
id: explore-model-comparison
action: explore
projectRoot: .
sourceRevision: 48c7f2e
status: ready
---

## Goal
Trace the implemented AgentControl handoff flow and return precise local evidence suitable for comparing Explore model quality.

## Done when
The report explains the public schema, validation ordering, persisted and injected metadata, worker prompt behavior, and Dispatch dashboard integrity behavior with file and line citations.

## Workspace
Use the current AgentControl handoff-v1 worktree at revision 48c7f2e.

## Scope
Inspect only the AgentControl TypeScript adapter, Python runtime, monitor, and focused tests.

## Source map
`packages/omo-opencode/src/tools/agentcontrol/`, `packages/omo-opencode/src/plugin-handlers/agent-config-finalizer.ts`, `tools/agent_control/`, and `tests/agent_control/test_mcp_v3.py` are authoritative.

## Claims and decisions
Revalidate every claim. Prior summaries are not authoritative.

## Acceptance atoms
1. Identify where all five launch tools require and forward `handoff`.
2. Prove validation occurs before worker or pending-row creation.
3. Summarize path, metadata, section, action, readiness, size, and digest checks.
4. Trace ID, absolute path, and SHA-256 through ledger and worker environment.
5. Identify worker read-first and independent-revalidation instructions.
6. Explain dashboard metadata, `H` document view, and digest substitution defense.
7. Identify the per-refresh shared-handoff read cache.
8. Cite concrete files and current line numbers for each material claim.

## Verification
Cross-check claims against source and focused tests. Do not infer behavior from documentation alone.

## Deliverable
Call `Report` once with a concise summary and detailed Markdown using the headings `Flow`, `Rejection`, `Dashboard`, and `Risks`.
