---
schema: agentcontrol-handoff/v1
id: qa-dispatch-v1
action: dispatch
projectRoot: .
sourceRevision: qa-fixture
status: ready
---

## Goal
Confirm a real Dispatch launch shares validated handoff metadata.

## Done when
The workflow worker reaches the ledger with the expected handoff metadata.

## Workspace
Use the current AgentControl worktree.

## Scope
Process the supplied synthetic item only.

## Source map
The Dispatch item is the only source.

## Claims and decisions
Revalidate the supplied item before reporting.

## Acceptance atoms
Report the exact item.

## Verification
Compare the reported item with the input.

## Deliverable
One concise Report summary.

## Mutation boundary
Do not modify project files.
