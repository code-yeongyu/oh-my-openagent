# Claim-safe reflection finalization

## What was tested

- Rebuilt all omo-senpi extension artifacts with:
  - `node packages/omo-senpi/plugin/scripts/build-extension.mjs`
- Ran the complete memory-core source suite once:
  - `bun test packages/memory-core/src/`
- Ran the complete omo-senpi memory suite once:
  - `bun test packages/omo-senpi/src/components/memory/`
- Ran both package typechecks:
  - `bun run --cwd packages/memory-core typecheck`
  - `bun run --cwd packages/omo-senpi typecheck`
- Focused coverage included:
  - concurrent per-run finalization claims;
  - exact `Omo-Run` receipt and validated-tip ancestry probes;
  - integration-mode ancestry;
  - crash after integration before checkpoint;
  - crash after merge, cleanup, and reservation completion before `final.json`;
  - completion-record idempotency and consumed-delivery preservation;
  - live runner and reconciliation sharing one finalizer.

## What was observed

- memory-core: 465 pass, 0 fail, 3,897 assertions across 57 files.
- omo-senpi memory: 474 pass, 0 fail, 1,386 assertions across 85 files.
- Both `tsgo --noEmit -p tsconfig.json` commands exited 0.
- The extension build regenerated `omo.js`, `omo-member.js`, `omo-memory-mcp.js`, and `memory-run-supervisor.mjs`.
- The real-Git crash tests observed one integration receipt, one cursor settlement, repaired durable completion/final records, and no duplicate reservation completion.

## Why it is enough

The tests drive the production Git repository, reflection reservation store, worker ledger, terminal sentinels, completion records, live runner, and session-start reconciliation. They cover the two previously blocking crash windows and the live/reconciler race through the same claimed transaction rather than a mocked duplicate path.

## What was omitted

The raw full-suite log remains a local test artifact at `/tmp/finalization-full-gates.log`; it contains no credentials, but only the reviewer-readable command and result summary is committed.
