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

It exits non-zero and prints `CONFLICT` with the fix id, its commit, its PR, and the conflicting
files. The cherry-pick is aborted first, so **nothing is left half-applied**.

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
