# Senpi memfs Windows test budget QA

## What was tested

- Failing-first evidence: GitHub Actions run `33600175911`, job
  `senpi-compatibility (windows-latest)`.
- Focused interactive restore test:
  `bun test ./packages/omo-senpi/src/components/memory/commands/memfs-extra.test.ts --test-name-pattern "backups and an interactive session"`.
- Both real-git memfs suites:
  `bun test ./packages/omo-senpi/src/components/memory/commands/memfs.test.ts ./packages/omo-senpi/src/components/memory/commands/memfs-extra.test.ts`.
- Package typecheck:
  `./node_modules/.bin/tsgo --noEmit -p packages/omo-senpi/tsconfig.json`.
- Senpi QA harness self-test:
  `node packages/omo-senpi/scripts/qa/drive.mjs --self-test`.
- Real Senpi adapter:
  `node packages/omo-senpi/scripts/qa/drive.mjs`.

## What was observed

The Windows CI test timed out at Bun's 5 second default after 5.697 seconds.
The sibling `memfs.test.ts` suite already assigns real git subprocess tests a
30 second Windows budget while retaining 5 seconds elsewhere. The same
platform-specific budget now covers `memfs-extra.test.ts`; no operation or
assertion changed.

The focused test passed with 1 test, 4 expectations, and 0 failures. Both memfs
suites passed with 26 tests, 84 expectations, and 0 failures. Package typecheck
exited 0 with no diagnostics.

The real Senpi driver reported `PASS`, injected the ultrawork directive, passed
the comment checker, and reported `realSenpiUntouched: true` with no changed
real-home paths. The isolated sandbox was removed after the run.

## Why this is enough

The focused and combined suites exercise the exact restore case and adjacent
real-git commands without weakening assertions. The typecheck covers the
changed package. The real Senpi driver proves the consuming adapter still loads
and executes in an isolated agent directory. Required PR CI supplies the
authoritative Windows rerun of the original failing surface.

## What was omitted

No credentials, auth headers, environment dumps, or agent transcripts are
stored. The evidence keeps only commands, deterministic summaries, isolation
fields, and the sandbox cleanup receipt.
