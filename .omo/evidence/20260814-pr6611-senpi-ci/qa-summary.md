# PR 6611 Senpi Windows CI stabilization

## What was tested

- Focused shutdown-dream test:
  `bun test packages/omo-senpi/src/components/memory/dream-trigger-shutdown.test.ts`
- Declared Senpi package suite:
  `bun run --cwd packages/omo-senpi test`
- Senpi package typecheck:
  `bun run --cwd packages/omo-senpi typecheck`
- Strict test-file audit:
  `check-no-excuse-rules.ts dream-trigger-shutdown.test.ts`

## What was observed

GitHub run `31778788360` failed only
`senpi-compatibility (windows-latest)`. The all-gates-pass shutdown test
completed in 1.516 seconds against a 1.5-second shutdown budget and observed no
launch before the drain closed.

After increasing only that success-path test budget:

- focused file: 8 passed, 0 failed, 17 assertions;
- full declared Senpi package test script: exit code 0;
- package typecheck: exit code 0;
- strict audit: no violations in 1 file.

The tests that explicitly exercise deadline crossing, pre-abort, mid-flight
abort, and disabled shutdown behavior were not changed.

## Why it is enough

The patch changes test input only. It removes a host-speed dependency from a
success-path test while leaving all deadline semantics under dedicated tests.
The exact file, full package suite, typecheck, and strict audit pass.

## What was omitted

The full package log was not copied because it is long and contains no
failures. No environment dump or private configuration was captured.
