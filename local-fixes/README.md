# Local OMO fixes — rebuild after any OMO update

## The rule

After **any** OMO update, before using the bundle, run ONE command from the repo root:

```
bun run local-fixes/apply.mjs
```

It applies every fix we own (in dependency order), rebuilds `dist/index.js`, and verifies the
result. Then restart OpenChamber.

## What it does

1. Refuses to run unless the working tree is clean (`git status` empty).
2. Applies each fix in `manifest.json` in order — skipping any already in history.
3. Runs `bun run build`.
4. Checks `dist/index.js` for each fix's marker strings and prints a per-fix `ok` / `MISSING` line.

Every run ends with either `All N local fixes are applied and verified` or a non-zero exit.

## If it fails

It exits non-zero and prints `CONFLICT` with the fix id, its commit and its PR.
Earlier successful picks can remain, and failed fallback changes are preserved for inspection.
Never infer whole-run rollback from a cherry-pick abort.

### Isolated v5.1.34 promotion entrypoint

`bun local-fixes/check-lineage.mjs` checks every path and stable patch ID before mutation.
`--normalize` converts UTF-16LE fallback patches only after comparing their decoded lineage
with the recorded commit, then verifies the normalized result again.

In a completely clean, independent clone named `Temp/opencode/omo-v5134-build-*`, use:

```bash
bun local-fixes/promote-clone.mjs
# After behavioral gates and preserving the existing staged bundle + lane.json pair:
bun local-fixes/stage-bundle.mjs --target-checkout "C:/Users/Zephyrus/Documents/ai/oh-my-openagent-fix-v2-int"
bun local-fixes/verify.mjs "C:/Users/Zephyrus/Documents/ai/oh-my-openagent-fix-v2-int-staged/dist/index.js"
```

The wrapper also accepts `--target-checkout <live-path>` to explicitly invoke the same final
staging command after apply and clone-stage verification. It never imports source or activates.
On failure a journal under `.git/omo-promotion-run.json` records the starting HEAD/branch/path;
further runs refuse until inspected. `bun local-fixes/promote-clone.mjs --abort` explicitly
aborts a pending cherry-pick and resets **only this disposable clone** to its recorded HEAD.
Unknown untracked leftovers are preserved and must be reviewed; no `git clean` is run.
Shared worktrees and checkouts outside the clone naming/location guard are rejected.

- Do **not** improvise a manual merge.
- Do **not** skip the fix.
- Do **not** hand-edit the generated bundles.
- Escalate with the exact output. `manifest.json` lists every fix and its PR.

## The fixes

