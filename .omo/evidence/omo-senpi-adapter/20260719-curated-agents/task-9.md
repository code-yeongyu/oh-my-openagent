# Task 9 evidence - live Senpi QA

## What was tested

- The curated driver starts a real installed Senpi process with a local deterministic provider and an isolated agent/project/session tree.
- It verifies the persisted Explore record, exact nine-name allowlist, agent-sourced model metadata, persona/task sentinels, visible and successful LSP diagnostics, hidden edit/write tools, rejected mutation calls, safe bash success, rejected bash mutation, unknown-target rosters, unchanged probe bytes, absent forbidden files, exit status, and real-agent-dir attribution.
- The baseline driver exercises background spawn, wake, revive, full and blocking output, JSONL ordering, extension suppression, batch fanout, synchronous completion, negative routing, cleanup, and isolation.
- The analyzer fixture owns independent literal inputs and an exact expected check object, so deleting a required analyzer check fails the test.

## What was observed

- `curated-agents-e2e.json`: PASS, 18/18 checks, Senpi exit 0.
- `baseline-task-e2e.json`: PASS, 12/12 checks, 0 leaked PIDs.
- Final gates: 1,014 package tests pass; 259 `test:senpi` tests pass; both scoped typechecks and the final bundle check exit 0.

## Why it is enough

The driver crosses the real harness, generated bundle, task persistence, child-visible prompt/tools, actual tool execution, filesystem non-mutation, and process cleanup boundaries.

## What was omitted

No real model API was contacted, and raw transcripts or environment dumps were not retained.
