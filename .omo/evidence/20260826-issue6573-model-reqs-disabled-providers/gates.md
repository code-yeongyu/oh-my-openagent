# Gates: issue #6573 disabled-provider fallback resolution

## Automated gates

- Affected regression set: 1,331 pass, 0 fail, 3,676 expectations across 133 files.
- Full root typecheck: exit 0.
- Full build: exit 0.
- Senpi generated extension check: current.
- Senpi unit gate: 2,531 pass, 7 skip, 0 fail, 8,070 expectations across 334 files.
- Evidence resolver tests: 10 pass, 0 fail, 31 expectations.
- Diff whitespace check: clean.
- All touched source files are at or below 250 pure lines of code.
- The no-excuse scan found no violation introduced by a changed hunk.

## Full root test result

- 16,996 pass, 39 skip, 1 fail, 48,545 expectations across 2,178 files.
- The sole failure is the Codex installer version assertion: the package version is
  `5.0.0-beta.34`, while the committed generated installer is stale.
- The same targeted assertion fails identically on pristine `origin/dev`; no Codex installer file
  is included in this repair.

## Native Senpi comparison

- Repository launcher: `omo 5.0.0-0.beta.34`, pinned engine `senpi 2026.9.2-4`.
- Driver self-test: pass.
- Candidate and pristine `origin/dev` task lifecycle runs produced identical check matrices.
- Both passed product-scope background spawn, unconditional wake, extension suppression,
  two-child fanout, synchronous inline behavior, invalid-category rejection, resume
  setup/cancel/kill/LRU behavior, real-home isolation, and PID cleanup.
- Both had the same unrelated broad-driver failures in follow-up revival, task-output peek, JSONL
  sequencing, resident revival, finished-task steering, and TTL non-revival.
- Both reported `realSenpiUntouched: true`, no changed real paths, unchanged digest, and zero
  leaked child processes.
