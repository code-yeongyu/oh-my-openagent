# cmux comments fix QA

## What was tested

- `bun test packages/omo-senpi/src/components/task/task-component.test.ts packages/omo-senpi/src/components/task/cmux-notifier.test.ts packages/senpi-task/src/completion/notifier.test.ts`
- `OMO_SKIP_MATERIALIZE=1 bun run test:senpi`
- `CMUX_PROBE_OUT_DIR=.omo/evidence/omo-senpi-adapter/20260804-cmux-comments-fix node packages/omo-senpi/scripts/qa/cmux-notification-probe.mjs`

## What was observed

- Targeted completion/cmux unit tests passed: 26 tests.
- Senpi package gate passed with materialization skipped for already-present upstream assets: 534 tests.
- Fake cmux probe passed and recorded the observed `cmux notify` invocation through the executable wrapper, including the neutral `OMO task finished` title.
- Real Senpi write-surface classification reported no QA-attributed real-agent changes for the passing fake probe.

## Why this is enough

The unit tests pin the replaced-session drop hook before parent-message suppression, cmux delivery only after parent enqueue succeeds, and the cmux argv body bound. The live fake-cmux probe drives the Senpi adapter through the real task path and proves notification invocation capture, neutral title, and real-agent isolation classification.

## Omitted or redacted

Raw stdout/stderr are stored separately. No secrets or auth material copied into this summary.
