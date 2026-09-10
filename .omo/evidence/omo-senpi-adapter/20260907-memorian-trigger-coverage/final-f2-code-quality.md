# F2 Code Quality Review — memorian trigger coverage (round 2)

- Diff under review: `git diff origin/dev...HEAD -- packages/memory-core/src packages/omo-senpi/src packages/omo-senpi/scripts/qa`
- Worktree: `/Volumes/mengmotaStorage/local-workspaces/omo-wt/memorian-trigger-coverage` (branch `feat/memorian-trigger-coverage`)
- Fix commit: `e7fd90c15` (`fix(omo-senpi): prefer path-derived recall terms and keep memorian outcome records truthful`)
- HEAD while reviewing: `5333314df` (plugin-bundle refresh only; `git diff e7fd90c15 HEAD -- packages/memory-core/src packages/omo-senpi/src packages/omo-senpi/scripts/qa` is empty)
- Merge-base: `origin/dev` `192f5bfb7`
- Round 1: `final-f2-code-quality-round1-BLOCK.md` (B1, B2, N1, N2, N3)
- Remote TDD: `task-9-f2-fixes.log` (RED 5 fail / 30 pass, then GREEN 69 pass / 0 fail)
- Plan: `.omo/plans/memorian-trigger-coverage-late-judge.md`
- Constraints honored: read-only except this file; no `bun test` on this machine; probes were `git`/`rg`/`awk`, `bunx tsgo --noEmit`, `node packages/omo-senpi/plugin/scripts/build-extension.mjs --check`, and read-only `bun` scripts that import worktree modules and write only under the system temp dir.

## Verdict

**APPROVE** — every round-1 blocker and the three named notes are fixed in `e7fd90c15`, confirmed by line citation and by independent probes that reproduce the round-1 failing cases as passes. The rest of the scoped diff is unchanged in substance from round 1 and still holds. Remaining items are notes, not ship blockers.

## Findings table

