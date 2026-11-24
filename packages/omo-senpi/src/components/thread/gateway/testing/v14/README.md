# Historical schema-v14 worker

`gateway-store-worker.mjs` is an immutable compatibility fixture: the store worker bundle omo shipped at gateway
schema 14, copied byte for byte from `packages/omo-senpi/plugin/extensions/gateway-store-worker.mjs` at source commit
`83a998a07743d0a5c0e60a216697ce091f447981`:

```sh
git show 83a998a07743:packages/omo-senpi/plugin/extensions/gateway-store-worker.mjs > gateway-store-worker.mjs
```

SHA-256: `a4671a33545458313e8c8c0eac700110af478c184b9c133031845951cc01fb02`.

Do not regenerate it from current sources. `store-v14-worker.test.ts` runs it beside the current worker: a v14
worker opened before the current binary migrates the store keeps reading and writing (v15 `start` rows, no
`collapse_key`), and one opened afterwards refuses the newer store, because v14 predates the reader floor.
