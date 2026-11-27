# sync-v1 golden fixtures

The oracle for every client and server that reads the memory sync format v1
(`docs/sync-design.md` sections 6 to 8.3). Everything here is synthetic: every key, seed, PRF
output and epoch key is a fixed fill byte, never a real credential.

| File | What it is |
| --- | --- |
| `vectors.jsonl` | The 20 canonical-byte vectors printed by the section 8.3 program, which is read from the doc and run as written. The spec's checksum table must match it. |
| `chain.json` | Those vectors decoded: the main keyring chain, the second-recovery and fork branches, the wrap sets, the veto history and the PRF derivation. |
| `keys.json` | The synthetic signing seeds, sealing keys, recovery PRF outputs and epoch keys behind the vectors and objects. |
| `objects/` | Real OMOB objects (STREAM AES-256-GCM, deflate-raw, Ed25519): ops batches at epochs 1 and 3, a three-segment batch pair, a batch by the device the veto rotation excluded, and a two-chunk snapshot. `objects.json` lists each header, digest, decoded payload and the leakage canaries. |
| `corrupted/` | One mutation per region (magic, major, header length, header byte, ciphertext byte, signature byte), reordered, spliced and boundary-truncated streams, a cut tail, and the rotated-out signer's record. `corrupted.json` names each case's base object and the typed failure a reader must report. |
| `wraps.json` | Real HPKE base-mode wraps (fixed ephemerals) to the recovery keys and a wrap-test device, with their key-material envelopes and history. |
| `snapshot.json` | The golden snapshot envelope of section 6: the registering device principal as `author`, `covers_seq`, the digest over the chunk digests in index order, the chain `link` and `keyring_head` at that point, and the `record_sig` over the round-4 preimage (which carries `author`). |
| `accounting.json` | The releasable-bytes table for compaction over the real object sizes (synthetic storage seqs; keyring rows are never releasable). |

Regenerate with `node fixtures/sync-v1/generate.mjs` (an independent `node:crypto`
implementation in `gen/`). A second run must leave `git status` clean on any runtime: every seed,
nonce and timestamp is fixed, and the deflate-raw streams are hand-built stored blocks
(`gen/deflate.mjs`), never the output of a runtime's zlib. CI regenerates on Node 24 and fails on
any diff. `node
fixtures/sync-v1/check-node.mjs` runs the library's conformance checks under Node; the same
checks run under Bun (`bun test packages/contract`) and workerd (`bun run test:cloudflare`).