| item | verdict | exact evidence |
|---|---|---|
| B1 (round 1): AGENTS.md:82 false retention clause | **PASS (fixed)** | `AGENTS.md:82` is byte-identical to `origin/dev` (`git diff origin/dev...HEAD` has no "Run supervisor" hunk). Line 82 is the reflection/dream supervisor bullet with no prune clause. The true memorian policy remains on the intro line (`AGENTS.md:3`: "Memorian run directories carry `outcome.json` and are pruned after 7 days (30 for nudged, failed, or deadline runs)"). Probe: `L82 identical to origin/dev: True`; `has_false_clause False`. |
| B2 (round 1): planner did not prefer path-derived tool terms | **PASS (fixed)** | `planner.ts:23` `PATH_LIKE`; `:98-102` ranks `pathDerivedTerms` ahead of the existing `rankedTerms` order; `:109-116` marks a term path-derived when it appears in any tool text matching `/\/|\.[a-z0-9]{1,6}$/i`. Newest-first / rarity / length stay as secondary keys (stable 0-compare). `COMMAND_STOPWORDS` + user-single exclusion unchanged (`:100`). Round-1 MISS probes now HIT: user `"ok please continue"` + `["compaction.ts","compaction","const","console.log(x.length)"]` → singles `["continue","compaction","const"]` (`hasCompaction: true`); + `["export","deadline-salvage.md","deadline","salvage","await"]` → `["continue","deadline","salvage"]` (`hasDeadline: true`). New pins: `planner.test.ts` cargo-then-rollout.md → `["rollout","cargo"]`; cargo colliding with a user single leaves `toolSingles[0]==="rollout"` not `"console"`. Remote RED received `["cargo","rollout"]` / `"console"`; GREEN 69 pass. |
| B2 composition (harvest reverse + plan) | **PASS** | Path-primary sort makes reverse-of-flat no longer able to bury a filename. Probe harvest→`[...].reverse()`→plan, user `"ok please continue"`: eval starting with `Bun.file("/repo/src/planner.ts")` → singles `["continue","planner","console"]`; eval starting with `tool.read({ path: "rollout.md" })` → `["continue","rollout","void"]`; JS-keyword-heavy cell ending in `compaction.ts` → `["continue","compaction","await"]`. S6-shaped harvest+summary reverse head is `["neutral","rollout.md",...]` and queries still contain `"rollout"`. |
| N1 (round 1): outcome write before mkdir | **PASS (fixed)** | `memorian-run-retention.ts:64` `await mkdir(options.runDir, { recursive: true, mode: 0o700 })` before `writeFile` at `:65-68`. `record()` in `memorian-judge-run.ts:40-54` still wraps every terminal return; the writer now creates the dir if setup has not. Probe against a missing `run-x`: `outcomeExists: true`, `warns: []`, parsed `{ status: "dropped", cause: "deadline", nudged: [] }`. Remote RED: `existsSync(outcome.json) Expected: true Received: false`; GREEN includes that pin. |
| N2 (round 1): post-judge drop left `completed` outcome | **PASS (fixed)** | `memorian-runner.ts:180-183` (cancelled) and `:194-200` (cancelled or compaction) call `overwriteDroppedOutcome` (`:231-245`) which writes `{ status: "dropped", cause, nudged: [] }` into `join(identityPaths.recall, "runs", runId)` — the same path `memorian-judge-run.ts:40` uses. Failed/dropped judge results return at `:179` and are not rewritten (already truthful). Probe of the writer: completed+nudged then dropped/compaction → `{ status: "dropped", cause: "compaction", nudged: [] }`. Pin: `memorian-runner-compaction.test.ts:40-61`. Remote RED received `status completed / nudged ["reference/kubernetes-rollouts.md"]`; GREEN 69 pass. Dropped/compaction now ages as the 7-day class (`retentionMs` `:151-152`: not `failed`, not `dropped+deadline`, empty `nudged`). |
| N3 (round 1): empty run dir never pruned | **PASS (fixed)** | `memorian-run-retention.ts:158` `if (names.length === 0) return await mtime(dir)`. Non-empty dirs still use newest inner file (`:159-165`), so a live judge's fresh `candidates.json` still protects the dir. Probe: 400-day empty `empty-old` + 8-day dir with 1-minute-old file → `{ removed: 1, kept: 1 }`, `emptyOldExists: false`, `oldFileExists: true`. Fresh empty dir (1 minute) stays: `{ removed: 0, kept: 2 }`, `exists: true`. Remote RED: `{removed:0, kept:2}` vs expected `{removed:1, kept:1}`; GREEN 69 pass. |
| Planner: user-only path byte-identical | PASS | `planner.ts:92-94` early-return when `toolTexts` missing or empty. Differential probe of `origin/dev` planner vs HEAD over 10 fixtures (English, Korean, empty, empty-string, stopword-only, path-bearing): `userOnlyIdentical: true`, `emptyToolTextsIdentical: true`, `userOnlyMismatches: []`. |
| Planner: tool singles newest-first among path-derived | PASS | Probe `toolTexts: ["newer.ts","newer","older.ts","older","oldest.ts","oldest"]` → `["newer","older"]` (not `oldest`). Cap probe length `6`. Stoplist probe `["git","grep","printf"]` → `["checklist","continue"]`. |
| Salvage returns `completed+partial` only when `accepted.length>0` | PASS | `memorian-judge-run.ts:105` and `:113`: both deadline arms `if (accepted.length > 0) return await record({ status: "completed", partial: true })`. No other return sets `partial`. |
| Zero-accept deadline → `dropped`/`deadline` | PASS | Same arms `:107` / `:115`: `state.cancelled = true` then `record({ status: "dropped", cause: "deadline", ... })`. `MemorianGateFailureCause` at `memorian-runner.ts:86` has no `"deadline"`. |
| Abort preserved on both deadline branches | PASS | Setup arm `:100-101` aborts `host.handle` if set, then salvages. Turn arm `:112` `await abortAndDispose(settled, ...)` then `:113` salvage. `finally` `:129-135` still clears the timer and disposes `host.handle`. Setup completion after the deadline still hits `deadlineReached` in `setupResult` (`:84-86`) and aborts the late handle. |
| Compaction still drops a salvaged verdict | PASS | `memorian-runner.ts:194-200`: `isStaleAfterCompaction` runs after `validateNudges`; overwrite then `dropAfterCompaction`. Pins: `memorian-runner-completion.test.ts` deadline+epoch bump → `{ status: "dropped", cause: "compaction" }`; compaction test above also asserts the rewritten `outcome.json`. |
| Retention: rename-then-remove, ENOENT, 7d/30d, throttle | PASS | `claimAndRemove` `:176-192` rename to `.prune-<name>` then remove; tombstones swept first `:92-96`. ENOENT tolerated at `:80`, `:187`, `:204`. `retentionMs` `:149-152` uses 30 d for `failed`, `dropped+deadline`, and non-empty `nudged`. `createThrottledPrune` `:112-137` writes `.last-prune` before prune. Unchanged by the fix commit except the empty-dir mtime fallback. |
| Harvesting: per-token `isUsable`, secrets, `MAX_TOKENS` | PASS | Whole-argument `isUsable` gate is gone from `command`/`code` (`recall-query-planner-tools.ts:67-70`). Probes: 321-char command contains `deep-file.ts`; 100-path eval `cap100=32`; `export TOKEN='sk-abcdef...'` → `[]`; `cat notes.md && export TOKEN=sk-live-...` → `["notes.md","notes","cat"]`; Bearer curl → `[]`. No probe leaked `sk-` material. |
| Wiring: prune on settle, fire-and-forget, one pruner per recall dir | PASS | `wiring-memorian.ts:75-89` calls inner `onSettled` first, then `pruneFor(context.identityPaths.recall)()` in try/catch. Raw trigger is what `registerHooks` gets with `registerSettle: false` (`:93-97`). Pruner memoized by `recallDir` (`:47-58`). |
| E2E S6 RED→GREEN | PASS | `red-s6/driver-result.json`: `"ok": false`, s6 `"FAIL"`, `judgeRequests: 0`, `candidatePaths: []`, failing checks `s6.judge-accepted` (timeout 60000ms), `s6.judge-launched` (`recallRuns=0`), `s6.arg-harvested` (`candidates=none`). `green/driver-result.json`: `"ok": true`, s3–s6 `"PASS"`, s6 `judgeRequests: 2`, `candidatePaths: ["reference/kubernetes-rollouts.md"]`, each `realSenpiUntouched: true`. S6 subscribes `watch(...)` before `prompt(...)` (`memorian-tool-boundary-e2e-scenarios.mjs:210-219`); no `setTimeout`-as-sleep. |
| Type-system suppressions / 250-pure-LOC / bundle | PASS | Added-line scan of the scoped `*.ts` diff: `NO_BANNED`. `bunx tsgo --noEmit -p packages/omo-senpi/tsconfig.json` → `TSGO_SENPI=0`; same for memory-core → `TSGO_CORE=0`. Pure LOC: planner 144, retention 217, runner 204, judge-run 134, planner-tools 93, wiring-memorian 121, trigger 222, recall-wiring 186 — all ≤ 250. `node packages/omo-senpi/plugin/scripts/build-extension.mjs --check` → `omo-senpi extension build is current`, exit 0. No `.skip`/`.only`; no `setTimeout`/`Bun.sleep` on added test lines. |
| Dead code / misleading names in the fix commit | PASS with notes | No new dead production path. `overwriteDroppedOutcome` is used on both post-judge drop sites. `pathDerivedTerms` is the name the ranking uses. The inner cancelled arm at `memorian-runner.ts:195-197` is reachable only if `state.cancelled` flips during synchronous `validateNudges` after the check at `:180` — effectively dead; see Notes. The compaction pin's `if (name === undefined) return` (`memorian-runner-compaction.test.ts:58-59`) is TypeScript narrowing after `toBeDefined()`; bun's `expect` throws, so it does not swallow the outcome assertion. |
| Error swallowing | PASS | Outcome/prune catches still warn with a described error (`memorian-run-retention.ts:70`, `:81`, `:131`, `:188`, `:205`; `wiring-memorian.ts:84-88`). `overwriteDroppedOutcome` reuses that writer, so a failed rewrite cannot change the launch result. `readOutcome` / `mtime` / `markerIsFresh` fail into the documented 7-day / keep / fail-open behavior. No new bare `catch {}`. |

