# manualQa Matrix: fix-4163 Evidence Re-Audit

Verdict: PASS

## surfaceEvidence

| scenario id | criterion reference | surface | exact invocation | verdict | artifactRefs |
|---|---|---|---|---|---|
| S1 | `green-parent-wake-race-final.log`: 3 pass, 4 expect calls | Bun unit test log artifact plus current Bun rerun | `rg -n '3 pass|4 expect\\(\\) calls' .omo/evidence/20260705-fix-4163/green-parent-wake-race-final.log`; `/Users/yeongyu/.bun/bin/bun test packages/omo-opencode/src/hooks/todo-continuation-enforcer/parent-wake-race.test.ts` | PASS | A1, A12 |
| S2 | `red-parent-wake-race.log`: original two-case RED | Bun failing-first log artifact | `sed -n '1,220p' .omo/evidence/20260705-fix-4163/red-parent-wake-race.log` | PASS | A2 |
| S3 | pre-dispatch RED -> GREEN final guard | Bun failing-first and passing log artifacts | `sed -n '1,220p' .omo/evidence/20260705-fix-4163/red-pre-dispatch-parent-wake-race.log`; `sed -n '1,220p' .omo/evidence/20260705-fix-4163/green-pre-dispatch-parent-wake-race.log` | PASS | A3, A4 |
| S4 | `todo-continuation-suite-final.log`: 124 pass | Bun suite log artifact plus current Bun rerun | `rg -n '124 pass|0 fail|212 expect' .omo/evidence/20260705-fix-4163/todo-continuation-suite-final.log`; `/Users/yeongyu/.bun/bin/bun test packages/omo-opencode/src/hooks/todo-continuation-enforcer` | PASS | A5, A13 |
| S5 | `prompt-async-route-audit-final.log`: 10 pass | Bun prompt-route audit log artifact plus current Bun rerun | `rg -n '10 pass|0 fail|10 expect' .omo/evidence/20260705-fix-4163/prompt-async-route-audit-final.log`; `/Users/yeongyu/.bun/bin/bun test packages/omo-opencode/src/shared/prompt-async-route-audit.test.ts` | PASS | A6, A14 |
| S6 | `typecheck-final.log` exits 0 | Repository typecheck artifact plus current typecheck rerun | `sed -n '1,180p' .omo/evidence/20260705-fix-4163/typecheck-final.log`; `PATH=/Users/yeongyu/.bun/bin:$PATH /Users/yeongyu/.bun/bin/bun run typecheck` | PASS | A7, A15 |
| S7 | `no-excuse-final.log` says no violations | No-excuse log artifact | `sed -n '1,180p' .omo/evidence/20260705-fix-4163/no-excuse-final.log` | PASS | A8 |
| S8 | OpenCode QA common self-check proves isolated harness | OpenCode QA common harness log artifact | `sed -n '1,220p' .omo/evidence/20260705-fix-4163/opencode-qa-common-self-check-rerun.log` | PASS | A9 |
| S9 | OpenCode QA SSE self-test proves SSE surface | OpenCode QA SSE log artifact | `sed -n '1,220p' .omo/evidence/20260705-fix-4163/opencode-qa-sse-self-test.log` | PASS | A10 |
| S10 | OpenCode QA server smoke proves API surface | OpenCode QA server smoke log artifact | `sed -n '1,260p' .omo/evidence/20260705-fix-4163/opencode-qa-server-smoke.log` | PASS | A11 |
| S11 | `qa-summary.md` references final logs and justifies deterministic race test as faithful channel | QA summary markdown artifact | `rg -n 'green-parent-wake-race-final|red-parent-wake-race|red-pre-dispatch-parent-wake-race|green-pre-dispatch-parent-wake-race|todo-continuation-suite-final|prompt-async-route-audit-final|typecheck-final|no-excuse-final|opencode-qa-common-self-check-rerun|opencode-qa-sse-self-test|opencode-qa-server-smoke|deterministic|faithful|live' .omo/evidence/20260705-fix-4163/qa-summary.md` | PASS | A16 |

## adversarialCases

