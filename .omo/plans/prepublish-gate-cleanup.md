# Prepublish Gate Cleanup — Senpi flag-gate, payload hygiene, gate fixes

## TL;DR
> Summary:      Deactivate the public Senpi surface behind a purpose-built env flag and remove its payload from the root npm tarball (blocker 3), fix LazyCodex payload hygiene (workflow-selector residue + nested node_modules — blocker 4), and tidy the remaining publish-gate defects (serve.js recurring mode-bit dirt, Senpi/Pi leakage in generated release notes).
> Deliverables: senpi-platform-flag module + CLI/TUI gating; root files[] senpi removal + flipped contract test; publish.yml lazycodex files-override negations; script/verify-npm-payload.mjs pack-time guard wired into both publish paths; static containment test; serve.js tracked as 755; changelog Senpi/Pi filter + tests; QA evidence under .omo/evidence/20260707-gate-cleanup/.
> Effort:       Medium
> Risk:         Medium - touches the npm publish payload contract and release workflow; mitigated by pack dry-run RED/GREEN evidence and pack-time guards.
> Decisions:
>   D1 (default, reversible): flag = env var `OMO_ENABLE_SENPI_PLATFORM` ("1"/"true"), module `packages/omo-opencode/src/cli/senpi-platform-flag.ts`; gates at commander choices (both option blocks), TUI platform prompt, and a `resolveInstallArgs` backstop. Installer/validator internals untouched (source-checkout escape hatch stays functional).
>   D2 (default, reversible): remove `packages/omo-senpi/plugin` from root files[]; flip `script/senpi-test-script.test.ts` payload pin from inclusion to exclusion; add `"private": true` to `packages/omo-senpi/plugin/package.json`.
>   D3 (default, reversible): serve.js tracked mode becomes 100755 to match what `bun build` emits every build (ends the recurring dirty-worktree bit); alternative (chmod 644 post-build step) rejected as toolchain-fighting.
>   D4 (default, reversible): changelog filter = word-boundary regex `\bsenpi\b|\bpi-goal\b|\bpi-webfetch\b` (case-insensitive) applied to commit subjects in both the commit list and the contributors section.
>   D5 (default): version bump stays publish-workflow-owned; NOT touched locally (repo rule).
>   D6 (default): delivery = ONE PR to dev from an isolated worktree, atomic commits, merge-commit policy.

## Context
### Original request
"플래그같은거 우리가 잘 설계해서 만들어서, 3은 비활성화 시켜주고, 4도 정리해주고 해주라. 그리고 나머지 게이트에서도 수정들 잘 정리도 좀 해주라." — referring to blockers 3 (Senpi exposure) and 4 (LazyCodex payload hygiene) from `.omo/evidence/20260707-prepublish-review/final-synthesis-ko.md`, plus tidying the other gate findings. Original release constraint (from the reviewed thread): non-omo/lazycodex surfaces must not be published now, "using feature flag / or just not configured yet".

### Interview summary
User gave a standing mandate ("cc ulw plan and continue on a work") — plan generated under the autonomous-mandate exception; all defaults announced in TL;DR Decisions for veto.

