# PR 7621 stale recovery ownership QA

## What was tested

- Added a deterministic race seam immediately before stale recovery cleanup.
- Replaced the observed stale `.recovery` record with a live owner at that
  exact seam.
- Ran the focused red/green test, the complete memory lock suite,
  memory-core typecheck, official Bun 1.4.0 `test:senpi`, the evidence resolver
  tests, the Senpi driver self-test, and the real isolated Senpi driver.

## What was observed

- Before the ownership fix, acquisition incorrectly succeeded after deleting
  the replacement recovery owner: 3 pass, 1 fail.
- After changing stale cleanup to the nonce-checking lock release path, the
  contender failed closed and the replacement remained: 4 pass, 0 fail.
- Full lock suite: 23 pass, 0 fail.
- Memory-core typecheck: exit 0.
- Senpi package gate: 2527 pass, 1 Windows-only skip, 0 fail, 8053 assertions
  across 334 files.
- Evidence resolver: 10 pass, 0 fail, 31 assertions.
- Real Senpi driver: `result=PASS`, `realSenpiUntouched=true`,
  `realSenpiChangedPaths=[]`, `realOmoUntouched=true`,
  `realOmoChangedPaths=[]`, and protected credential/state digests unchanged.
- The driver attributed one concurrent real-session JSONL update to the
  volatile session lane rather than to this QA run.
- The isolated agent directory was
  `/private/var/folders/13/yyrkyfts6qsg303mcwpwzq200000gn/T/omo-senpi-qa-qJCWyg/agent`
  and was removed by the driver on exit.

## Why this is enough

The regression test pauses at the exact former time-of-check/time-of-use seam,
publishes a different valid owner, and proves the stale contender cannot remove
it. The broader lock suite covers existing dead-owner recovery, live-owner
protection, release ownership, and subprocess contention. The Senpi package
gate and real driver cover the generated adapter bundles and confirm isolated
runtime behavior.

## What was omitted

Dependency installation progress, full test progress, credentials, auth
headers, private configuration, and unrelated session contents are omitted.
Only result counts and non-secret isolation fields are retained.

## Current-dev merge refresh

After merging `upstream/dev@928aa8571`, the only conflicts were the four
generated Senpi bundles already changed by this PR. All four were regenerated
with official Bun 1.4.0.

Post-merge results:

- complete memory lock suite: 23 pass, 0 fail;
- memory-core typecheck: exit 0;
- all staged runtimes and all six Senpi bundles: current;
- exact Bun 1.4.0 `test:senpi`: 2677 pass, 32 platform/fixture skips, 0 fail,
  8503 assertions across 352 files;
- evidence resolver: 10 pass, 0 fail, 31 assertions;
- real isolated Senpi behavior: `result=PASS`, ultrawork and comment-checker
  passed, environment receipt matched, protected snapshots were complete, and
  Senpi/OMO changed-path lists were empty.

Current `dev` intentionally disables recursive directory-identity certification
outside Linux. The final macOS driver therefore reports
`DIRECTORY_IDENTITY_UNAVAILABLE` and does not claim whole-tree certification.
The pre-merge driver result above retains the last full
`realSenpiUntouched=true` and `realOmoUntouched=true` proof, while the post-merge
run records complete protected snapshots and no observed changed path.
