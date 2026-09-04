# PR 7621 recovery-claim namespace QA

## What was tested

- Aged the stale recovery inode beyond the candidate-sweep threshold.
- Paused the elected stale-recovery reclaimer after it created its hard-link
  claim.
- Advanced the candidate sweeper's clock without sleeping and invoked the
  real sweep while the claim remained active.
- Ran the focused regression red and green, the complete memory lock suite,
  memory-core typecheck, generated Senpi bundle build, exact Bun 1.4.0 Senpi
  gate, and real isolated Senpi driver.

## What was observed

- Before the namespace fix, the candidate sweeper removed one active recovery
  claim and the regression failed: 4 pass, 1 fail.
- After moving claims out of `.candidate-<uuid>`, the sweeper removed zero
  claims and the focused suite passed: 5 pass, 0 fail.
- Complete memory lock suite: 24 pass, 0 fail, 64 assertions.
- Memory-core typecheck: exit 0.
- Real Senpi driver: `result=PASS`, ultrawork injection passed,
  comment-checker passed, protected snapshots were complete, and both Senpi
  and OMO changed-path lists were empty.
- macOS reported `DIRECTORY_IDENTITY_UNAVAILABLE` and did not overclaim broad
  whole-directory certification.
- After merging `upstream/dev@0a5dab201`, the complete lock suite still
  passed with 24 tests and 64 assertions, memory-core and omo-senpi typechecks
  exited zero, and the real isolated Senpi driver again returned
  `result=PASS` with empty Senpi and OMO changed-path lists. Its exact JSON is
  recorded in `post-merge-live-driver.json`.
- The exact Bun 1.4.0 Senpi gate passed after the merge with 2677 tests,
  32 platform/fixture skips, 0 failures, and 8503 assertions across 352 files.
- After `dev` advanced again to `07e30350b`, the lock suite, both typechecks,
  exact Senpi gate, and real Senpi driver were repeated. Counts remained
  unchanged and the final live result remained `PASS` with no attributed
  Senpi or OMO changed paths. The final JSON is in `final-live-driver.json`.

## Why this is enough

The deterministic regression exercises the exact conflict identified in
review: an active claim whose age is sweep-eligible. The same test retains the
two-contender ordering assertion, so deleting the claim would allow the wrong
contender through. The full lock suite and live Senpi driver cover adjacent
locking behavior and the generated runtime surface.

## What was omitted

Dependency installation progress, full test progress, credentials, auth
headers, private configuration, and unrelated session content are omitted.