### Research findings
- `packages/omo-opencode/src/cli/cli-program.ts:82` (install subcommand, `hideHelp()`) and `:94` (root-level, visible) both hardcode `.choices(["opencode", "codex", "both", "senpi"])`. `resolveInstallArgs` is at `cli-program.ts:49`. → these are the flag gate points.
- `packages/omo-opencode/src/cli/tui-install-prompts.ts:34-38` unconditionally offers the Senpi option. → third gate point.
- `packages/omo-opencode/src/cli/install-platform-resolution.test.ts:116,131` grep the cli-program.ts SOURCE for the literal choices string; `:51` tests `--platform=senpi` resolves. → tests must flip to the flag-gated contract.
- Root `package.json` files[] ships `packages/omo-senpi/plugin` (13 files in pack dry-run); `script/senpi-test-script.test.ts` pins that inclusion AND pins `build:senpi-plugin` + build orchestrator references (keep the build pins — local senpi dev needs artifacts; only the payload pin flips).
- `packages/omo-codex/plugin/components/workflow-selector/dist/cli.js` is untracked + gitignored (`.gitignore:12 dist/`) yet packed, because files[] includes the whole plugin dir and npm packs on-disk content. → delete residue + negation + guards.
- Root files[] already carries `!packages/omo-codex/plugin/node_modules` + `!packages/omo-codex/plugin/**/node_modules`, but `.github/workflows/publish.yml:682` REPLACES files[] for lazycodex-ai WITHOUT those negations → published `lazycodex-ai@4.15.1` ships 2,217 node_modules entries (~699MB unpacked, verified by `npm pack lazycodex-ai@4.15.1`).
- `git log` on `serve.js`: `7960abb16` deliberately restored 100644, but the codegraph component build (`bun build src/serve.ts --outfile dist/serve.js`, `packages/omo-codex/plugin/components/codegraph/package.json:17`) re-emits 755 on every build (sibling `cli.js` is already tracked 755). → recurring dirt; track 755.
- `script/generate-changelog.ts:23` filters only `ignore:|test:|chore:|ci:|release:`; contributors section (`:117`) same. No Senpi/Pi exclusion → Senpi commit subjects leak into GitHub release notes.
- `bin/platform.js` / `postinstall.mjs`: zero senpi references — no work there.
- publish.yml insertion points: root-payload guard fits after "Build Codex plugin components" (~line 600) before "Publish oh-my-opencode" (line 630); lazycodex guard fits inside "Publish lazycodex-ai" (line 671) after the jq files-override rewrite, before `npm publish`.

### Metis review
Adapted (harness has no metis subagent): gap analysis folded from the 7 team artifacts of the 2026-07-07 prepublish review. Gaps covered: (a) lazycodex override pack was never verified with the rewritten files list → task 3 QA simulates the exact jq rewrite and packs; (b) release-note leakage had no in-code fix → task 5; (c) mode-bit dirt had no root-cause fix → task 4 aligns tracked mode with build output; (d) guard permanence → pack-time script wired into publish.yml, not just a one-off check.

## Scope
### Must have
- Flag module with env `OMO_ENABLE_SENPI_PLATFORM`; default OFF removes senpi from both commander choices lists, the TUI platform prompt, and rejects `platform === "senpi"` in `resolveInstallArgs` with an actionable message; flag ON restores all three.
- Root npm tarball contains zero `packages/omo-senpi/**` paths (pack dry-run proof).
- Root and lazycodex-override packs contain zero `node_modules/` and zero `components/workflow-selector/` paths (pack dry-run proof for both).
- `script/verify-npm-payload.mjs` fails (exit non-zero, named offending paths) on forbidden patterns; wired into publish.yml before root publish and before lazycodex-ai publish.
- serve.js tracked mode 100755; rebuilding the codegraph component leaves `git status` clean.
- `script/generate-changelog.ts` excludes Senpi/Pi subjects from both the commit list and contributors sections; existing prefix filters unchanged.
- Full root `bun test` + `bun run typecheck` green; QA evidence captured under `.omo/evidence/20260707-gate-cleanup/`.

### Must NOT have (guardrails)
- NO local version bump (publish-workflow-owned; repo hard rule).
- NO changes to senpi installer/validator internals beyond the three gate points (escape hatch must keep working from a source checkout with the flag on).
- NO deletion/weakening of existing tests to green the suite — pins are FLIPPED to the new contract, with flag-on cases preserving old behavior coverage.
- NO edits to `packages/omo-codex` component runtime behavior (payload/packaging only).
- NO squash/rebase merge language anywhere; PR targets dev.
- NO broad `\bpi\b` filter in the changelog (must not swallow "api"/unrelated subjects).

