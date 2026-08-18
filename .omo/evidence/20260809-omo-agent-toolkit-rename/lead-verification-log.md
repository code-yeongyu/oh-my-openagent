# Lead verification log (independent checks, not subagent claims)

## 2026-08-09 - branch setup
- Worktree: .local-ignore/worktrees/omo-agent-toolkit-rename, branch feat/omo-agent-toolkit-rename off origin/dev @ 8b33ac959.
- Plan was written at 76b9aa8d3 -> line drift expected; lead re-verified todo-3 refs and found TWO drifts, handed corrected numbers to the todo-3 child: doctor/checks/codex.ts `!summary.linkedBins.includes("omo")` is :123 (plan said :127-135); install-codex.ts degraded warning is :107 (plan said :103). All other todo-3 refs confirmed at plan positions.

## Hit-ledger correction (supersedes the planning-session number)
- Regenerated at head 8b33ac959 for BOTH regexes into .omo/drafts/omo-agent-toolkit-rename-hit-ledger.json.
- AGENT regex /\bomo (ulw-loop|boulder)\b/: 55 files / 142 hits.
- HUMAN regex /\bomo (install|uninstall|cleanup|doctor|run|get-local-version|version|mcp)\b/: 21 files / 39 hits.
- CORRECTION: the planning-session figure "286 hits" was an artifact of counting with String.split() on a regex WITH a capture group (captures land in the split array and inflate the count). The true agent-regex count is 142. The plan's todo-4 prose still says 56 files/286 hits; the regenerated ledger JSON is authoritative and the todo-4 child will be pointed at it.

## CRITICAL finding fed back into a running child (todo 5)
- publish.yml contains a PUBLISHED-SMOKE section invoking the CLI through the `omo` BIN:
  `npx --yes --package oh-my-openagent omo install --platform=codex --no-tui --codex-autonomous` and `npx --yes --package oh-my-openagent omo doctor`.
  Removing the `omo` bin (todo 1) breaks these at runtime - they must become `omo-agent-toolkit`.
- script/lazycodex-published-smoke-workflow.test.ts PINS those strings (assertions ~:37-47 incl. a negative legacy-shape assertion) and was in NO todo's scope.
- Action: steered the running todo-5 child with a one-file scope extension (that test) + the migration requirement + RED/GREEN evidence for it.

## Other human-regex sites for the todo-4 child (not in the plan's enumerated list)
- packages/omo-opencode/src/cli/cleanup-command.ts:30,32,33 (help examples `$ omo uninstall|cleanup --platform=codex`)
- packages/omo-opencode/src/cli/cli-program.ts:125 (`$ omo install ...`) and :251 (`$ omo doctor --platform=codex`)
- packages/omo-codex/scripts/install-local-entrypoint.test.mjs (4), install-delegated-command.test.mjs (2), install-config.test.mjs (1)
- packages/omo-opencode/src/cli/install-platform-resolution.test.ts (2), packages/omo-codex/src/install/{codex-config-toml,lazycodex-routing}.test.ts (1 each)
- docs/guide/installation.md (4), README.md (2), docs/reference/cli.md (2), docs/reference/codex-telemetry.md (2), packages/omo-codex/README.md (1), .agents/skills/codex-qa/SKILL.md (1)

## LEAD STEERING ERROR - retracted after child pushback (this is the audit trail)
I steered todo-5 to migrate `--package oh-my-openagent omo` invocations in publish.yml and to update script/lazycodex-published-smoke-workflow.test.ts. The child REFUSED and demanded verification first. It was right; I verified every claim myself:
- `grep -c -- '--package oh-my-openagent' .github/workflows/publish.yml` -> 0 (that shape was removed in 9c6d1373f). publish.yml's smoke uses `npx -y "$package_spec" ...`.
- script/lazycodex-published-smoke-workflow.test.ts:6 reads `../.github/workflows/ci.yml`, NOT publish.yml.
- Its `--package oh-my-openagent omo` literals are NEGATIVE guards (`removedStrictInstallGate`, `rejectsLegacyInstallShape`, `removedStrictDoctorGate` are all `!workflow.includes(...)`). Migrating them would have silently retired Windows-regression protection.
VERDICT: steering RETRACTED in full. Lesson recorded: a child's evidence-backed refusal outranks the lead's unverified premise.

