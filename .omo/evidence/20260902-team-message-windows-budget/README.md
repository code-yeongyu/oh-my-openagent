# Team-message Windows test budget QA

## What was tested

- Failing-first evidence: GitHub Actions run `33602178990`, job
  `test (windows-latest, 1/2)`.
- Focused fallback wake:
  `bun test ./packages/omo-opencode/src/features/team-mode/tools/messaging.test.ts --test-name-pattern "generic fallback wakes cover two messages"`.
- Complete messaging suite:
  `bun test ./packages/omo-opencode/src/features/team-mode/tools/messaging.test.ts`.
- Adapter typecheck:
  `./node_modules/.bin/tsgo --noEmit -p packages/omo-opencode/tsconfig.json`.
- Isolated OpenCode TUI:
  `bash .agents/skills/opencode-qa/scripts/tui-smoke.sh --self-test`.

## What was observed

The Windows CI case reached Bun's 5 second test default after 5.094 seconds.
The test already uses a separate 3 second event timeout to fail when the second
fallback wake does not dispatch. The repair keeps that event deadline and gives
only the outer integration case a 15 second budget on Windows for fixture,
mailbox filesystem, and prompt-queue work. Other platforms keep 5 seconds.

The focused test passed with 1 test, 6 expectations, and 0 failures. The full
messaging file passed with 41 tests, 138 expectations, and 0 failures. Adapter
typecheck exited 0 without diagnostics.

The real OpenCode TUI rendered under tmux, accepted a key into the composer,
removed the tmux session, and left the real database unchanged at 8046 sessions.

## Why this is enough

The unchanged 3 second event timeout still detects the behavioral regression;
only unrelated outer setup time receives a Windows allowance. The full file
covers adjacent live-delivery, mailbox, and prompt-gate behavior. Typecheck and
the isolated TUI smoke cover the consuming OpenCode adapter and real harness.
Required PR CI supplies the authoritative Windows rerun.

## What was omitted

No credentials, auth headers, environment dumps, database rows, or raw terminal
capture are stored. The evidence keeps commands, deterministic summaries, and
the isolation proof.