## Verification strategy
> Zero human intervention - all verification is agent-executed.
- Test decision: TDD (bun:test, given/when/then style per repo convention) — every behavior change gets a failing-first proof before production code.
- QA policy: CLI- and data-shaped work — auxiliary surfaces are first-class: real CLI invocations (exit codes + stderr), `npm pack --dry-run --json` payload dumps, `git status --short` after real rebuild, real `bun script/generate-changelog.ts` output.
- Evidence: `.omo/evidence/20260707-gate-cleanup/task-<N>-<slug>.<ext>` (kept inside the repo per repo evidence convention; plan template's `.omo/evidence/task-N` naming adapted to the repo's dated-dir convention).

## Execution strategy
### Parallel execution waves
Wave 1 (no deps): 1, 2, 4, 5
Wave 2 (after 1-2): 3
Critical path: 2 → 3 → F-wave
### Dependency matrix
| Todo | Depends on | Blocks | Can parallelize with |
|---|---|---|---|
| 1 | none | 3 (containment test asserts CLI contract too) | 2, 4, 5 |
| 2 | none | 3 | 1, 4, 5 |
| 3 | 1, 2 | F-wave | none |
| 4 | none | F-wave | 1, 2, 5 |
| 5 | none | F-wave | 1, 2, 4 |

## TODOs
> Implementation + its test = ONE todo. Never separate them.

- [ ] 1. Senpi platform flag module + CLI/TUI gating
  **What to do**: Create `packages/omo-opencode/src/cli/senpi-platform-flag.ts` exporting `SENPI_PLATFORM_ENV_FLAG = "OMO_ENABLE_SENPI_PLATFORM"`, `isSenpiPlatformEnabled(env = process.env)` (true for `"1"`/`"true"`, trimmed, case-insensitive), and `availableInstallPlatforms(env?)` returning `["opencode","codex","both"]` (+`"senpi"` when enabled). Write failing tests FIRST: (a) new `senpi-platform-flag.test.ts` covering env parsing; (b) update `install-platform-resolution.test.ts` — default `resolveInstallArgs({platform:"senpi"})` now throws/rejects with a message containing `OMO_ENABLE_SENPI_PLATFORM`, flag-on case resolves to "senpi"; source-grep pins at :116/:131 flip to expect the flag-gated call shape (`availableInstallPlatforms()`), not the literal senpi array; (c) update `tui-install-prompts.test.ts` — default options exclude senpi, flag-on include it. Then wire: `cli-program.ts:82` + `:94` build choices from `availableInstallPlatforms()`; `resolveInstallArgs` (cli-program.ts:49) backstop-rejects senpi when disabled; `promptInstallPlatform` (tui-install-prompts.ts:34) appends the senpi option only when enabled. Tests that exercise downstream senpi behavior (`cli-installer.platform.test.ts`, `tui-installer-senpi.test.ts`, `install-validators.test.ts`, `star-request.test.ts`) keep passing by construction (they enter below the gate) — verify, and where they call `resolveInstallArgs` with senpi, set the env flag in-test.
  **Must NOT do**: No changes to `install-senpi/`, `runSenpiInstaller`, or validator semantics; no removal of `"senpi"` from the `InstallPlatform` type; no test deletion.
  **Parallelization**: Wave 1 | Blocks: 3 | Blocked by: none
  **References**:
  - `packages/omo-opencode/src/cli/cli-program.ts:49,82,94` - the resolveInstallArgs seam + both hardcoded choices lists to gate.
  - `packages/omo-opencode/src/cli/tui-install-prompts.ts:34-45` - the TUI options array to gate.
  - `packages/omo-opencode/src/cli/install-platform-resolution.test.ts:51,116,131` - the pins that must flip.
  - `packages/omo-opencode/src/cli/types.ts:3` - InstallPlatform union stays intact.
  **Acceptance criteria**:
  - [ ] `bun test packages/omo-opencode/src/cli/senpi-platform-flag.test.ts packages/omo-opencode/src/cli/install-platform-resolution.test.ts packages/omo-opencode/src/cli/tui-install-prompts.test.ts` -> all pass
  - [ ] `bun test packages/omo-opencode/src/cli/` -> all pass (downstream senpi tests unaffected)
  **QA scenarios**:
  - Scenario: flag off — real CLI rejects --platform=senpi
    Tool: CLI stdout/stderr (bun)
    Steps: 1. `cd /Users/yeongyu/local-workspaces/omo-worktrees/prepublish-gate-cleanup` 2. `env -u OMO_ENABLE_SENPI_PLATFORM bun packages/omo-opencode/src/cli/index.ts install --no-tui --platform=senpi; echo "exit=$?"`
    Expected: non-zero exit; stderr names allowed choices without senpi OR the backstop message containing `OMO_ENABLE_SENPI_PLATFORM`
    Capture: `... 2>&1 | tee .omo/evidence/20260707-gate-cleanup/task-1-senpi-flag-off.txt`
    Cleanup: none (read-only)
    Evidence: .omo/evidence/20260707-gate-cleanup/task-1-senpi-flag-off.txt
  - Scenario: flag on — senpi accepted past arg parsing (isolated HOME)
    Tool: CLI stdout/stderr (bun) in throwaway HOME sandbox
    Steps: 1. `SB=$(mktemp -d)` 2. `HOME=$SB XDG_CONFIG_HOME=$SB/.config OMO_ENABLE_SENPI_PLATFORM=1 bun packages/omo-opencode/src/cli/index.ts install --no-tui --platform=senpi; echo "exit=$?"`
    Expected: arg parsing passes (no commander invalid-choice error); senpi installer path is entered (output mentions Senpi install attempt/result)
    Capture: `... 2>&1 | tee .omo/evidence/20260707-gate-cleanup/task-1-senpi-flag-on.txt`
    Cleanup: `rm -rf "$SB"` + verify `[ ! -d "$SB" ]`
    Evidence: .omo/evidence/20260707-gate-cleanup/task-1-senpi-flag-on.txt
  **Commit**: Y | `feat(cli): gate senpi install platform behind OMO_ENABLE_SENPI_PLATFORM` | Files: packages/omo-opencode/src/cli/senpi-platform-flag.ts, senpi-platform-flag.test.ts, cli-program.ts, tui-install-prompts.ts, install-platform-resolution.test.ts, tui-install-prompts.test.ts

