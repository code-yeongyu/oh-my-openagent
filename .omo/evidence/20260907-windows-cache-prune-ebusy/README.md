# Cache prune aborts on Windows when the old runtime is still alive, 2026-09-07

`pruneMarketplaceCache` removes stale cache entries with `rm(dir, { recursive: true, force: true })`. Windows refuses to unlink a mapped image, so if anything spawned from the previous cache is still running, the call fails immediately and the entry survives. `install-codex.ts:157` and `:163` call it on every install and update, which is exactly when a leftover MCP server or daemon is most likely to still be alive.

## Failing input

A cache entry holding a running executable, with that process exiting 300 ms later, driven through the real `pruneMarketplaceCache`:

`red-prune-both-runtimes.log`, against `upstream/dev`:

```
bun 1.3.14   | pruneMarketplaceCache -> threw EACCES | removed=false | 2ms
node v26.1.0 | pruneMarketplaceCache -> threw EPERM  | removed=false | 4ms
```

`green-prune-both-runtimes.log`, with the fix:

```
bun 1.3.14   | pruneMarketplaceCache -> resolved | removed=true | 405ms
node v26.1.0 | pruneMarketplaceCache -> resolved | removed=true | 393ms
```

## Why the obvious fix is the wrong one

Node's `rm` accepts `maxRetries` and `retryDelay`, and the repo already uses them for cache removal in `packages/omo-codex/plugin/scripts/sync-skills.mjs:250`. That option does not work here, because the two runtimes disagree (`probe-runtime-split.log`):

| runtime | no retry | `maxRetries: 5, retryDelay: 100` |
| --- | --- | --- |
| node v26.1.0 | EPERM | ok in 644ms |
| bun 1.3.14 | EACCES | EACCES, 1ms |

bun reports `EACCES` and ignores the retry options, and `EACCES` is not in Node's retriable set either. An explicit retry loop covering `EPERM`, `EBUSY`, `EACCES` and `ENOTEMPTY` is what works on both.

This nearly produced the wrong conclusion. The first driver ran under bun only, where the fix and the unfixed source both failed, which reads as "the fix does not work" rather than "the runtime differs".

## RED / GREEN

| run | before | after |
| --- | --- | --- |
| `pruneMarketplaceCache` with a live runtime that exits after 300 ms, under node | EPERM, entry survives | resolved, entry removed |
| the same under bun | EACCES, entry survives | resolved, entry removed |
| `bun test packages/omo-codex/src/install/codex-cache-prune.test.ts` | file did not exist | 1 pass / 0 fail |
| `bun run typecheck` | - | exit 0 |
| `bun test script/codex-install-bundle-freshness.test.ts` | exit 1 until the bundle was regenerated | exit 0 |

## Mutation proof

Reverting `codex-cache-prune.ts` to `upstream/dev` fails the new test with `EACCES: permission denied, rm ...omo-old` (`mutation-revert-fix.log`). On a platform that allows unlinking a running executable the assertion holds either way, so the mutation only bites on Windows.

## The shape of the fix

`removeWithRetry` mirrors `renameWithRetry` in `codex-config-atomic-write.ts`: a delay ladder and a set of retriable codes. The ladder is longer, `[50, 100, 200, 400, 800]` against that file's `[10, 25, 50]`, because 85 ms is not enough for a process to finish exiting.

## Local versions

node v26.1.0, bun 1.3.14, Windows 11, upstream/dev at `ad62603f0`.
