---
schema: agentcontrol-handoff/v1
id: qa-explore-v1
action: explore
projectRoot: .
sourceRevision: qa-fixture
status: ready
---

## Goal
Confirm a real Explore launch receives a validated handoff.

## Done when
The worker is launched and its ledger row contains the expected handoff metadata.

## Workspace
Use the current AgentControl worktree.

## Scope
Read package.json only.

## Source map
package.json is authoritative for the package name.

## Claims and decisions
Revalidate the package name from source.

## Acceptance atoms
Report one package name backed by package.json.

## Verification
Read package.json and compare the name field.

## Deliverable
One concise Report summary.
