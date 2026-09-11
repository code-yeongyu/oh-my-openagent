# Setup Import SQLite Handle Leak QA

## What Was Tested

### Deterministic RED

Command:

```text
PATH=/tmp/omo-bun-1.4-bin:$PATH bun test packages/omo-native/test/setup-import.test.ts
```

Surface: the real `omo setup --yes` launcher exercised by
`packages/omo-native/test/setup-import.test.ts` against pinned `.omp` and `.gjc`
SQLite fixtures.

Purpose: prove the new suite-specific assertion detects fixture handles that
remain open after the pinned-database case completes. Because `origin/dev`
already contained the intended `withDatabase` ownership, RED was captured under
a controlled mutation that temporarily restored the old raw-handle behavior.
The mutation was removed before GREEN and is not part of the final diff.

Artifact: `red.txt`

### Targeted GREEN

Command:

```text
PATH=/tmp/omo-bun-1.4-bin:$PATH bun test packages/omo-native/test/setup-import.test.ts
```

Purpose: prove all three SQLite handles opened by the pinned `.omp`, `.gjc`, and
unknown-schema fixtures report `isOpen === false` after setup import completes.

Artifact: `green.txt`

### Omo-native Regression Suite

Command:

```text
PATH=/tmp/omo-bun-1.4-bin:$PATH bun test packages/omo-native/test packages/omo-native/test/teardown.test-support.test.ts
```

Observed: 232 tests passed across 22 files with 0 failures and 687 assertions.

### Repository Typecheck

Command:

```text
PATH=/tmp/omo-bun-1.4-bin:$PATH bun run typecheck
```

Observed: exit code 0 for the root, script, and all package typecheck stages.

### Static Review

- LSP diagnostics for `packages/omo-native/test/setup-import.test.ts`: no diagnostics.
- `git diff --check`: exit code 0.
- The TypeScript no-excuse audit reported one pre-existing non-null assertion at
  `setup-import.test.ts:229`; it is outside this diff and was not changed.
- No timeout, teardown retry budget, win32 skip, workflow, or `--parallel` change
  is present.

## What Was Observed

The RED assertion reported all three expected-closed handles as still open:

```text
  [
-   false,
-   false,
-   false,
+   true,
+   true,
+   true,
  ]
```

The final implementation records each constructed fixture handle, passes that
same handle through the existing `withDatabase` helper, and verifies all three
are closed before the case ends. GREEN completed with 9 passing tests and 99
assertions under Bun 1.4.0.

The motivating Windows evidence is CI runs `33712499816` and `33715671900`,
including job `100524297404`. The latter showed two consecutive
`teardown-failure:` win32 `EBUSY` messages before the pinned-database test's
`beforeEach`/`afterEach` hook timed out. The failure appeared when Windows shard
2 stopped using `--parallel`; per-file process exit had previously masked handle
ownership defects during serial execution.

## Why It Is Enough

- RED is platform-independent and checks SQLite's actual `isOpen` state, so the
  regression does not require Windows timing or an artificial sleep.
- GREEN proves the exact three handles opened by the failing case are closed
  through the existing `withDatabase` seam before temporary-root teardown.
- The package-wide suite covers sibling setup and teardown behavior.
- Repository typechecking and LSP diagnostics cover the changed TypeScript.
- The fix closes handles rather than widening a timeout or retry budget, skipping
  win32, or restoring `--parallel`.

## What Was Omitted

- Raw environment dumps, credentials, authentication headers, and private tokens
  were not captured.
- Fixture sentinel secrets were not copied into evidence.
- CI was intentionally not awaited, and the PR must remain unmerged per the
  request.
