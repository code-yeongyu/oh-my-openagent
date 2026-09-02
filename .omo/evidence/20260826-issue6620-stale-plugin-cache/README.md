# Evidence — issue 6620: oh-my-openagent@latest executes stale opencode plugin cache

Branch: `fix/6620-stale-plugin-cache` (worktree `/home/viprix/projects/oom-wt-6620`, base `origin/dev` @ 8c57e463e)

## WHAT WAS TESTED

1. **Unit/TDD (bun test):** `packages/omo-opencode/src/hooks/auto-update-checker/hook/background-update-check.test.ts`
   - New: sandbox + stale loaded version + autoUpdate=true -> `invalidatePackage("oh-my-openagent")` called, flat-path `bun install` still skipped (#4318), no false "Updated!" toast, exactly one update-available toast.
   - New: autoUpdate=false in sandbox -> cache untouched, notification only.
   - Pre-existing #4318 tests unchanged and still green.
   - `cache.test.ts`: new test pinning that text bun.lock spec-keyed entries (`oh-my-openagent@latest`, `oh-my-openagent@^4.0.0`) are purged while unrelated entries survive.
2. **Real-surface QA driver** (`logs/qa-driver.ts`, run by `logs/run-qa.sh`): executed the REAL `createBackgroundUpdateCheckRunner` with real filesystem deps (`invalidatePackage`, path resolution via XDG env) against a seeded stale layout replicating the issue:
   - `<cache>/opencode/packages/oh-my-openagent@latest/node_modules/oh-my-openagent/package.json` @ 4.15.1
   - `<cache>/opencode/packages/bun.lock` pinning `oh-my-openagent@latest -> 4.15.1`
   - flat `<cache>/opencode/packages/node_modules/oh-my-openagent` @ 4.15.1
   - opencode.json with `"plugin": ["oh-my-openagent@latest"]`
   Only `getLatestVersion` (network determinism: 4.19.4) and `getModuleHostingWorkspace` (production resolves it from `import.meta.url` inside the sandbox; the driver injects the same value) were injected.
3. **Plugin build:** `bun run build` exit 0 after source changes.

## WHAT WAS OBSERVED

- RED first: sandbox invalidation test failed with `Expected: ["oh-my-openagent"], But it was not called` (`logs/red-test.log`); lock-purge test failed with 2 spec keys surviving (`logs/red-test-lock.log`).
- GREEN after fix: 108/108 tests pass across auto-update-checker + all four zauc-mocks suites (`logs/green-test.log`, `gates-run1.log`, `gates-run2.log`).
- QA transcript (`logs/qa-transcript.txt`), all PASS, QA_EXIT:0:
  - code under test resolved cache/config dirs INSIDE the sandbox (path isolation self-proof),
  - stale per-spec sandbox removed,
  - flat node_modules copy removed,
  - bun.lock pin purged (spec-keyed entry gone).
- Isolation proof: host snapshots of `~/.omo`, `~/.senpi`, `~/.config/opencode`, `~/.codex`, `~/.cache/opencode` taken before / control (no-QA window) / after (`logs/isolation-*.txt`). `.senpi`, `.codex`, `.cache/opencode` byte-identical throughout. `~/.omo` and `~/.config/opencode` show drift IDENTICAL to the no-QA control window - ambient writes from this host's own live OMO daemons (this session runs inside OMO), not from the QA run. The driver-level self-proof plus the control-window comparison attribute zero host writes to QA.

## WHY IT IS ENOUGH

The changed production behavior is exactly "when an update is detected for an OpenCode-managed sandbox install, invalidate the stale per-spec cache". The QA driver exercised that exact code path on real disk with real fs semantics and reproduced all three removals of the reporter's proven manual workaround (`rm -rf` sandbox + flat node_modules + bun.lock). The lock purge extension is covered by both unit test and QA: without it, the shared `packages/bun.lock` keeps pinning the tag's first resolution and next-start reinstall would restore the SAME stale version - which is precisely the reported persistence mechanism. Remaining regression risk is low: the #4318 guarantees (no flat-path install, truthful toast) are pinned by pre-existing tests that still pass.

## WHAT WAS OMITTED / REDACTED

- No live `opencode serve` boot was driven end-to-end: a real next-start reinstall fetches `oh-my-openagent@latest` from npm (network + registry nondeterminism) and would exercise OpenCode's loader, not our changed code. The changed surface (invalidation) is fully covered above; OpenCode's reinstall-on-missing-sandbox behavior is external and was demonstrated by the issue reporter.
- Toast rendering was stubbed at `ctx.client.tui.showToast` (no TUI in driver context); toast content is unchanged from the existing "Restart OpenCode to apply" wording, now truthful because restart actually applies.
- Host snapshot hashes are sha256 digests only; no file contents from real home directories were read or copied into evidence.
