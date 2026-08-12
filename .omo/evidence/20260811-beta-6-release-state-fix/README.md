# Beta 6 release-state CI repair

## What was tested

- Updated the stamped OmO Native telemetry package-version assertion from
  `5.0.0-beta.5` to `5.0.0-beta.6`.
- Rebuilt the committed Senpi plugin artifacts with Bun `1.3.12`.
- Ran the Ubuntu bundle freshness check:
  `node packages/omo-senpi/plugin/scripts/build-extension.mjs --check`.
- Reproduced the Senpi compatibility job:
  - `bun run build:senpi-plugin`
  - `npm pack --pack-destination <isolated-temp-dir> packages/omo-senpi/plugin`
  - `npm --prefix packages/lsp-daemon test -- test/daemon-roundtrip.test.ts`
  - `bunx tsgo --noEmit -p packages/omo-senpi/tsconfig.json`
  - `bun test packages/omo-senpi`

## What was observed

- Bundle freshness check exited 0.
- The packed artifact was `@code-yeongyu/omo-senpi@5.0.0-beta.6` with 482 files.
- LSP daemon roundtrip: 5 passed, 0 failed.
- OMO Senpi suite: 1,124 passed, 0 failed across 165 files.
- The package typecheck exited 0.
- The compatibility pack directory was removed by the command trap and its absence was verified.
- Final tracked diff is limited to the telemetry assertion and four regenerated
  files under `packages/omo-senpi/plugin/extensions/`.
- Workspace LSP diagnostics could not target this task-owned external worktree;
  the clean package typecheck, bundle check, and package suite cover the changed
  TypeScript test and generated runtime instead.

## Post-rebase base-branch repair

After the release branch rebased onto `origin/dev@3b7af83c8`, the exact
compatibility gate exposed a base-branch bundle budget failure:

- RED: `omo.js` rebuilt to 900,274 bytes against the unchanged 900,000-byte
  ceiling; 1,126 tests passed and only the bundle budget failed.
- Root cause: the newly merged task lifecycle RPC snapshot duplicated the task
  tool's public record projection inside the same single-file bundle.
- Fix: extracted and reused `recordSummary` across task results and lifecycle
  snapshots without changing the RPC payload or raising the ceiling.
- GREEN on macOS: the final pinned Bun 1.3.12 bundle is 899,656 bytes.
- Final exact gate:
  - bundle freshness: pass;
  - package build and npm pack: pass;
  - LSP daemon roundtrip: 5 passed;
  - omo-senpi: 1,127 passed, 0 failed across 165 files;
  - senpi-task task-tool suite: 182 passed, 0 failed across 30 files;
  - omo-senpi and senpi-task typechecks: pass;
  - isolated pack directory removed and verified by the cleanup trap.

## Windows bundle headroom

The first repaired PR rerun exposed the same budget on Windows with a larger
platform-specific output:

- GitHub Actions run `31511896025`, job `93847562832`.
- RED: Windows rebuilt `omo.js` to 900,160 bytes.
- Additional fix: task-detail serializers now assign optional properties
  directly. Their serialized JSON is unchanged because `undefined` properties
  are omitted, while the bundled conditional-spread boilerplate is removed.
- Real Parallels Windows 11 QA with Bun 1.3.12:
  - required a clean recreation of the generated extensions directory because
    `robocopy` preserved read-only attributes and an initial `EPERM` left stale
    bytes;
  - true rebuilt `omo.js`: 899,935 bytes;
  - bundle budget and event-bridge suites: 10 passed, 0 failed.
- Cleanup:
  - both Windows QA sandboxes and scripts removed;
  - temporary remote Mac worktree and scripts removed;
  - Windows VM restored to its original stopped state;
  - Parallels Desktop quit;
  - Bunshin client closed.

## Windows reflection lock repair

The next PR rerun passed Windows Senpi compatibility but exposed one root-suite
race:

- GitHub Actions run `31514629800`, job `93856582546`.
- RED: a simultaneous reflection reservation received Windows `EPERM` while
  reading `reflection-scheduler.lock`; 14,379 tests passed and this was the only
  failure.
- Fix: Windows `EPERM` now becomes an anonymous, unreadable owner snapshot.
  Acquisition remains fail-closed and uses the existing contention
  deadline/backoff; release will not delete a lock whose owner cannot be
  verified.
- Bundle headroom: build markers retain SHA-256 digests but encode them with
  base64url and a shorter internal prefix, removing non-runtime bytes without
  weakening the 900,000-byte budget.
- GREEN:
  - local bundle: 899,711 bytes;
  - real Windows Bun 1.3.12 bundle: 899,950 bytes;
  - Windows marker/freshness/budget/event suites: 16 passed, 0 failed;
  - Windows reflection reservation suite: 20 consecutive runs passed;
  - focused memory lock/reservation tests and memory-core typecheck passed.
- Cleanup:
  - Windows lock QA sandbox and scripts removed;
  - temporary remote Mac worktree and scripts removed;
  - Windows VM restored to stopped;
  - Parallels Desktop quit;
  - Bunshin client closed.

## Windows lazy-init integration budget

Replacement PR #6760 exposed a separate test-harness timeout:

- GitHub Actions run `31518406016`, job `93869168387`.
- RED: the Git-backed lazy memory initialization completed in 5.657 seconds,
  exceeding Bun's inherited 5-second default. Functional assertions did not
  fail.
- Fix: the existing integration test now declares a bounded 15-second timeout
  on the same line; no assertion or production behavior changed.
- GREEN:
  - focused memory tools suite passed;
  - the formerly failing case completed locally in 743ms;
  - omo-senpi typecheck passed;
  - full omo-senpi suite: 1,127 passed, 0 failed across 165 files.

## Why it is enough

These are the same build, package, daemon, typecheck, and test surfaces used by
the failing `Senpi compatibility` CI job. The stale beta literal and stale
generated bytes that caused the macOS and Ubuntu failures are both exercised.
The post-rebase rerun also covers the concurrent task-lifecycle base change and
keeps the bundle-size contract strict.

## What was omitted

The full npm pack file listing and repetitive individual passing test lines are
summarized above. No credentials, tokens, auth headers, or private environment
values were recorded.