- [ ] 2. Remove Senpi payload from root npm files[]
  **What to do**: Failing test FIRST: flip `script/senpi-test-script.test.ts` first test — `files` must NOT include `packages/omo-senpi/plugin` (assert `shipsPluginTree === false` with an updated message naming the flag-off containment contract); keep the `build:senpi-plugin` script pin, the build-orchestrator pin, and the packed-layout installer test intact. Then: remove `"packages/omo-senpi/plugin"` from root `package.json` files[]; add `"private": true` to `packages/omo-senpi/plugin/package.json`.
  **Must NOT do**: Do not remove `build:senpi-plugin` from root scripts or `script/build.ts`; do not touch other files[] entries; do not bump version.
  **Parallelization**: Wave 1 | Blocks: 3 | Blocked by: none
  **References**:
  - `package.json` files[] - the `packages/omo-senpi/plugin` entry to drop (negations for omo-codex stay).
  - `script/senpi-test-script.test.ts:47-70` - the inclusion pin to flip; second test (packed-layout) untouched.
  - `packages/omo-senpi/plugin/package.json` - add private:true (containment hardening; never standalone-published).
  **Acceptance criteria**:
  - [ ] `bun test script/senpi-test-script.test.ts` -> pass
  - [ ] `node -e "const f=require('./package.json').files; process.exit(f.includes('packages/omo-senpi/plugin')?1:0)"` -> exit 0
  **QA scenarios**:
  - Scenario: root pack dry-run ships zero senpi paths (RED before edit: 13 paths)
    Tool: npm pack dry-run JSON (data-shaped, auxiliary surface)
    Steps: 1. `npm pack --dry-run --json --ignore-scripts > /tmp/pack-root.json` 2. `node -e "const p=require('/tmp/pack-root.json')[0].files.filter(f=>f.path.startsWith('packages/omo-senpi/')); console.log('senpi paths:', p.length); process.exit(p.length?1:0)"`
    Expected: `senpi paths: 0`, exit 0
    Capture: `cp /tmp/pack-root.json .omo/evidence/20260707-gate-cleanup/task-2-pack-root-green.json` (RED capture saved as task-2-pack-root-red.json before the edit)
    Cleanup: `rm -f /tmp/pack-root.json`
    Evidence: .omo/evidence/20260707-gate-cleanup/task-2-pack-root-{red,green}.json
  - Scenario: local senpi build path still works (escape hatch intact)
    Tool: CLI stdout
    Steps: 1. `bun run build:senpi-plugin; echo "exit=$?"`
    Expected: exit 0
    Capture: `... 2>&1 | tail -20 | tee .omo/evidence/20260707-gate-cleanup/task-2-senpi-build.txt`
    Cleanup: none (build artifacts are normal dev state)
    Evidence: .omo/evidence/20260707-gate-cleanup/task-2-senpi-build.txt
  **Commit**: Y | `fix(publish): stop shipping senpi plugin payload in root npm package` | Files: package.json, script/senpi-test-script.test.ts, packages/omo-senpi/plugin/package.json

