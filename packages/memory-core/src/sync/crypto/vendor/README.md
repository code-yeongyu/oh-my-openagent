# Vendored sync-format v1 library and sync-v1 fixtures

Source: `sisyphuslabs/omo-service`, commit `e39e23ad1fbe19a39ffd9f5d8d9a867f372c997c`
(`main`: the recovery-phrase kind, #1026/#1029/#1045 as merged). `sync-format/index.ts` and
`sync-format/keys.ts` stay at `5de1455489ea972ef2912e90b88f50628db09359`: upstream now imports
`../vendored/strict-ed25519.ts`, which lies outside the vendored set, and memory-core keeps its own
`crypto/strict-ed25519`. `manifest.json` records that split under `source.held_at`. `fixtures/sync-v1/phrase-chain.json` comes from
#1068's head `b376b5ad072f01bcef4889f073cd9dd418dc6484` (`source.pending_upstream`) and is re-pinned to the merge
commit when that PR merges. The contract package is not yet published
(omo-service #387), so the memory sync client consumes the format library and its golden
fixtures as this vendored copy until it is (work plan memory-sync-e2ee-20261015, todo 13).

- `sync-format/` — byte-identical copy of `packages/contract/src/sync-format/`: the
  WebCrypto-only format library (OMOB frame, STREAM payload, framed Ed25519 signatures, the
  keyring receiver: `receiveKeyringChain` with its fold refusals and fork evidence proof). Implements omo-service `docs/sync-design.md` sections 6-8.
- `fixtures/sync-v1/` — byte-identical copy of the golden fixture data: `chain.json`,
  `keys.json`, `wraps.json`, `vectors.jsonl`, `accounting.json`, `objects/`, `corrupted/`.
  The generator tooling (`gen/`, `generate.mjs`, `check-node.mjs`) is deliberately not
  vendored: fixtures regenerate upstream, and this client tree does not carry a second
  crypto implementation.

`manifest.json` records the base64url SHA-256 of every vendored file.
`../vendor-integrity.test.ts` fails when any vendored file differs from the manifest or the
tree holds a file the manifest does not list.

To re-vendor a newer upstream commit: copy the same file sets, refresh every hash in
`manifest.json` (base64url SHA-256 of each file, paths relative to this directory), and
update the commit above.
