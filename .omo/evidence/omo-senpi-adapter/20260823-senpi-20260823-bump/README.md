# Evidence: bump @code-yeongyu/senpi 2026.8.22-2 → 2026.8.23

Date: 2026-08-23 (KST 2026-08-24 00:2x). Branch `chore/bump-senpi-20260823` off `origin/dev` (70b959499).

## What changed

- `@code-yeongyu/senpi` pinned `2026.8.23` in all four manifests: root `package.json`, `packages/omo-senpi/package.json`, `packages/senpi-task/package.json`, `packages/omo-native/package.json`; `bun.lock` refreshed via `bun install`.
- `packages/omo-senpi/src/package-shape.test.ts` contract pins moved from `2026.8.22-2` to `2026.8.23` (peer + dev dependency assertions). This is the package-shape contract that must move with every bump.

Upstream v2026.8.23 carries code-yeongyu/senpi#1090 (detached eval cell notices delivered as internal custom messages instead of synthetic user input — the composer STEERING leak), plus #1092 (kimi xtml channel marker leak) and #1088 (cursor composer operating prefix) in the same release.

## Why no bundle regeneration

`@code-yeongyu/senpi` is an external loader alias in the extension build (`SENPI_LOADER_ALIASES`, `packages/omo-senpi/plugin/scripts/build-extension.mjs`), so the committed bundles do not inline senpi code. Verified: `node packages/omo-senpi/plugin/scripts/build-extension.mjs --check` exits 0 ("extension build is current") with the new version installed.

## Gates

| Gate | Command | Result |
|---|---|---|
| Bundle current | `node packages/omo-senpi/plugin/scripts/build-extension.mjs --check` | exit 0, build current |
| Typecheck | `npx tsgo --noEmit -p packages/omo-senpi/tsconfig.json` | exit 0 |
| Unit suite | `bun run test:senpi` | 2206 pass / 1 skip / 13 fail — see below |
| Live adapter QA | `SENPI_BIN=<worktree>/node_modules/.bin/senpi node packages/omo-senpi/scripts/qa/drive.mjs --out <this dir>` | `drive-verdict.json`: result PASS, ultraworkInjected true, commentChecker PASS, realSenpiUntouched true, isolated sandbox agent dir |

## The 13 unit failures are pre-existing, not caused by this bump

Baselined by stashing the bump and running on clean `origin/dev` in the same worktree:

- 10 × `createInitDeepAdvisorComponent` / `session_start component ordering` (`bun test packages/omo-senpi/src/components/init-deep-advisor` on clean dev: 90 pass / 10 fail — identical set)
- 1 × `cli-local` install/uninstall round-trip (clean dev: fail at same assertion, `src/install/cli-local.test.ts:143`)
- 1 × `OmO Native product identity` native state path (documented pre-existing; `getOmoNativeStateDir` resolves the real `~/.omo/agent` in local runs)

With the bump applied, the only bump-attributable failure was `package-shape` (peer pin), fixed by moving the pin; totals went 2205→2206 pass, 14→13 fail. Full log: `test-senpi-full.log`.

## Why this evidence is enough

The bump's only reachable risk surface is (a) manifest/lockfile correctness — proven by package-shape + lockfile + typecheck; (b) adapter-vs-senpi runtime compatibility — proven by the live drive against the actual installed 2026.8.23 binary with the real agent dir untouched. The steering-leak fix itself was proven upstream in senpi PR #1090 (failing-first test + full CI matrix); omo does not re-test senpi internals.

## Residual risk

The 13 pre-existing failures remain open on dev independent of this change. No new risk introduced.