- [ ] 3. Payload hygiene: residue, negations, pack-time guard
  **What to do**: Failing test FIRST: new `script/npm-payload-containment.test.ts` asserting (a) root files[] contains `!packages/omo-codex/plugin/components/workflow-selector` and both node_modules negations; (b) files[] does NOT contain `packages/omo-senpi/plugin`; (c) `.github/workflows/publish.yml` lazycodex `.files` override string contains the two node_modules negations + the workflow-selector negation; (d) publish.yml contains `verify-npm-payload.mjs` invocations in both the root-publish and lazycodex-publish paths. Then implement: `rm -rf packages/omo-codex/plugin/components/workflow-selector` (untracked residue); add `"!packages/omo-codex/plugin/components/workflow-selector"` to root files[]; append the three negations to the publish.yml:682 jq files override; write `script/verify-npm-payload.mjs` (node, no deps): runs `npm pack --dry-run --json --ignore-scripts`, fails listing offenders when any packed path contains `node_modules/`, starts with `packages/omo-senpi/`, or contains `components/workflow-selector/`; wire it as a step after "Build Codex plugin components" (before "Publish oh-my-opencode") and inside "Publish lazycodex-ai" after the jq rewrite before `npm publish`. Run `actionlint` on publish.yml.
  **Must NOT do**: Do not restructure publish.yml jobs; do not touch marketplace sync script; the guard script must not mutate package.json.
  **Parallelization**: Wave 2 | Blocks: F-wave | Blocked by: 1, 2
  **References**:
  - `.github/workflows/publish.yml:671-695` - the jq rewrite whose `.files` array gets the negations; guard step goes between rewrite and publish.
  - `.github/workflows/publish.yml:592-615,630` - root build steps; root guard step goes before "Publish oh-my-opencode".
  - `package.json` files[] - existing negation pattern style to mirror.
  - `.omo/evidence/20260707-prepublish-review/publish-lazycodex-evidence.txt` - prior evidence of the 2,217-entry node_modules leak (the regression this guards against).
  **Acceptance criteria**:
  - [ ] `bun test script/npm-payload-containment.test.ts` -> pass
  - [ ] `node script/verify-npm-payload.mjs` -> exit 0 on the fixed tree
  - [ ] `actionlint .github/workflows/publish.yml` -> no errors
  **QA scenarios**:
  - Scenario: simulated lazycodex override pack is clean (RED first with the CURRENT override)
    Tool: npm pack dry-run JSON with temporarily rewritten package.json (mirrors publish.yml exactly)
    Steps: 1. `cp package.json /tmp/pkg-backup.json` 2. apply the publish.yml jq rewrite (OLD override) to package.json, run `npm pack --dry-run --json --ignore-scripts > /tmp/pack-lcx-red.json`, count `node_modules/` + `workflow-selector` paths (expect >0 = RED) 3. restore, apply NEW override, pack again -> /tmp/pack-lcx-green.json, count again (expect 0) 4. `cp /tmp/pkg-backup.json package.json`
    Expected: RED count > 0 before, 0 after; package.json byte-identical after restore (`git diff --quiet package.json`)
    Capture: `cp /tmp/pack-lcx-red.json /tmp/pack-lcx-green.json .omo/evidence/20260707-gate-cleanup/` (as task-3-pack-lazycodex-{red,green}.json)
    Cleanup: `rm -f /tmp/pack-lcx-*.json /tmp/pkg-backup.json` + `git diff --quiet package.json` confirms restore
    Evidence: .omo/evidence/20260707-gate-cleanup/task-3-pack-lazycodex-{red,green}.json
  - Scenario: guard script RED on a violating tree
    Tool: CLI exit code
    Steps: 1. `mkdir -p packages/omo-codex/plugin/components/workflow-selector/dist && echo "x" > packages/omo-codex/plugin/components/workflow-selector/dist/cli.js` (recreate residue) 2. `node script/verify-npm-payload.mjs; echo "exit=$?"` (expect non-zero, offender named) 3. `rm -rf packages/omo-codex/plugin/components/workflow-selector` 4. `node script/verify-npm-payload.mjs; echo "exit=$?"` (expect 0)
    Expected: exit!=0 with offender path printed, then exit=0
    Capture: `... 2>&1 | tee .omo/evidence/20260707-gate-cleanup/task-3-guard-red-green.txt`
    Cleanup: step 3 IS the cleanup; verify `[ ! -d packages/omo-codex/plugin/components/workflow-selector ]`
    Evidence: .omo/evidence/20260707-gate-cleanup/task-3-guard-red-green.txt
  **Commit**: Y | `fix(publish): exclude nested node_modules and stale component residue from npm payloads` | Files: package.json, .github/workflows/publish.yml, script/verify-npm-payload.mjs, script/npm-payload-containment.test.ts