## REAL GAP found by todo-5, verified by me, routed to todo-3
- packages/omo-codex/src/install/lazycodex-delegated-command.ts:54 builds `["--yes","--package","oh-my-openagent","omo", parsed.command]` -> runs the `omo` BIN that todo 1 just deleted; every delegated `cleanup`/`ulw-loop` command would 127 at runtime after release.
- Pinned by packages/omo-codex/scripts/install-delegated-command.test.mjs:242 and install-local-entrypoint.test.mjs:156,:171,:186,:343 (all inside todo-3's existing scope).
- Routed to todo-3 with TDD instructions. NOT in the original plan - a genuine plan gap caught during execution.

## Scope extension granted to todo-5 (verified necessary)
- script/publish-lazycodex-workflow.test.ts:333-339 `installsRealPackageAndVerifiesOmoBin` POSITIVELY pins `[ -x "$CODEX_LOCAL_BIN_DIR/omo" ]`, `omo --version`, `omo ulw-loop --help` -> todo-5's publish.yml rewrite turns it RED. Granted as the lockstep partner, with an explicit order to preserve the file's negative guards (e.g. `!smokeStep.includes("npx --yes --package oh-my-openagent omo install")`).

## LEAD-VERIFIED: todo 1 and todo 2 (not accepted on child report)
- Read the diffs myself: package.json bin map swap (`omo` removed, `omo-agent-toolkit` -> bin/oh-my-opencode.js); cli-program.ts resolveInstallArgs reads OMO_EDITION BEFORE the name checks; doctor-target.ts returns "codex" on OMO_EDITION=codex after the explicit-platform guard; omo-command.ts resolveOmoBin is the THREE-link chain with NO bare-`omo` PATH lookup (comment pins why) and toSpawnTarget's `.js` branch precedes the win32 .cmd wrap.
- Ran the tests myself: `bun test packages/omo-senpi/src/components/ulw-loop script/bin-map.test.ts packages/omo-opencode/src/cli/install-platform-resolution.test.ts packages/omo-opencode/src/cli/doctor/doctor-target.test.ts script/build-binaries.test.ts` -> 87 pass / 0 fail / 222 expect() across 10 files.
- Ran the jq checks myself: `.bin.omo` absent (exit 1); `.bin["omo-agent-toolkit"]` = bin/oh-my-opencode.js.
- todo-1 self-reported drift, which I accept as accurate: doctor-target.test.ts lives at doctor/doctor-target.test.ts (not doctor/framework/); resolveInstallArgs body at :57-58; package-layout.test.ts does not enumerate bin names (no update needed).

## Generated-artifact noise to strip before commit (lead finding)
- packages/omo-codex/plugin/components/codegraph/dist/{cli,serve}.js and packages/omo-senpi/plugin/extensions/omo.js are dirty with pure BUNDLER CHURN (export reordering / minified renames from a differing dependency state). Verified non-semantic: neither old nor new contains OMO_AGENT_TOOLKIT_BIN or omo-agent-toolkit; codegraph is untouched by this change.
- ACTION AT COMMIT TIME: revert these unless a lane proves a semantic need, so the PR carries no unrelated 228-line bundle churn.

## Commits landed (lead, after independent verification of each lane)
- 2d4e0ce86 `feat(cli)!: rename omo bin to omo-agent-toolkit` - todo 1 lane + its baseline/after characterization evidence (evidence force-added past the `.omo/*` gitignore, matching the repo's existing tracked evidence convention).
- 3715b8e16 `feat(omo-senpi): resolve omo-agent-toolkit first with js-target-aware spawn` - todo 2 lane + task-2 evidence.
- Both staged by EXPLICIT paths so the in-flight todo-3/todo-5 edits and the generated-bundle churn stay out of them.

## Lead early-verification of todo-3 (in-flight diff read, pre-completion)
Checked by reading the working diff directly, not the child's report:
- ROUTED GAP FIXED CORRECTLY: lazycodex-delegated-command.ts now builds `["--yes","--package","oh-my-openagent","omo-agent-toolkit", parsed.command]`. The child ALSO found a second site I had not flagged - the delegated invocation env `OMO_INVOCATION_NAME: "omo"` -> `"omo-agent-toolkit"` - and migrated it.
- RESERVED_NESTED_BIN_NAMES keeps "omo" AND adds "omo-agent-toolkit" (anti-squatting preserved, as specified).
- linkRootRuntimeBin: writes only `omo-agent-toolkit`(.cmd) via a parametrized binName, and calls removeGeneratedRuntimeWrapper(legacyPath) on EVERY path - including the early return when dist/cli is missing, so a degraded payload still cleans up the stale wrapper. Better than the plan's minimum.
- removeGeneratedRuntimeWrapper is correctly marker-guarded: lstat -> isFile check -> content.includes(RUNTIME_WRAPPER_MARKER) -> rm; ENOENT swallowed. An unmarked user-owned `omo` is left untouched and no error is raised, exactly as required.
- Wrapper content exports BOTH `OMO_INVOCATION_NAME=<binName>` and `OMO_EDITION=codex` on posix AND windows.
- Doctor: wrapperPath -> omo-agent-toolkit(.cmd); NEW legacy-wrapper detection reading the legacy path in parallel and raising "Legacy omo runtime wrapper is still installed" (warning + reinstall fix) only when the marker is present; CODEX_BIN_NAMES "omo" -> "omo-agent-toolkit"; linkedBins guard + titles flipped.
STATUS: implementation matches spec; still pending the child's own test/QA run, after which the lead re-runs `bun run test:codex`, the doctor tests, and an INDEPENDENT isolated-install QA before this lane is accepted.

## Parallelism decision settled with evidence (not a guess)
Question: can todo-4 (command-string migration + skill syncs) run concurrently with todo-3 (codex wrapper + regeneration)?
Answer: NO. `packages/omo-codex/plugin/package.json` `build` chains `sync-skills.mjs` BEFORE `build-components.mjs`, and sync-skills.mjs:249 does `rm(skillsRoot, { recursive: true, force: true })` before re-copying. So todo-3's regeneration and todo-4's sync both destroy-and-rewrite the same skills tree. Concurrent execution would be destructive; todo-4 stays queued behind todo-3. (Wave A's three lanes were genuinely disjoint, which is why they ran together safely.)

## Lead-owned independent codex QA script prepared
- .omo/evidence/20260809-omo-agent-toolkit-rename/lead-codex-qa.sh (bash -n clean, executable).
- Deliberately NOT the child's script - the objective requires the lead to re-run QA itself. Six scenarios: clean install (canonical present with marker + BOTH env exports, `omo` absent), marker-bearing legacy `omo` DELETED, unmarked user `omo` preserved byte-identical with exit 0, idempotent second install (bin-set + canonical hash unchanged), codex hook-wiring hash unchanged across every install, and a final bin-dir listing. Ends with rm -rf of the disposable ROOT plus a verified cleanup receipt.

## Generated-artifact verdict REVISED (re-checked after the sync ran)
Earlier I classified BOTH `packages/omo-senpi/plugin/extensions/omo.js` and `packages/omo-codex/plugin/components/codegraph/dist/*.js` as pure bundler churn and reverted them. After todo-4's syncs/build-extension ran, I re-measured instead of trusting the earlier verdict:
- extensions/omo.js: now contains 2 occurrences of `omo-agent-toolkit ulw-loop` (HEAD version: 0) and 0 occurrences of the stale `"Continue the active omo ulw-loop run."`. The bundle embeds the senpi continuation strings migrated in 123cf7d7d, so this regeneration is SEMANTIC and MUST be committed.
- codegraph/dist/{cli,serve}.js: still 0 occurrences of omo-agent-toolkit; codegraph is untouched by this change. Still pure churn -> revert before commit.
LESSON: a generated file's classification is not stable across the run; re-measure after each regeneration rather than reusing an earlier verdict.

## Lead-run npm-side QA (todo 6, npm half) - 10/10 PASS
Script: .omo/evidence/20260809-omo-agent-toolkit-rename/lead-npm-qa.sh (lead-owned, isolated --prefix under one mktemp ROOT). Transcript: task-6-npm-lead.txt
- packed tarball bin map = exactly {lazycodex, lazycodex-ai, oh-my-openagent, oh-my-opencode, omo-agent-toolkit}; NO omo.
- fresh isolated global install links omo-agent-toolkit and does NOT link omo.
- postinstall rename notice appears exactly once under `--foreground-scripts` (confirming the best-effort visibility claim the plan makes).
- UPGRADE-IN-PLACE PROVEN EMPIRICALLY: installing the PUBLISHED oh-my-opencode@latest into a disposable prefix DOES link an `omo` bin; installing this build over it PRUNES that bin and links omo-agent-toolkit. This is the architect's "verify npm prune behavior instead of assuming it" requirement, measured rather than asserted.
- Cleanup receipt: ROOT removed and verified absent.
NOTE: the first run reported 2 failures that were bugs in MY script (mangled jq quoting inside the eval-based check helper, and a hand-sorted expected array that disagreed with `jq keys` ordering). Fixed both and re-ran to 10/10 - a spuriously failing assertion is not evidence.

## Pre-sync conflict analysis (dev moved 7 commits under us: 8b33ac959 -> bfd445cae)
dev's new commits touch 14 files; our branch touches 109. Predicted conflict surface is small and known BEFORE attempting the sync:
- README.md - dev swapped the rock logo for a light mark (5c977be07); we rewrote the `npx omo` warning + uninstall block. Textual conflict expected; resolution keeps BOTH (their logo line, our command rename).
- packages/omo-senpi/AGENTS.md - dev's 613591ea1/f13bcbb17 touched it; todo-4 part 2 is migrating its command strings. Conflict expected; keep both.
- packages/omo-senpi/plugin/extensions/omo.js - dev regenerated it (613591ea1 renamed resumption_channel_state -> wake_source_state); we regenerate it too. This is a GENERATED bundle: do NOT hand-resolve. Take either side, then re-run `node packages/omo-senpi/plugin/scripts/build-extension.mjs` and commit the regenerated result.
- packages/omo-senpi/plugin/scripts/sync-skills.mjs and packages/shared-skills/skills/start-work/SKILL.md changed on dev but NOT on our branch (we edited ulw-loop/ulw-plan/ulw-research skill sources) - no conflict, but the syncs must be re-run after the sync so start-work's dev-side change propagates with ours.
PLAN: sync only AFTER todo-4 part 2 finishes (rewriting history under a working child would corrupt its edits); use the smart-rebase skill if git reports conflicts, then re-run the syncs + the full gates + both lead QA scripts on the post-sync tree.

## Root gate mid-flight reading (lead-run `bun test`, full suite)
- Result: 13449 pass / 5 skip / 1 FAIL / 128747 expect() across 1735 files in 166s.
- The ONLY failure is `agent command string audit > #given tracked source files #when legacy agent and human commands are scanned #then every hit is categorized` - the audit test todo-4 part 2 is still writing, whose allowlist is intentionally empty while its migration is in progress. That is the expected RED state, not a regression.
- Everything else on the six committed lanes (bin map, senpi resolver, prompt/help strings, docs/publish, skill sources, codex wrapper) is green in the same run.
- The full gate will be re-run on the FINAL tree after todo-4 part 2 lands and after the dev sync.

## POST-SYNC re-verification (after rebasing onto the 7 new dev commits)
The whole point of re-running these AFTER the rebase is that a sync can silently break what passed before it.
- Rebase conflict surface was exactly as predicted: ONLY packages/omo-senpi/plugin/extensions/omo.js (generated). AGENTS.md and README.md auto-merged. Resolved by REGENERATING via build-extension.mjs rather than hand-merging; verified the result carries BOTH sides (2x `omo-agent-toolkit ulw-loop` from our rename AND dev's `wake_source_state` rename) with 0 stale emits.
- Branch: 7 commits on top of origin/dev, 0 behind, clean tree, pushed as feat/omo-agent-toolkit-rename.
- lead-codex-qa.sh POST-SYNC: 13 passed / 0 failed, isolation proof recorded, cleanup receipt verified.
- lead-npm-qa.sh POST-SYNC: 10 passed / 0 failed (transcript: task-6-npm-lead-postsync.txt) - packed bin map exactly the five surviving names, fresh install links no omo, postinstall notice visible under --foreground-scripts, and the published-package upgrade still PRUNES the stale omo bin.
- PR opened: https://github.com/code-yeongyu/oh-my-openagent/pull/6667 (base dev, per repo law; master-targeting PRs are hard-blocked).
