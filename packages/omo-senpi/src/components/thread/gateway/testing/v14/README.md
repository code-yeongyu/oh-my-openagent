# Historical schema-v14 worker

`gateway-store-worker.mjs` is an immutable compatibility fixture: the gateway store worker of the last build whose
schema stops at v14 (before the v15 `deliveries` rebuild that lets `mode_effective` record `start`). It was bundled
from `packages/omo-senpi/src/components/thread/gateway/store-worker.ts` at source commit
`83a998a07743d0a5c0e60a216697ce091f447981` with Bun 1.4.4, then formatted with the repository's `bun fmt` (SHA-256 of the formatted file:
`20cd2b20896cadba4fd4a6e73246a013cd35ab5243f1ebd96554a01d1fc412c7`):

```sh
bun build --target=node --format=esm --minify packages/omo-senpi/src/components/thread/gateway/store-worker.ts --outfile gateway-store-worker.mjs
```

Do not regenerate it from current sources. `store-v15-start-lane.test.ts` opens a store the current build migrated
with this worker and expects the older build's typed `gateway_schema_too_new` refusal, with the store untouched.
