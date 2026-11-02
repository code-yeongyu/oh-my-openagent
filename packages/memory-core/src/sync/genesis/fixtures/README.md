# Genesis builder vector

`genesis.json` is the output of `prepareGenesis` followed by `buildGenesis`,
generated with `vector.test-support.ts`. `build.test.ts` recreates it and compares
canonical bytes, including both wraps, signatures, root, digest and links.

All secrets used by this vector are synthetic and test-only. The Ed25519 device
seed is 32 bytes of `1`; the X25519 private scalar is 32 bytes of `2`. Recovery
derivation uses 32 bytes of `3` as the PRF output and 32 bytes of `4` as the
enrollment nonce. The custody nonce is 16 bytes of `5`, the credential ID is
16 bytes of `6`, and epoch 1 uses 32 bytes of `7`. The test sealer uses history
nonces filled with `11` and `12`, and encapsulation private scalars filled with
`21` and `22`, for device and recovery respectively. It uses real AES-GCM and
X25519 HPKE, not opaque fake wraps. Production `sealWrap` is exercised separately
with fresh history nonces and encapsulations.

The golden digest is `roUJzYWqMEiGLSi4Pz1HYboQpseROSSL0tSmvZBI-Mc`.
The countersigned wraps digest covers the entire ordered two-entry array.

## Independent admission check

This vector was also checked against service source commit
`0ea5dfe60cb63a1d828f7094d82ba61e3512de79`, using its real
`packages/core/src/sync/keys/request.ts` `readAppendRequest`,
`keys/derive.ts` digest/link/signature helpers and `keys/admit.ts` `admit`.
The service contract package was resolved to that checkout's own
`packages/contract/src/sync-format/index.ts`, not to the client vendor.

Admission accepted sequence 1, epoch 1 and both exact wraps. Reversed or missing
wraps and a single-wrap digest returned `invalid_request`; a wrong recovery
signature domain or tampered recovery ciphertext with a recomputed wrap digest
and device signature returned `forbidden` at the countersignature rule.
Each negative re-signs unrelated fields so earlier checks cannot hide its rule.
The service treats wraps as opaque; the full creator-anchored client walk and
both real unwraps supply the decryption proof.

The service's fixture-based `signAt` helper could not be imported in the local
source snapshot because its `fixtures/sync-v1/chain.json` was absent. The actual
production derivation and admission functions above were used instead.
The unpublished service package is not a dependency of this client package;
the admission harness and output remain local QA evidence. A service-side
regression test can consume this same public JSON without copying client
construction logic.
