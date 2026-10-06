# Historical schema-v4 worker

`gateway-store-worker.mjs` is an immutable compatibility fixture, bundled from
`packages/omo-senpi/src/components/thread/gateway/store-worker.ts` at source commit
`1d80dd675dcb4eac0456d682e007233f785bd0d8` with Bun 1.4.2:

```sh
bun build --target=node --format=esm --minify packages/omo-senpi/src/components/thread/gateway/store-worker.ts --outfile gateway-store-worker.mjs
```

SHA-256: `624d59b6953156d2458fea0fdebbb7293e093e16c0000f87ccc159ca68113eed`.

Do not regenerate it from current sources. The compatibility test runs this
historical worker against a populated v5 database, writes through its old core
path, and reopens with the current worker. Its legacy write omits actor_user_id;
the test distinguishes that behavior from accidentally exercising a v5 worker.