- [ ] 4. Track codegraph serve.js as executable (kill recurring mode-bit dirt)
  **What to do**: Failing-first proof is the real surface (no test seam for git file modes): capture `git ls-files -s packages/omo-codex/plugin/components/codegraph/dist/serve.js` showing 100644 while the on-disk file is 755 post-build (RED = dirty status). Then `git update-index --chmod=+x` (or stage the mode change) so tracked mode is 100755, matching `bun build` output and sibling cli.js. Rebuild the component for real and prove `git status` stays clean.
  **Must NOT do**: Do not edit serve.ts/cli.ts content; do not add a chmod-644 post-build step (rejected: fights the toolchain).
  **Parallelization**: Wave 1 | Blocks: F-wave | Blocked by: none
  **References**:
  - `packages/omo-codex/plugin/components/codegraph/package.json:17` - the build that re-emits 755 every run.
  - commit `7960abb16` - the prior "restore mode" approach this replaces (it regressed on the very next build).
  **Acceptance criteria**:
  - [ ] `git ls-files -s packages/omo-codex/plugin/components/codegraph/dist/serve.js` -> mode 100755
  - [ ] after real rebuild: `git status --short packages/omo-codex/plugin/components/codegraph/dist/` -> empty
  **QA scenarios**:
  - Scenario: rebuild leaves worktree clean
    Tool: CLI stdout + git status (data-shaped)
    Steps: 1. `cd <worktree>` 2. `bun install` (once, worktree setup) 3. `bun run --cwd packages/omo-codex/plugin/components/codegraph build` 4. `git status --short packages/omo-codex/plugin/components/codegraph/dist/`
    Expected: build exit 0; status output empty
    Capture: `{ bun run --cwd packages/omo-codex/plugin/components/codegraph build; git status --short packages/omo-codex/plugin/components/codegraph/dist/; } 2>&1 | tee .omo/evidence/20260707-gate-cleanup/task-4-mode-stable.txt`
    Cleanup: none (build artifacts are tracked dist state)
    Evidence: .omo/evidence/20260707-gate-cleanup/task-4-mode-stable.txt
  - Scenario: edge — mode regression detection
    Tool: git plumbing
    Steps: 1. `chmod 644 packages/omo-codex/plugin/components/codegraph/dist/serve.js` 2. `git status --short` shows the file dirty (mode change detected both directions) 3. `chmod 755 ...` restore 4. `git status --short` clean
    Expected: dirty at step 2, clean at step 4
    Capture: `... | tee .omo/evidence/20260707-gate-cleanup/task-4-mode-edge.txt`
    Cleanup: step 3 restores; verify step 4 empty
    Evidence: .omo/evidence/20260707-gate-cleanup/task-4-mode-edge.txt
  **Commit**: Y | `chore(codegraph): track serve.js bundle as executable to match build output` | Files: packages/omo-codex/plugin/components/codegraph/dist/serve.js (mode only)

