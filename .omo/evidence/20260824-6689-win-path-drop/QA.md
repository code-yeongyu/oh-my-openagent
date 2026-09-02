# QA evidence: Windows PATH drop in senpi extension toolkit path provisioning (#6689)

Date: 2026-08-25
Branch: issue/6689-win-path-drop (base: dev @ 8833800ae)
Scope: packages/omo-senpi/src/extension/toolkit-path-provisioning.{ts,test.ts} only

## Root cause (file:line)

`packages/omo-senpi/src/extension/toolkit-path-provisioning.ts:36-38`
(`prependPathEntry`, run at extension activation from `extension/compose.ts:52-58`
before any component registers): the read and write hardcoded the uppercase
`PATH` key. Windows names the inherited variable `Path` (HKCU/HKLM
`Environment: Path`) and JS object keys are case-sensitive, so on env surfaces
without Node's Windows case-insensitive magic (the Bun re-exec runtime this
product ships via `bin/lib/bun-runtime.js`, or any plain-object env) the read
yielded `undefined` and the write created a SECOND `PATH` key holding only the
toolkit dir. Every later `{ ...process.env }` spawn merge carried both keys and
the truncated uppercase entry shadowed the inherited full value in the child
environment block - exactly the issue's measured 3-entry child PATH
(`~/.omo/bin`, agent-toolkit, senpi `.bin`; System32/nodejs/Git\cmd dropped).
The launcher-side twin was already fixed on dev in `9cb2b3763`
(`packages/omo-native/bin/lib/launcher.js:78`, case-insensitive key lookup);
this extension-side mutation site kept the hardcoded spelling.

## WHAT WAS TESTED

1. Failing-first regression tests written before the implementation
   (`toolkit-path-provisioning.test.ts`, extended):
   - "#given a Windows-style env whose inherited path key is 'Path' #when
     provisioning prepends the toolkit dir #then the full inherited Path
     survives under its original key and no duplicate uppercase PATH is
     created" - injects a win32-shaped plain env object (`Path` key,
     System32/nodejs entries) through the new `env` seam and asserts the
     prepended value lands under `Path` with `windowsEnv.PATH === undefined`.
   - "#given an env that already carries both PATH spellings #when provisioning
     runs #then it prepends onto the first resolved path key without adding a
     third variant" - pins deterministic resolution order.
2. Scoped suites after implementation:
   - `bun test packages/omo-senpi/src/extension/toolkit-path-provisioning.test.ts`
     (green.txt)
   - `bun test packages/omo-senpi/src/extension/` (green-extension.txt)
3. `tsgo --noEmit -p packages/omo-senpi/tsconfig.json` (typecheck.txt).

## WHAT WAS OBSERVED

- RED before the fix (red.txt): both new tests failed - the provisioning wrote
  nothing into the injected env because the old code mutated only the hardcoded
  `process.env.PATH`; 5 pass / 2 fail.
- GREEN after the fix (green.txt): 7 pass / 0 fail; the fix resolves the actual
  path key case-insensitively (same pattern as launcher.js:78) for both read
  and write and routes mutations through the injectable env object.
- Extension suite (green-extension.txt): 65 pass / 0 fail.
- Typecheck: exit=0.

## WHY IT IS ENOUGH

- The regression is pinned at the exact failure shape the issue measures: an
  env whose path variable is spelled `Path` must keep its full value under that
  spelling after provisioning, with no duplicate uppercase key that could win a
  child-spawn environment-block merge. That invariant now fails CI instead of
  shipping.
- The injected-env seam makes the assertion deterministic on any host (Linux CI
  included); no real Windows box is required to lock the contract.
- The whole extension suite (10 files) stays green, so activation ordering and
  sibling seams are unaffected; typecheck confirms the additive option broke no
  consumer (`compose.ts` uses the default).

## WHAT WAS OMITTED

- Live Windows verification: this host is Linux. The reporter's exact
  end-to-end reproduction (omo-ai on Windows spawning bash/powershell children)
  can only be observed on Windows; residual risk is the runtime-specific env
  casing behavior of Bun/Node on win32, which the contract test abstracts over
  by injecting a case-sensitive plain object (the worst-case surface).
- Full `bun test packages/omo-senpi`: 2217 pass / 7 skip / 11 fail
  (green-omo-senpi.txt). The 11 failures are pre-existing on this base and
  unrelated to this change: re-running the same failing files WITHOUT this diff
  (stashed) reproduces them identically (baseline.txt: 24 pass / 10 fail across
  skills-sync + install suites). They depend on generated plugin artifacts
  (`plugin/skills/` sync outputs, materialized upstreams) that the environment's
  broken `bun install` prepare step (git submodule fetch network reset +
  `build:materialize-frontend`, documented pre-existing/harmless in the task)
  never produced. The scoped suite covering the changed file is fully green.
- `bun run test:senpi` live gate not run: its build+stage chain needs the same
  missing generated artifacts noted above.
- Open PR #6692 (launcher-side System32 restoration + shim dedupe) and issue
  #6690 (taskkill ENOENT) are separate surfaces; untouched here.
- No secrets, tokens, or host-identifying paths appear in captured outputs;
  fixture env values are synthetic win32-style paths.
