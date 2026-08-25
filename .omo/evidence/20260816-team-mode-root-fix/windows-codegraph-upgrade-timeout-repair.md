# Windows codegraph upgrade test timeout repair (PR #6894 CI)

## Failure source

- GitHub Actions run 31937818367 (PR #6894 head e7dc083a0), jobs 95144046710 (`test (windows-latest, 1/2)`) and 95144046698 (`test (windows-latest, 2/2)`).
- Failed test (both shards): `ensureCodegraphProvisioned version upgrades > #given a managed 1.0.1 runtime #when provisioning the current pin #then it replaces the stale runtime`, timed out after 5000ms (6031ms / 5203ms).
- Log proof: the fixture's `execFileSync("tar", ["-czf", ...])` (codegraph-provision-upgrade.test.ts:17) hung until Bun's timeout handler fired (`killed 1 dangling process`), then surfaced as `error: Command failed: tar ... signal: "SIGTERM", status: null`.
- Same tree on dev's latest CI (run 31938075210, jobs 95143033558/95143033660): the SAME test passed in **125ms** on both Windows shards. `git diff origin/dev -- packages/utils` is EMPTY, so this branch does not change the code under test.

## Diagnosis

First `tar` invocation on a cold Windows runner exceeded Bun's 5000ms default test budget (cold-start process scan); warm runs complete in ~125ms. This is the same failure class already repaired on the sibling file by commit fa6740ae8 (2026-06-26, PR #5565 CI repair), which added an explicit 15000ms timeout to the real-archive extraction test in codegraph-provision.test.ts.

## Fix

- Added `ARCHIVE_FIXTURE_TEST_TIMEOUT_MS = 15_000` and applied it to the three tests in `packages/utils/src/codegraph-provision-upgrade.test.ts` whose fixtures invoke `tar` via `createArchive` (the 1.0.1 and 1.4.1 upgrade variants and the marker-mismatch variant).
- Production code and assertions unchanged. The verification-failure test (no tar) keeps the default budget.

## Verification

- `bun test packages/utils/src/codegraph-provision-upgrade.test.ts packages/utils/src/codegraph-provision.test.ts` -> 11 pass / 0 fail.
- `bunx tsgo --noEmit -p packages/utils/tsconfig.json` -> exit 0.
- Full CI re-run on the new head is the authoritative Windows surface.

## Omitted

- No production behavior was touched; no bundle regeneration needed (test-only change under packages/utils).
