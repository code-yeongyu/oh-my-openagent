# Evidence - issue #7339: bug(omo-task): worker creation can crash host before barrels load

Worktree: /home/viprix/projects/oom-wt-7339 (branch fix/7339-worker-barrel-load-crash, base 8c57e463e on origin/dev). Deliberately LEFT DIRTY: no commit, no push, no PR.

## WHAT WAS TESTED

1. RED probes (fresh `bun run` processes that ignore `[test] preload`, so both lazy barrels start genuinely cold; each self-reports its cold start):
   - Probe A (`packages/omo-senpi/src/components/task/__fixtures__/register-cold-pi-tui-probe.ts`): registers ONLY createTaskComponent (compose never imported), then fires the debounced status-widget render by hand. Reproduces the issue's exact crash chain (worker spawn -> store mutation -> 250 ms timer -> row formatting -> piTui()).
   - Probe B (`packages/senpi-task/src/dag/__fixtures__/dag-start-cold-barrel-probe.ts`): dag start of a definition whose node carries `load_skills`, through the real materializer + default filesystem skill loader.
   - Bundle assertion (`bundle-pi-tui-loader.test.ts`): the built omo-task.js must retain the pi-tui dynamic import.
2. GREEN re-runs of both probes after the fix, plus the focused suites.
3. Gates: focused tests x2 consecutive clean runs (254 tests across 22 files: full packages/senpi-task/src/dag suite incl. scheduler/node-retry/e2e + the new and adjacent omo-senpi tests), `bunx tsgo --noEmit` for packages/senpi-task and packages/omo-senpi, `git diff --check`, hygiene scan (no any / ts-ignore / ts-expect-error / non-null assertions / em dashes / AI filler in changed files).
4. Artifact QA: drove the REBUILT plugin/extensions/omo-task.js in an isolated sandbox (/tmp/opencode/omo-7339-qa with cwd + HOME inside it): registered the component from the shipped bundle, listed registered tools, rendered a task-completion notice through the bundle's OWN lazy boundary.

## WHAT WAS OBSERVED

- RED probe A: {"coldBeforeRegister":true,"widgetRendered":false,"error":"The @earendil-works/pi-tui barrel was accessed before it was loaded. Await loadPiTui() at the registration entry point before reading pi-tui values synchronously."} - the issue's exact error, thrown on the timer render path with only the task component registered.
- RED probe B: {"coldBeforeStart":true,"started":false,"error":"The @code-yeongyu/senpi barrel was accessed before it was loaded. Await loadSenpiBarrel() at the async entry point that leads here before reading barrel values synchronously."} - dag start rejected BEFORE dispatch.
- RED bundle assertion: built omo-task.js contained ZERO import("@earendil-works/pi-tui") and an UNCONDITIONAL throw (loader dead-code-eliminated) - logs/red-probe-b-bundle.log.
- GREEN probes: A renders the widget; B starts the run and reports the missing_skill diagnostic through the warmed barrel.
- Focused suites: 27 pass x2 (pre-widening), then 254 pass x2 consecutive after the wave-1 audit widened coverage to the full dag suite. tsgo both packages CLEAN. git diff --check CLEAN.
- Artifact QA: all 11 tools registered from the rebuilt bundle ("task","task_send","task_cancel","task_output","dag",6 team tools); completion renderer present; pi-tui Box render returned styled lines through the bundle's own boundary - no throw.
- Isolation proof: ~/.omo mtime 1787700397 and ~/.senpi mtime 1786319605 identical before/after every QA action; writes landed only under /tmp/opencode/omo-7339-qa (cwd/.omo state dir + bun cache under the sandbox HOME).

## WHY IT IS ENOUGH

The two probes pin BOTH reported failure flavors at their true root causes, in fresh processes so the test preloads cannot mask them; the bundle assertion pins the bundler-level mechanism (loader retention) that made beta.20 ship an unconditional throw; the artifact QA proves the SHIPPED FILE is fixed, not just the source; the widened dag suite covers the retry/amend seam the wave-1 audit found adjacent to the fix.

## ROOT CAUSE (summary)