- [ ] 5. Changelog Senpi/Pi containment filter
  **What to do**: Failing test FIRST: new `script/generate-changelog.test.ts` for an exported pure function `isExcludedReleaseNoteSubject(subject: string): boolean` — cases: `"feat(senpi): x"` true; `"fix(omo-senpi): y"` true; `"feat(senpi-task): z"` true; `"fix(pi-goal): a"` true; `"feat(pi-webfetch): b"` true; `"chore: c"` true (existing prefix rule); `"feat(api): d"` false; `"fix(opencode): pinned"` false; `"feat: improve senpi installer"` true (subject mention). Then refactor `script/generate-changelog.ts`: extract the existing prefix filter + new word-boundary regex `/\bsenpi\b|\bpi-goal\b|\bpi-webfetch\b/i` into `isExcludedReleaseNoteSubject`, export it, apply in `generateChangelog` (line ~23, note the line format is `hash subject` — strip the leading hash before testing, or match on the full line consistently) and in `getContributors` (line ~117).
  **Must NOT do**: No broad `\bpi\b` pattern; do not alter framing bullets or TEAM list; do not change output format.
  **Parallelization**: Wave 1 | Blocks: F-wave | Blocked by: none
  **References**:
  - `script/generate-changelog.ts:23,117` - the two filter sites; note `:23` matches `^\w+ (prefix)` because of the leading short-hash.
  **Acceptance criteria**:
  - [ ] `bun test script/generate-changelog.test.ts` -> pass
  **QA scenarios**:
  - Scenario: real changelog run contains no senpi/pi lines
    Tool: CLI stdout (requires gh auth, present on this machine)
    Steps: 1. `bun script/generate-changelog.ts > /tmp/changelog-out.txt; echo "exit=$?"` 2. `grep -icE "\bsenpi\b|\bpi-goal\b|\bpi-webfetch\b" /tmp/changelog-out.txt || echo 0`
    Expected: exit 0; grep count 0 (RED capture before fix shows >0 senpi subjects given the v4.15.1..HEAD senpi commits)
    Capture: `cp /tmp/changelog-out.txt .omo/evidence/20260707-gate-cleanup/task-5-changelog-green.txt` (RED as task-5-changelog-red.txt)
    Cleanup: `rm -f /tmp/changelog-out.txt`
    Evidence: .omo/evidence/20260707-gate-cleanup/task-5-changelog-{red,green}.txt
  - Scenario: edge — "api"-scoped commits survive the filter
    Tool: bun test (unit, seam exists)
    Steps: covered by the `"feat(api): d"` false case in the unit test
    Expected: not excluded
    Capture: test output in task-5 test run log
    Cleanup: none (read-only)
    Evidence: .omo/evidence/20260707-gate-cleanup/task-5-test.txt
  **Commit**: Y | `feat(release): filter senpi and pi surfaces out of generated release notes` | Files: script/generate-changelog.ts, script/generate-changelog.test.ts