## Blockers

None.

Round-1 B1 violated plan todo 5 (docs scope) and stated a retention behavior the supervisor tree does not implement. Reverted.

Round-1 B2 violated plan todo 8(a) ("preferring path-derived words over command names"). Implemented as a primary sort key on the tool-single pool; the round-1 MISS fixtures and the harvest→reverse→plan composition now keep the filename.

## Notes (non-blocking)

**Residual of N2 — `status: "empty"` still leaves a `completed` outcome.** `memorian-runner.ts:192` `if (nudges.length === 0) return { status: "empty" }` runs after the judge has already recorded `completed` with `accepted.map(nudge => nudge.path)` (`memorian-judge-run.ts:50`). Cancelled and compaction now overwrite; a re-validation that strips every accepted path does not. Rare (the closure already validated), and it is not the round-1 drop path.

**Cancelled outcome rewrite is implemented but not pinned.** Compaction is pinned (`memorian-runner-compaction.test.ts:40-61`). Lifecycle tests still only assert the launch result `{ status: "dropped", cause: "cancelled" }`. The cancelled overwrite at `:180-183` is the race where `cancel()` lands after `record({ status: "completed" })` and before the post-judge check; judge-run's own cancelled arms (`:102`, `:124`) already write `dropped/cancelled` when cancel wins inside the judge.

