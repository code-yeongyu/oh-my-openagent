# Senpi memfs Windows test budget

## Failure

CI run `33600175911` timed out the interactive `/memfs restore` integration
case after 5.697 seconds on `windows-latest`. The suite uses real git
subprocesses for initialization, commit, backup, and restore.

## Change

- Give `memfs-extra.test.ts` the same platform-specific default timeout already
  used by `memfs.test.ts`: 30 seconds on Windows and 5 seconds elsewhere.
- Keep every restore assertion and real-git operation unchanged.
- Add no sleep, polling, retry loop, or platform skip.

## Verification

- Run the focused interactive restore test.
- Run both memfs command suites.
- Typecheck `packages/omo-senpi`.
- Run the isolated real Senpi memory QA driver and record canonical evidence.
- Require green PR CI and Cubic before merge.
