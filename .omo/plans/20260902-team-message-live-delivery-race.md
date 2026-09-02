# Team live-delivery idle-race repair

## Goal

Repair the Windows timeout in `createTeamSendMessageTool > #given transform already listed a peer message while recipient becomes idle #when live delivery races it #then only the live prompt receives the message` without increasing time budgets, polling, sleeps, retries, or platform skips.

## Evidence gathered

- `origin/dev` is `1291b02c1b8d3d8d479e2c309bd083bea6d3f36e`.
- Post-merge run `33612304861`, Windows root shard `100190136873`, failed only this test after 5659.47ms at Bun's 5000ms default; 8982 passed and 4 skipped.
- Merged PR #7643 changed the separate `generic fallback wakes cover two messages` test by giving only that test a Windows 15s outer timeout. It did not modify this race test or live-delivery production code.
- The affected test awaited `pollAndBuildInjection` inside the third test-local `loadRuntimeState` invocation. That nested transform enters `transitionRuntimeState` and its `state.lock` while live delivery waits for the dependency, with no explicit phase signal; it is the exact fixture await that can consume the Windows outer 5-second budget. The production delivery path already reserves the mailbox atomically before prompt dispatch.

## Atomic checklist

1. [x] Create a fresh task-owned worktree from the requested `origin/dev` SHA and read repository, roadmap, PR, QA, and test instructions.
2. [x] Trace send -> reservation -> live dispatch -> pending acknowledgement and the mailbox-transform / idle paths; compare #7643 and surrounding tests.
3. [x] Replace call-count choreography with explicit mailbox-reservation, transform, idle-status, and prompt events. The transform starts from the observed `.delivering-*` entry and is awaited only by the idle-status boundary.
4. [x] Capture RED evidence by mutating the delivery-reservation invariant in the worktree only; restore the production implementation before GREEN verification.
5. [x] Run task-worktree LSP diagnostics, focused race plus adjacent messaging/team-mode tests, package typecheck, root typecheck/test/build, and isolated real OpenCode QA. Record sanitized evidence. The root suite's seven failures reproduce with the changed test restored and are recorded separately.
6. [ ] Commit the minimal implementation, test, plan, and evidence; push an English PR to `dev`; apply `ci:full-matrix`.
7. [ ] Wait for the final-head Windows root and Senpi jobs plus Cubic, repair all findings, and leave the PR unmerged as requested.
