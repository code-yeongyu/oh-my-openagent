# LSP daemon Windows `process.execPath` regression QA

## Plan

1. Add one focused Windows Vitest that copies the running Node executable to an absolute temporary path containing spaces, invokes the real `scripts/build.mjs` through that copy, and verifies the atomic output's stamped `dist/package.json` keeps version `0.1.0`.
2. Run only that test on Node 24.14.1 with Bun 1.3.12 prepended to `PATH`, before changing `scripts/build.mjs`; capture and sanitize the expected shell-splitting failure in `red.txt`.
3. Extend the atomic runner's private `run` helper to accept optional spawn options and set `shell: false` only for the `process.execPath` stamp invocation, preserving Windows `shell: true` for `tsc` and `bun` shim lookup.
4. Re-run the same focused test and capture sanitized passing output in `green.txt`; verify the spaced executable-path assertion, cleanup, diff hygiene, and touched-path history.

## Atomic todos

- [x] Add the real Windows spaced-Node regression and verify it parses under Vitest.
- [x] Capture RED from unchanged production code and confirm the failure is command-shell splitting.
- [x] Apply the one-call-site `shell: false` production fix without changing `tsc` or `bun` behavior.
- [x] Capture GREEN from the identical focused command and confirm stamped version `0.1.0`.
- [x] Record temp cleanup, redactions, omissions, diff checks, and history-based commit style.

## Results

### What was tested

The focused Windows Vitest `test/build-exec-path.windows.test.ts` copies the running Node 24.14.1 executable into a new absolute temp directory named `node with spaces`, asserts that copied executable is absolute and matches `/\s/`, and uses it to invoke the real `packages/lsp-daemon/scripts/build.mjs`.

The test places `tsc.cmd` and `bun.cmd` shims first on `PATH`. Those shims isolate the atomic orchestration from unrelated TypeScript workspace dependency resolution while proving the existing Windows `shell: true` default still resolves `.cmd` build tools. The `bun.cmd` shim writes only the required `cli.js` sentinel. The build then runs the real `stamp-dist-version.mjs`, publishes the atomic temp dist, and the test asserts the resulting `dist/package.json` version is exactly `0.1.0`.

RED and GREEN used the same test contents and focused Vitest invocation, with the pinned Bun 1.3.12 directory (`<PINNED_BUN_DIR>`) prepended to `PATH`. The accepted RED predates the reviewer-requested `.windows` basename and is preserved under its original `test/build-exec-path.test.ts` filename in `red.txt`; GREEN uses the CI-discoverable name:

```text
npm --prefix packages/lsp-daemon exec -- vitest --run test/build-exec-path.windows.test.ts --reporter=verbose
```

### What was observed

- RED on the unmodified `scripts/build.mjs`: exit 1. The inner shell reported `'<TEMP>\node' is not recognized`, showing it split `<NODE_WITH_SPACES>` at the first whitespace during `run(process.execPath, ...)`. See `red.txt`.
- GREEN after allowing `run(command, args, options = {})` and supplying `{ shell: false }` only to the stamp invocation: exit 0, one test passed. The stamped version assertion reached and accepted `0.1.0`. See `green.txt`.
- `tsc` and `bun` call sites received no options override, so on Windows they retain `shell: true` and continue resolving `.cmd` shims.
- `npm exec -- biome check scripts/build.mjs test/build-exec-path.windows.test.ts` from the package exited 0 and checked the configured test path with no fixes. Package Biome excludes `.mjs`, so the production script was not processed by that formatter.
- The exact six-path PR diff now includes `build-exec-path.windows.test.ts`, so `script/ci-fast-path.mjs` reports `generatedReleasePush: false`, `webOnly: false`, `runHeavy: true`, and `fullMatrix: true`. This schedules the existing Windows package-test job instead of silently exercising only the Ubuntu skip.
- `git diff --check` exited 0.
- After installing the root workspace links with pinned Bun 1.3.12, `npm --prefix packages/lsp-daemon run build` completed on Node 24.14.1, emitted all three entry points, and stamped `dist/package.json` as `0.1.0`. See `build.txt`.
- `npm --prefix packages/lsp-daemon run typecheck` exited 0 after the regression used strict index access for `process.env["PATH"]`.
- Full package Vitest reached 152 passes; its four failures are unrelated Windows `EPERM` errors from existing symlink tests. The changed focused test passed in that same run.

### Why this is enough

This is an observable process-level regression, not a source-string or mocked `spawnSync` assertion. It executes the production atomic runner under the exact problematic condition: its own `process.execPath` contains spaces on Windows. The test reaches the real stamp script and validates its argument through the stamped artifact, while the unchanged `.cmd` shims demonstrate that narrowing `shell: false` to the Node call does not break the reason the runner used a shell for its other Windows commands.

### Cleanup receipt

The test removes its unique temp root in `finally` and asserts `existsSync(tempRoot) === false`, on RED and GREEN. Independent scans after each accepted run found `MATCHING_TEMP_DIRS=0`; the exact RED root also returned `RED_TEMP_PATH_EXISTS=False`.

### Omissions and redactions

- An exploratory pre-RED run using the full TypeScript compiler stopped before the stamp step because a linked sibling workspace dependency was not resolvable from the package-only `npm ci`. It was rejected as regression evidence. The accepted RED uses `.cmd` shims to isolate the stamp orchestration and fails only for shell splitting.
- Full package build and typecheck passed after the root workspace install. Full package Vitest was run; four existing Windows symlink tests require privileges unavailable in this workspace and failed with `EPERM`. Full-package Biome still reports 15 existing diagnostics in unchanged files, while the changed test passes the targeted Biome gate.
- Machine-specific worktree, temp, and copied-Node paths are sanitized as `<WORKTREE>`, `<TEMP>`, and `<NODE_WITH_SPACES>`. Raw environment dumps and authentication material were not captured.

### History and commit style

Touched-path history shows `d2dcb49f3a fix(build): isolate parallel lsp daemon artifacts` introduced the atomic runner, with nearby package-test history using `test(lsp-daemon): ...` and production history using `fix(lsp-daemon): ...`. The production fix and regression evidence use those repository conventions; the CI-discovery follow-up is a test-only rename.

### Residual risk

The regression is Windows-specific and skips on non-Windows hosts. It intentionally exercises orchestration rather than real compilation, so it does not replace the package's broader build or test gates. The production change affects only the private build script helper and one existing call site; no API, dependency, manifest, or runtime-daemon behavior changes.