| scenario id | criterion reference | adversarial class | expected behavior | verdict | artifactRefs |
|---|---|---|---|---|---|
| AC1 | Current artifacts match current implementation | Stale green artifact | Current-tree reruns reproduce parent race, suite, prompt audit, and typecheck success rather than only relying on saved final logs | PASS | A12, A13, A14, A15 |
| AC2 | Failing-first evidence | False RED artifact or post-fix failure log mislabeled as RED | RED logs contain actual expectation failures with `Expected: 0` and `Received: 1` for the parent wake race windows | PASS | A2, A3 |
| AC3 | Final pre-dispatch guard | Partial fix that covers idle/post-countdown but misses dispatch-time race | Pre-dispatch RED shows third case failing; GREEN/final current rerun shows all three cases passing | PASS | A3, A4, A12 |
| AC4 | OpenCode faithful surfaces | Harness-only claims without isolation/API/SSE proof | Common self-check proves isolated XDG cleanup; SSE observes `server.connected`; server smoke proves `/global/health`, `/doc`, and HTTP 401 auth behavior | PASS | A9, A10, A11 |
| AC5 | Replay environment drift | Missing `bun` on shell PATH makes current rerun look like product failure | Failed PATH-only rerun is recorded, then absolute Bun/PATH-corrected reruns exit 0 | PASS | A17, A12, A15 |
| AC6 | Summary drift | Summary points at stale/non-final files or omits live repro rationale | Summary names the final artifacts and states the deterministic test is the faithful channel because it controls the race predicates without model nondeterminism | PASS | A16 |

## artifactRefs

| id | kind | description | path |
|---|---|---|---|
| A1 | log | Final green parent wake race artifact: 3 pass, 0 fail, 4 expect calls | `.omo/evidence/20260705-fix-4163/green-parent-wake-race-final.log` |
| A2 | log | Original two-case RED artifact with two expectation failures | `.omo/evidence/20260705-fix-4163/red-parent-wake-race.log` |
| A3 | log | Pre-dispatch RED artifact with third race case failing | `.omo/evidence/20260705-fix-4163/red-pre-dispatch-parent-wake-race.log` |
| A4 | log | Pre-dispatch GREEN artifact with all three race cases passing | `.omo/evidence/20260705-fix-4163/green-pre-dispatch-parent-wake-race.log` |
| A5 | log | Final full todo-continuation suite: 124 pass | `.omo/evidence/20260705-fix-4163/todo-continuation-suite-final.log` |
| A6 | log | Final prompt async route audit: 10 pass | `.omo/evidence/20260705-fix-4163/prompt-async-route-audit-final.log` |
| A7 | log | Final typecheck artifact with successful command transcript | `.omo/evidence/20260705-fix-4163/typecheck-final.log` |
| A8 | log | Final no-excuse artifact: no violations in 3 files | `.omo/evidence/20260705-fix-4163/no-excuse-final.log` |
| A9 | log | OpenCode QA common self-check rerun, including isolated XDG cleanup proof | `.omo/evidence/20260705-fix-4163/opencode-qa-common-self-check-rerun.log` |
| A10 | log | OpenCode QA SSE self-test observing `server.connected` | `.omo/evidence/20260705-fix-4163/opencode-qa-sse-self-test.log` |
| A11 | log | OpenCode QA server smoke proving health/doc/auth surfaces | `.omo/evidence/20260705-fix-4163/opencode-qa-server-smoke.log` |
| A12 | log | Current-tree parent wake race rerun with absolute Bun path: 3 pass, 4 expect, exit 0 | `.omo/evidence/20260705-fix-4163/re-audit-current/parent-wake-race-current-absolute-bun.log` |
| A13 | log | Current-tree todo-continuation suite rerun: 124 pass, exit 0 | `.omo/evidence/20260705-fix-4163/re-audit-current/todo-continuation-suite-current.log` |
| A14 | log | Current-tree prompt async route audit rerun: 10 pass, exit 0 | `.omo/evidence/20260705-fix-4163/re-audit-current/prompt-async-route-audit-current.log` |
| A15 | log | Current-tree typecheck rerun with Bun on PATH: exit 0 | `.omo/evidence/20260705-fix-4163/re-audit-current/typecheck-current-with-path.log` |
| A16 | markdown | QA summary referencing final logs and explaining deterministic faithful channel | `.omo/evidence/20260705-fix-4163/qa-summary.md` |
| A17 | log | Audit-only failed replay showing PATH-only `bun` was unavailable; not used as PASS evidence for product behavior | `.omo/evidence/20260705-fix-4163/re-audit-current/parent-wake-race-current.log` |
