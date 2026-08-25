# QA evidence: memory reflection scoped-npm ENOENT on Windows (#6847)

Date: 2026-08-24
Branch: issue/6847-memory-reflection-scoped-npm (base: dev @ 8833800ae)
Scope: packages/omo-native/bin/lib/package-paths.js + launcher.js call site, tests under
packages/omo-native/test/ only.

## WHAT WAS TESTED

1. Failing-first regression tests, written before the implementation:
   - packages/omo-native/test/package-paths.test.ts (new): 6 cases for nearestNodeBin.
     The #6847 case builds the exact npm layout (scoped package with its own EMPTY
     node_modules/.bin plus an ancestor bin holding the shim) and asserts the ancestor bin
     wins. Platform decision is simulated portably via an injected platform option:
     win32 requires senpi.cmd, POSIX requires senpi; a win32 host with only an
     extensionless shim qualifies no bin; no matching shim anywhere returns undefined;
     calls without executable keep the legacy first-existing-bin walk; hoisted sibling
     layouts still resolve.
   - packages/omo-native/test/launcher.test.ts (extended): FixtureOptions.scopedEmptyBin
     materializes the empty scoped .bin in the fixture tree; the new end-to-end case spawns
     the real launcher through node and asserts the child environment recomputes
     SENPI_BIN to the ancestor shim (a stale inherited SENPI_BIN is handed in to prove
     recompute) and that the PATH head is the ancestor bin, not the empty scoped one.
2. Scoped suite after implementation: bun test packages/omo-native/test/
   (green-omo-native-full.txt): 133 pass, 0 fail, 6 skip across 15 files.
3. Typecheck: bunx tsc -p packages/omo-native/tsconfig.json --noEmit, exit 0 (typecheck.txt).

## WHAT WAS OBSERVED

- RED before the fix: red-package-paths.txt shows 4 fail / 2 pass; the win32-injected and
  shim-aware cases received the empty scoped bin instead of the ancestor bin.
  red-launcher-scoped-empty-bin.txt shows the end-to-end case failing with
  SENPI_BIN undefined, which is exactly the reporter's failure chain (launcher deletes the
  inherited SENPI_BIN, recomputes against the empty bin, finds no senpi.cmd, and the
  reflection child then fails spawning bare senpi with ENOENT).
- GREEN after the fix: full scoped package suite 133 pass / 0 fail; typecheck exit 0.

## WHY IT IS ENOUGH

- The resolver contract is pinned with injected platform/fileExists seams, so the win32
  decision runs in CI on Linux and cannot drift with the host.
- The end-to-end case drives the real launcher subprocess over the real fixture tree, so
  what is asserted is the actual child environment (PATH head + SENPI_BIN) that memory
  reflection children inherit when they spawn senpi by name.
- The legacy no-executable walk and the hoisted-layout normalization are pinned, so the
  fix cannot regress either pre-existing caller shape.

## WHAT WAS OMITTED

- Live Windows verification: this QA host is Linux, so the real win32 CreateProcess lookup
  of senpi.cmd could not be driven; the injected-platform unit cases plus the portable e2e
  environment assertions cover the decision logic, and residual risk is documented here.
- bun install prepare step failed in this environment (git submodule fetch network reset +
  frontend materialization), the known harmless env quirk also recorded by PR #7196;
  dependencies resolved and all scoped tests ran. The prepare step's partial build output
  dirtied generated packages/omo-senpi/plugin/extensions/*.js artifacts; they were restored
  and are NOT part of this change. Nothing from packages/shared-skills/upstreams/* is staged.
- No secrets, tokens, or host-identifying paths appear in the captured outputs; fixture
  paths live under the OS temp dir.
