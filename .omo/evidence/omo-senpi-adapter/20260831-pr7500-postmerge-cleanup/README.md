# PR #7500 post-merge cleanup: mutation-safe isolation evidence

Validated production source head: `e9520d38abc52aaebcc2322ed06dd9fd571f7fba`, based on combined-head
evidence commit `6b67bb4051ca77d82b2a07c5571877e7fdc83773`.

## Review findings and deterministic RED

[`isolation-metadata-blockers-red.log`](isolation-metadata-blockers-red.log) records 9 pass / 3 fail
before production changes:

- a same-inode, same-size recursive overwrite after the descriptor read was accepted as complete;
- the same overwrite after the protected read was accepted as complete and could remain untouched;
- inaccessible protected state was classified absent because an existence probe returned false.

The byte-budget regression was already green at RED: an oversized file yielded `complete=false`,
`truncated=true`, `errors=[]`, and zero reads. This is the public limit contract.

## GREEN and implementation

- [`focused-tests.log`](focused-tests.log): isolation/task contracts 23 pass, OAuth/compile-entry 26
  pass, package/pin 20 pass.
- Recursive and protected reads compare bigint `dev`, `ino`, `size`, `mtimeNs`, and `ctimeNs` before
  and after reading and against final path identity. Same-identity metadata movement is
  `FILE_CHANGED`; identity movement is `FILE_REPLACED`.
- Protected digest/settings normalization consumes bytes read from the verified descriptor inside
  that metadata window. There is no protected `existsSync` absence decision.
- Absence requires both direct path stat and direct open to return `ENOENT`. Any other stat/open/read,
  final-stat, or close failure is sanitized to relative path plus code and makes the snapshot
  incomplete, so untouched is false.
- Oversized observation files truncate before opening. The hard `maxBytes` guarantee remains, and
  dead internal `BYTE_LIMIT` branches/classification were removed.
- [`driver-live.json`](driver-live.json) and [`driver-live-validation.json`](driver-live-validation.json):
  live Senpi 2026.8.31 PASS; protected snapshots complete, error-free, and untouched; observation
  reads bounded; sandbox removed.
- [`senpi-gate.log`](senpi-gate.log): serialized gate 2,465 pass, 7 platform skips, 0 fail; resolver
  10 pass, 0 fail.
- [`typecheck-build-receipt.txt`](typecheck-build-receipt.txt): extension freshness, relevant
  typechecks, LSP, Biome, and no-excuse checks passed.

## Platform behavior and evidence safety

Node bigint stat fields provide nanosecond timestamps where the platform exposes them and preserve
the platform's stable integer representation without millisecond coercion. Filesystems with coarse
native timestamp precision cannot provide precision Node does not have; identity, size, mtime, and
ctime are nevertheless compared using the highest-resolution values available. Windows/POSIX error
codes remain sanitized strings.

Evidence contains no protected bytes, snapshot hashes, credential hashes, secrets, private keys,
tokens, or raw environment output. PR #7545 remains the independent source of the Senpi 2026.8.31
pin. The historical packed-install artifact is not relabeled as an exact-head rerun.