| id | what it fixes | PR |
|---|---|---|
| `01-hijack-autocontinue-reroute` | post-compaction auto-continue inherited the compaction model | [#8397](https://github.com/code-yeongyu/oh-my-openagent/pull/8397) |
| `02-hijack-working-model` | "working model" resolved from compaction artifacts → self-sustaining switch | [#8397](https://github.com/code-yeongyu/oh-my-openagent/pull/8397) |
| `03-empty-summary-guard` | abandoned summarize let the stale ratio re-fire compaction at ~7% | [#8473](https://github.com/code-yeongyu/oh-my-openagent/pull/8473) |
| `04-compaction-pin-resolution` | `agents.<key>.compaction.model` silently fell back to the session model | [#8511](https://github.com/code-yeongyu/oh-my-openagent/pull/8511) |
| `05-background-agent-liveness` | detached SDK method + no watchdog stranded background tasks ~6h | [#8512](https://github.com/code-yeongyu/oh-my-openagent/pull/8512) |

Order matters: `02` edits the file `01` creates, and `04` edits the file `03` touches.
Do not reorder.

## Outside the OMO repo

One fix is not part of this repository and survives OMO updates untouched:

- **squeez WSL timeout supervisor** — `C:\Users\Zephyrus\.config\opencode\plugins\squeez.js`.
  squeez prints its timeout notice but never returns control for `wsl.exe` commands (one tool
  call stayed pending 21,893 s). The plugin now injects a supervisor for WSL commands only:
  bounded wait → `taskkill /F /T /PID` → exit 124. Verify with
  `node C:\Users\Zephyrus\.config\opencode\tests\squeez-plugin.test.mjs`.

## One trap worth remembering

`bun run build` regenerates tracked files under `packages/omo-senpi/plugin/extensions/` and
`packages/omo-codex/scripts/install-dist/`. They will always show as modified after a build.

**Never commit them.** That churn is exactly what made PRs unmergeable — upstream regenerates
the same files, so shipping ours creates conflicts in files nobody actually edited.

## Staging from a work clone, and what activation checks (2026-10-13)

No file inside the live checkout may be written while OpenChamber runs, so source and ledger
work happens in a clone that the live checkout fast-forwards from during a closed window.

```bash
# in the clone, on integration/opencode-v2, tree clean:
bun local-fixes/stage-bundle.mjs --target-checkout "C:/Users/Zephyrus/Documents/ai/oh-my-openagent-fix-v2-int"
bun run fixes:verify "C:/Users/Zephyrus/Documents/ai/oh-my-openagent-fix-v2-int-staged/dist/index.js"
```

`--target-checkout` writes the bundle and `lane.json` beside the target checkout and records
the target's paths, the clone it was built in (`source`) and the target's commit at build time.
It refuses a target that cannot fast-forward to the staged commit.

`activate-staged.ps1` (and `-Status`) refuse a staged bundle that does not belong to the
checkout they run in: `lane.json` must name this checkout's staged and live paths, the staged
file must match its recorded hash, and the checked-out commit must be the commit the bundle was
built from. When the commit differs the script prints the two commands that bring the source
over (`git fetch "<source>" integration/opencode-v2`, `git merge --ff-only <commit>`).
`-Rollback` restores the newest backup only if it still matches the hash recorded in
`backups/MANIFEST.txt`.

`fixes:verify` checks the same provenance for the bundle it is given (or the live bundle) and
says so. It proves markers and provenance, not behavior: a fix's behavior is proven by its
tests. Do not use its exit code as the only activation gate.

`OMO_V2_PERMISSION_FAIL_CLOSED=1` makes the v2 skill permission bridge (fixes 30 and 33) reject
instead of skipping the prompt when the permission system cannot be reached.

## Retired fixes

A fix leaves `manifest.fixes` when upstream ships the same change. Its record moves to
`retiredFixes` in `manifest.json` and its patch file is deleted, so `apply.mjs` never tries to
cherry-pick it again and `fixes:verify` stops asking for its markers.

| id | retired at | superseded by |
|---|---|---|
| `17-tool-args-in-place` | v5.1.33 (2026-10-13) | #9466 (in 5.1.28) and #9909 (in 5.1.32); our PR #9449 was closed as landed |
| `22-hook-spawn-windowshide` | v5.1.33 (2026-10-13) | #9837 (in 5.1.30) |

For a retired fix, take upstream's version of every file the fix touched, even when git reports
a clean merge. Fix 22 merged cleanly and still left `windowsHide` twice in one object literal.

## Promoting an upstream release into this lane

The v2 layer (PR #9016) is not in the manifest, so the manifest cannot be replayed onto a clean
tag. Merge the tag into `integration/opencode-v2` in the work clone instead:

```bash
git fetch --no-tags upstream refs/tags/vX.Y.Z:refs/tags/vX.Y.Z
git merge --no-ff vX.Y.Z          # resolve by hand; retire what upstream now ships
bun install --frozen-lockfile     # its prepare step runs `bun run build` and writes dist/ in the clone
bun run typecheck
git checkout -- packages/omo-native/bin/lib/service-auth.generated.js   # the build rewrites this tracked file
bun local-fixes/stage-bundle.mjs --target-checkout "C:/Users/Zephyrus/Documents/ai/oh-my-openagent-fix-v2-int"
bun run fixes:verify "C:/Users/Zephyrus/Documents/ai/oh-my-openagent-fix-v2-int-staged/dist/index.js"
```

The staged bundle keeps `zod` and `@opencode/plugin` external and loads them from the live
checkout's `node_modules`. Compare both versions between the clone and the live checkout before
the window. When they match (5.1.28 to 5.1.33: `zod` 4.6.5 and `@opencode/plugin` 2.0.16 on both
sides) the swap needs no install. When they differ, or before building or testing in the live
checkout, run `bun install --frozen-lockfile --ignore-scripts` there in the closed window: without
`--ignore-scripts` the `prepare` step rebuilds `dist/index.js` in place, outside
`activate-staged.ps1` and its backup.

The fast-forward in the live checkout refuses to run while the regenerated bundles there are
modified and the incoming release changes the same files (5.1.28 to 5.1.33: all 14). They are
build output, never real work, so restore them first, in the closed window:

```bash
git status --porcelain            # expect only packages/omo-senpi/plugin/ and packages/omo-codex/scripts/install-dist/
git checkout -- packages/omo-senpi/plugin packages/omo-codex/scripts/install-dist
git fetch "<work clone>" integration/opencode-v2
git merge --ff-only <staged commit>
```

Known gap: the markers of fixes 10 (`DEFAULT_FIRST_PROMPT_WATCHDOG_MS`) and 11
(`cancellationRequested`) also exist in pristine upstream, so `fixes:verify` cannot notice if
either fix is dropped. Their tests are the only evidence.
