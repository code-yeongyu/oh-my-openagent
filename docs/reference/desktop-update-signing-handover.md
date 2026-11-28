# Desktop update signing — hand-over for the desktop release lane

Issue #14916 (CLI side implemented in this repository; this note is the format contract the desktop repository implements). Everything here matches what `packages/release-signing` already ships and what `packages/get-worker/scripts/install.sh` and `packages/omo-native/compiled-update-install.ts` verify.

## The signature

- **Algorithm**: minisign `"ED"` — Ed25519 over the BLAKE2b-512 digest of the signed file's exact bytes. The un-prehashed `"Ed"` id is refused everywhere.
- **File**: a detached `manifest.json.sig` beside `manifest.json`, four LF-terminated lines: `untrusted comment: …`, base64(`ED` ‖ keyid(8) ‖ sig(64)), `trusted comment: …`, base64(sig over the raw 64-byte global signature ‖ trusted-comment text).
- **Keys**: the same pinned CLI release key set (`{primary, backup}`, any-of). Raw 32-byte Ed25519 public keys; keyid = BLAKE2b-512(public key)[0..8]. Public halves are committed in `packages/release-signing/keys/release-keys.json`; the desktop repo pins the same bytes compiled in.
- **Reference verifier**: `packages/release-signing/src/minisign.ts` (`verifyMinisignEd`), exercised by `packages/release-signing/test/vectors/shared-vectors.json` — run the SAME vector file on the desktop side and require identical verdicts.

## The signed object (domain separation, M3)

`manifest.json` must carry, INSIDE the signed bytes:

```json
{ "kind": "omo-desktop-manifest", "version": "<X.Y.Z[-pre]>", "channel": "stable" | "beta", … }
```

- `kind` is the domain tag: a CLI `SHA256SUMS` (whose header token is `# omo-release-v1 …`) can never be presented as a desktop manifest and vice versa — each verifier requires its own kind.
- The signature covers the manifest's exact published bytes; the verifier never re-serializes.

## What the desktop verifier must enforce

1. Download `manifest.json` + `manifest.json.sig`; refuse on a missing or invalid signature under the pinned set (fail closed, distinct message).
2. Require `kind: "omo-desktop-manifest"`, `version`, `channel` inside the signed bytes; refuse anything else.
3. Self-update: signed `version` must be strictly greater than the running version (same ordering as `compareReleaseVersion` in `packages/release-signing/src/checksums-release.ts`); channel must match the requested one. This kills replay-downgrades of older, genuinely signed manifests.
4. macOS and Windows desktop builds already rely on OS code signing; this signature is the independent check for the Linux AppImage/deb path and defense in depth everywhere else.

## Refusal messages (match the CLI wording)

- `desktop update signature missing (manifest.json.sig); refusing to install`
- `desktop update signature invalid; refusing to install (possible tampering)`
- `wrong signed-object kind (expected omo-desktop-manifest); refusing to install`
- `signed version <V> is not newer than the running <R>; refusing (rollback blocked)`