1. pi-tui: bb2af9c96 moved the single loadPiTui() warm-up from the task component into composeOmoSenpiExtension. omo.js and omo-task.js are SEPARATE bundles, each embedding its own copy of the lazy module's memoized state; compose's warm-up can only warm omo.js's copy. With no in-graph caller left in omo-task.js, the bundler eliminated the loader and constant-folded piTui() into an unconditional throw. Worker creation -> store mutation -> debounced status-widget timer -> row helpers -> throw inside Timeout._onTimeout -> uncaught -> host exit (the issue stack).
2. senpi barrel: dag start/amend materialize node skills synchronously through the default fs skill loader whose discovery reads senpiBarrel().loadSkillsFromDir; nothing on that path awaited loadSenpiBarrel(), so a cold barrel rejected the run before dispatch.

## FIX (changed files)

- packages/omo-senpi/src/components/task/index.ts: restore `await loadPiTui()` at the top of register() (after the member-process guard), with the cross-bundle rationale documented.
- packages/senpi-task/src/dag/manager.ts: start/amend await loadSenpiBarrel() when a materializer is configured AND the barrel is not already loaded (isSenpiBarrelLoaded() fast-path keeps the warm path synchronous - required by node-retry's `void manager.amend(...)` + synchronous checkpoint read).
- packages/senpi-task/src/lazy/senpi-barrel.ts: add isSenpiBarrelLoaded().
- packages/senpi-task/src/lazy/pi-tui.ts + packages/omo-senpi/src/extension/compose.ts + packages/senpi-task/src/tools/task/skills.ts: correct stale warm-up-contract comments (per-bundle copies; full list of awaiting entry points).
- packages/omo-senpi/plugin/extensions/omo.js + omo-task.js: regenerated tracked bundles (omo-task.js again contains the loader).
- New tests: register-warms-pi-tui.test.ts, bundle-pi-tui-loader.test.ts, manager-cold-barrel.test.ts + two probe fixtures.

Diffstat: 8 files changed, 77 insertions(+), 34 deletions(-) plus 5 new untracked source/test files.

## BLOCKERS / HONEST LIMITATIONS

- LIVE senpi harness QA NOT RUN: no `senpi` binary exists on this machine, so task-e2e.mjs / team-e2e.mjs could not drive the real engine. This is documented as a blocker, not a pass. Compensation: the artifact-level QA above drives the actual rebuilt extension bundle end-to-end for registration + rendering.
- Toolchain drift: this environment has bun 1.3.14 while CI builds bundles with bun 1.4.0. All six artifacts were rebuilt locally; the four whose sources did not change (omo-member.js, omo-memory-mcp.js, advisor, supervisor) were REVERTED to HEAD because their bodies differed purely from toolchain drift. Residual risk: CI's `build-extension.mjs --check` rebuilds in its own toolchain; if bytes differ from these locally rebuilt omo.js/omo-task.js, the freshness gate will flag them and the bundles must be regenerated on the CI toolchain. This follows repo precedent (bb2af9c96 committed a dev-machine-rebuilt omo.js).
- Cold-barrel dag node prompt override (node-retry amendRetryPrompt) already failed BEFORE this fix (swallowed barrel throw -> "prompt override was rejected"); with the fix the observable outcome on a cold barrel is unchanged (the sync fast-path cannot help before the first load), and the warm path is byte-for-byte behavior-preserving. The host can no longer die on that path because the throw now happens only as a swallowed promise rejection, exactly as before.
- The `bun run test:senpi` full package gate was not executed end-to-end here (it chains build+stage+typecheck+tests; the build/stage steps ran individually and the equivalent checks are logged), partially due to time budget and the toolchain drift above; gates.log records each constituent check passing individually.

## WHAT WAS OMITTED

No secrets, tokens, or auth material appear in any log. Sandbox paths and mtimes are recorded verbatim; nothing redacted because nothing sensitive was captured.

## FILES

- plan.md - pre-edit implementation plan
- logs/red-probe-a.log, logs/red-probe-b-bundle.log - failing-first proof
- logs/green-probes.log, logs/green-focused-x2.log, logs/gates.log - green proof
- logs/qa-artifact.log - artifact QA transcript + isolation proof
- audit-ledger.md - self-audit waves
- cleanup-receipt.md - leftover process/sandbox accounting
