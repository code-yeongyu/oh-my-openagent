# PR #7500 post-merge cleanup: final error-semantics evidence

Validated production source head: `7796dd423bd2867042e42860506f00a0d8877b8d`, based on current-dev
combined evidence head `a6d8f10a9214dac7df70d96c284ee2ebceb4075b`.

## Deterministic RED

[`isolation-error-semantics-red.log`](isolation-error-semantics-red.log) records 26 pass / 5 fail
before production changes:

- recursive and protected pre-open replacement was misclassified `FILE_CHANGED`;
- close failure replaced an earlier recursive/protected primary error;
- close failure replaced the absence-race `FILE_REPLACED` primary error;
- `digestDirectory` ignored its injected read seam and lacked transient read filtering;
- isolated child environments omitted Windows `USERPROFILE`.

All races and errors are injected synchronously at stat/open/read/close seams. No sleeps, permissions,
platform skips, or timing luck are used.

## GREEN semantics

- Initial-path to opened-descriptor metadata changes preserve the exact `changedMetadataCode` result.
  If the opened descriptor also differs from the current path, that additional race is independently
  `FILE_REPLACED`.
- Recursive and protected close errors surface only when the operation has no primary error. Read,
  stat, metadata, and absence-race codes retain precedence over close failure. Successful read plus
  failed close remains incomplete with the sanitized close code.
- The ENOENT-stat/open-success branch retains `FILE_REPLACED` even if close also fails.
- `digestDirectory` tolerates only `ENOENT` and `ENOTDIR` from recursion or read. `EACCES`, `EIO`, and
  all other errors propagate. Surviving files retain sorted deterministic digest input.
- Child QA isolation sets both `HOME` and `USERPROFILE` to the caller sandbox home without a platform
  skip.
- Bigint mutation metadata, ENOENT-only protected absence, hard byte bounds, oversized-file
  truncation, transient bounded observations, volatile settings normalization, and current-dev
  inventory fields remain unchanged.

## Exact-head gates

- Combined isolation/task: 31 pass, 0 fail.
- Upstream Senpi hooks regressions: 9 pass, 0 fail.
- OAuth/compile-entry: 26 pass, 0 fail.
- Package/pin: 20 pass, 0 fail.
- Packed OAuth consumer: 1 pass, 0 fail.
- Real live Senpi driver: PASS; protected snapshots complete/error-free/untouched, observations
  bounded, caller directory ignored, sandbox removed.
- Serialized gate: 2,473 pass, 7 platform skips, 0 fail; resolver 10 pass, 0 fail.
- Extension freshness, relevant typechecks, LSP, Biome, and integration-owned no-excuse checks pass.

Current dev's packed installer remains OAuth-only; root hooks tests exercise pristine Senpi 2026.8.31.
A clean packed-consumer hooks semantics proof remains a separate missing gate. Evidence contains no
protected content, hashes, secrets, tokens, private keys, or raw environment output.
