# lazycodex update can never find a newer version on Windows, 2026-09-07

`lazycodex update` reports that it cannot check for updates and exits 1 on Windows, every time, because the npm lookup behind it never runs.

## Failing input, on the published artifact

```
$env:LAZYCODEX_CURRENT_VERSION = '1.0.0'
npx -y lazycodex-ai@latest --dry-run update
```

`artifact-cli-update.log`:

```
npm notice run lazycodex --dry-run update
Unable to check lazycodex-ai updates (unknown-latest).
EXIT=1
```

## Isolating it to the npm lookup

The same command with the version supplied through the environment, so `resolveLatestVersion` returns before it spawns anything (`isolation-latest-supplied.log`):

```
$env:LAZYCODEX_LATEST_VERSION = '4.19.4'
npx -y lazycodex-ai@latest --dry-run update
-> npx.cmd --yes lazycodex-ai@latest install --no-tui --codex-autonomous
EXIT=0
```

Everything after the lookup is healthy. The lookup is the only broken step.

## Mechanism

`red-npm-view.log` runs the shipped call shape under node on this machine:

| call | status | error | the shipped guard `result.status !== 0` | `resolveLatestVersion` returns |
| --- | --- | --- | --- | --- |
| `spawnSync("npm", [...])` as shipped | `null` | `ENOENT spawnSync npm` | `true` | `undefined` |
| the same with `shell: true` | `0` | none | `false` | `"4.19.4"` |

npm is `npm.cmd` on Windows and Node's spawn does not apply `PATHEXT` without a shell. The failure then hides inside the guard: `status` is `null`, not a non-zero exit, so `status !== 0` is true and the function returns `undefined` as though npm had answered with nothing. `resolveLazyCodexUpdatePlan` turns that into `reason: "unknown-latest"` and exit 1.

## RED / GREEN

| run | before | after |
| --- | --- | --- |
| `spawnSync("npm", ["view", ...])` under node, Windows | `status null`, `ENOENT` | `status 0`, `"4.19.4"` |
| `bun test packages/omo-codex/src/install/npm-spawn-options.test.ts` | file did not exist | 3 pass / 0 fail, exit 0 |
| `bun run typecheck` | - | exit 0 |

The published CLI cannot be shown green without a release, so the chain above is what stands in for it: the artifact fails, the failure isolates to the lookup, and the lookup is repaired under the same runtime that runs it.

Logs: `artifact-cli-update.log`, `isolation-latest-supplied.log`, `red-npm-view.log`, `green-unit.log`, `green-typecheck.log`.

## Mutation proof, including the one that is not caught

| mutation | result |
| --- | --- |
| the helper always returns `{}` (`mutation-m1-empty-options.log`) | 1 pass / 2 failed assertions, exit 1 |
| the call site drops `...npmSpawnOptions()` (`mutation-m2-call-site.log`) | 3 pass / 0 fail, **not caught** |

The second gap is real and stated rather than worked around. The test spawns npm through node with and without the options, which reproduces the defect regime, but nothing binds the one call site to the helper. The test runner is bun, and bun resolves `npm.cmd` on its own, so a test that spawned npm directly would have passed either way; that is why the test shells out to node.

## The generated installer bundle is deliberately not in the diff

`packages/omo-codex/scripts/install-dist/install-local.mjs` is tracked and embeds this code. Rebuilding it on a clean `upstream/dev` with no source change already produces a diff (`determinism-rebuild.log`): the marker's source digest is unchanged, but the embedded `@oh-my-opencode/omo-codex` version moves from `5.0.0-beta.43` to `5.0.0-beta.45`. The checked-in bundle is two releases stale and CI regenerates it (`ci.yml` runs `bun run build:codex-install` before the Codex suite), so committing a rebuild here would carry an unrelated version bump. Only the TypeScript source changes.

## Local versions

node v26.1.0, npm 12.0.2, bun 1.3.14, Windows 11, upstream/dev at `ad62603f0`.