## Final Verification Wave
> Runs in parallel after ALL todos. Each reviewer returns APPROVE or REJECT.
> Any REJECT -> fix -> re-run only the rejecting reviewer.

- [ ] F1. Plan compliance audit - read the plan end-to-end; verify every Must Have exists (run the pack dry-runs, read the flag module, grep publish.yml), every Must NOT Have is absent (no version bump, no installer-internals edits, no test deletions), every evidence file exists under .omo/evidence/20260707-gate-cleanup/.
- [ ] F2. Code quality review - `bun run typecheck` + full `bun test`; review changed files for `as any` / empty catches / debug prints / dead code / slop; `actionlint .github/workflows/publish.yml`.
- [ ] F3. Real manual QA - from the worktree, re-execute EVERY QA scenario from every todo (flag off/on CLI runs, both pack dry-runs, guard RED/GREEN, rebuild-clean check, changelog run); save to .omo/evidence/20260707-gate-cleanup/final-qa/.
- [ ] F4. Scope fidelity check - per todo, diff spec vs actual changes; `git diff dev...HEAD --stat` shows only planned files; no cross-task contamination, no unaccounted files.

## Commit strategy
- todo 1: `feat(cli): gate senpi install platform behind OMO_ENABLE_SENPI_PLATFORM` - cli files | pre-commit: `bun test packages/omo-opencode/src/cli/`
- todo 2: `fix(publish): stop shipping senpi plugin payload in root npm package` - package.json, senpi test, plugin pkg | pre-commit: `bun test script/senpi-test-script.test.ts`
- todo 4: `chore(codegraph): track serve.js bundle as executable to match build output` - serve.js mode | pre-commit: `git status --short` clean after rebuild
- todo 5: `feat(release): filter senpi and pi surfaces out of generated release notes` - changelog script + test | pre-commit: `bun test script/generate-changelog.test.ts`
- todo 3: `fix(publish): exclude nested node_modules and stale component residue from npm payloads` - package.json, publish.yml, guard script + test | pre-commit: `bun test script/npm-payload-containment.test.ts && node script/verify-npm-payload.mjs`
- PR to dev, merge-commit policy (NEVER squash/rebase). Footer: `Plan: .omo/plans/prepublish-gate-cleanup.md`

## Success criteria
### Verification commands
- `npm pack --dry-run --json --ignore-scripts | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const f=JSON.parse(d)[0].files.map(x=>x.path);const bad=f.filter(p=>p.includes('node_modules/')||p.startsWith('packages/omo-senpi/')||p.includes('components/workflow-selector/'));console.log('bad:',bad.length);process.exit(bad.length?1:0)})"` -> `bad: 0`, exit 0
- `env -u OMO_ENABLE_SENPI_PLATFORM bun packages/omo-opencode/src/cli/index.ts install --no-tui --platform=senpi` -> non-zero exit, senpi not accepted
- `node script/verify-npm-payload.mjs` -> exit 0
- `bun run --cwd packages/omo-codex/plugin/components/codegraph build && git status --short packages/omo-codex/plugin/components/codegraph/dist/` -> empty
- `bun test` -> green; `bun run typecheck` -> green
- `bun script/generate-changelog.ts | grep -icE "\bsenpi\b|\bpi-goal\b|\bpi-webfetch\b"` -> 0
