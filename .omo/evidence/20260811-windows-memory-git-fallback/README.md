# Evidence: Windows memory init Git fallback (issue #6701, PR #6736)

## What was tested
- Unit (hermetic): `bun test packages/memory-core/src/git/exec.test.ts` — fallback ordering, bare-git precedence, win32-only gating, non-ENOENT propagation, missing-cwd exit-128 preservation, dedup, deterministic candidate order.
- Real surface: issue #6701's minimal repro (`bun -e` driving `createNodeGitExec().run(["--version"])` with a sanitized `Path: C:\only-path` env) executed on a real Windows 11 Parallels VM (Git for Windows 2.54.0 at `C:\Program Files\Git\cmd\git.exe`, bun 1.3.14), against dev revision ee81ab7c5 (pre-fix) and branch revision b5caee836 (post-fix).
- Regression: full memory-core suite, omo-senpi memory component suite, `tsgo --noEmit`, bundle rebuild with CI Bun 1.3.12 + `build-extension.mjs --check` freshness gate.

## What was observed
- `red-unit.txt`: 19 fail / 2 pass on dev's exec.ts with the new suite overlaid — fails because no fallback exists (real spawn ENOENT -> GitNotFoundError).
- `green-unit.txt`: 21 pass / 0 fail after the fix.
- `vm-red-dev.txt`: on dev, absolute git.exe works (`git version 2.54.0.windows.1`) while the sanitized-Path repro exits 1 with `GitNotFoundError: Git is required for memory storage but was not found on PATH.`
- `vm-green-fix.txt`: on b5caee836, the identical repro exits 0 with `{"code":0,"stdout":"git version 2.54.0.windows.1\n",...}` — the ProgramFiles fallback found the standard install.
- `vm-cleanup.txt`: guest temp dir removed (Test-Path False), no bun processes, VM stopped back to its original state (prlctl before/after).
- `suites-and-bundles.txt`: memory-core 319 pass; senpi memory 251 pass; typecheck clean; bundle build + `--check` current with bun 1.3.12; fallback marker present in rebuilt `omo.js` and `omo-memory-mcp.js`.

## Why it is enough
The unit suite pins every acceptance criterion from #6701 hermetically (including env-supplied-only candidate discovery and non-Windows invariance), and the VM run proves the exact user-reported failure mode RED on dev and GREEN on the branch through the real spawn path on real Windows with a real Git for Windows install. Bundle freshness `--check` proves the shipped extension bundles carry the fix.

## What was omitted
- Raw VM shell environment dumps and any host credential material; transcripts contain only commands, outputs, and internal-tailnet addressing.
- The launcher-side PATH bugs (#6689/#6692, senpi taskkill) are separate surfaces and intentionally out of scope.