**`overwriteDroppedOutcome` duplicates the `"runs"` segment** (`memorian-runner.ts:237`) instead of sharing `RUNS_DIRNAME` (`memorian-run-retention.ts:21`). `memorian-judge-run.ts:40` already inlined the same join; the new helper matches it. Drift would write the rewrite next to a different tree than the judge.

**Inner cancelled branch is redundant** (`memorian-runner.ts:195-197`). There is no `await` between `:180` and `:194` other than the cancelled overwrite return. A later reader may think cancel-during-validate is a supported window; it is not.

**Carry-forward from round 1, still true, still non-blocking:**

- `wiring-memorian.ts:75-89` re-lists every `MemorianTrigger` member (`memorian-trigger.ts:49-55`). Type-checked today (`tsgo` exit 0). `{ ...trigger, onSettled }` would not drift.
- `s6.tool-fixture` (`memorian-tool-boundary-e2e-scenarios.mjs:204`) asserts properties of the module constant `EVAL_LONG_CODE` (`:21-34`). Production code cannot make it fail. Real proof is `s6.arg-harvested` (`:242`).
- `s6.judge-launched` (`:241`) is implied by `s6.arg-harvested`. Harmless; it is why RED says `recallRuns=0`.
- `watcher` / `timer` are assigned inside the `new Promise` executor (`:211-218`) and closed unguarded in `finally` (`:227-228`). A synchronous `watch()` throw would surface as `TypeError` from `finally`. QA-only.
- `PRUNE_TOMBSTONE_PREFIX` is re-declared (`memorian-run-retention.ts:18` vs `facts-run-cleanup.ts:21`). Two sources of truth for the tombstone prefix.
- `memorian-run-retention.test.ts:141-154` ages a `status: "failed"` dir by 6 days, which the 7-day class would also keep. The 20-day dropped/deadline pin (`:118-139`) is what actually proves the 30-day class. The fixture still uses `cause: "deadline"` on `failed`, a combo todo 7 no longer produces.
- `AGENTS.md:30` still says `memorian-judge-outcome.ts` classifies `session_create_failed` / `launch_failed` / `compaction` / `deadline`. `classifyJudgeTurn` (`memorian-judge-outcome.ts:12-18`) still only maps completed / cancelled / child_failed. Deadline lives in `memorian-judge-run.ts`; compaction overwrite lives in `memorian-runner.ts`. Todo 7(F) asked for that row; it is a misleading module blurb, not a scope break.
- S6 exercises `eval`/`code`, not `bash`/`command`. Disclosed at `memorian-tool-boundary-e2e-scenarios.mjs:19-21`. The long-`command` harvest remains a unit pin (`recall-query-planner-tools.test.ts` 300-char `deep-file.ts`).
- Segment-level secret pre-filter (`recall-query-planner-tools.ts:35`) is stricter than the plan's per-token rule; `curl -H 'Authorization: Bearer …' https://x/y/notes.md` yields `[]`. Safe-side.

**`pathDerivedTerms` is an approximation, not harvest's `pathWords`.** Any token inside a PATH_LIKE text is preferred, including directory components (`src` from `src/foo.ts`) and `pipe` from S6's `checkpoint.pipe`. That is why the S6 reverse head `neutral` loses the tool slot to `rollout` and `pipe` — which is the preference working. `console.log` as a whole text would match `.log` and mark `console` path-derived; realistic harvest emits `console.log(x.length)`, which does not match, and the B2 probes keep `compaction`/`planner`/`rollout` ahead of it.

## Verification performed

| check | command / source | result |
|---|---|---|
| Typecheck omo-senpi | `bunx tsgo --noEmit -p packages/omo-senpi/tsconfig.json` | `TSGO_SENPI=0` |
| Typecheck memory-core | `bunx tsgo --noEmit -p packages/memory-core/tsconfig.json` | `TSGO_CORE=0` |
| Bundle freshness | `node packages/omo-senpi/plugin/scripts/build-extension.mjs --check` | `omo-senpi extension build is current`, exit 0 |
| Banned constructs on added lines | `git diff origin/dev...HEAD -- '*.ts' \| grep '^+' \| grep -E 'as [A-Z]\|@ts-ignore\|: any\b\|…'` | `NO_BANNED` |
| Pure LOC | `awk '!/^[[:space:]]*$/ && !/^[[:space:]]*\/\//' <file> \| wc -l` | planner 144, retention 217, runner 204; max 222 (`memorian-trigger.ts`) |
| B1 docs | `AGENTS.md:82` vs `origin/dev`; intro `:3` | supervisor bullet restored; memorian policy on intro only |
| B2 planner + harvest→reverse→plan | bun import of HEAD `planner.ts` + `recall-query-planner-tools.ts` | round-1 MISS fixtures HIT; user-only identical to `origin/dev` on 10 fixtures |
| N1 / N2 writer / N3 prune | bun import of `writeMemorianRunOutcome` / `pruneMemorianRuns`; mkdtemp under system temp | missing `runDir` creates `outcome.json`; overwrite compaction truthful; 400-day empty dir removed, fresh-file dir kept, 1-minute empty dir kept |
| Secrets / MAX_TOKENS / long command | same bun probe | no `sk-` leak; `cap100=32`; `deep-file.ts` present |
| Live S3–S6 | read `green/driver-result.json`, `red-s6/driver-result.json` | green `"ok": true`, s3–s6 PASS, s6 seed path; red-s6 FAIL `judgeRequests=0` |
| Remote unit TDD for the five fixes | read `task-9-f2-fixes.log` | RED 5 fail (exactly the new pins); GREEN 69 pass / 0 fail across 6 files; `TSGO_SENPI=0` `TSGO_CORE=0` |

No `bun test` was executed on this machine.
