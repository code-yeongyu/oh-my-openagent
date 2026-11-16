# Operator-built darwin release artifacts

A release normally builds every darwin artifact on hosted macOS runners in `publish-platform.yml`. When hosted macOS capacity blocks a release, a maintainer can build those artifacts on their own Mac and publish with them instead (#13921).

## What it replaces

When `operator_darwin_artifacts` is set on the provenance-bearing `publish.yml` run, the following hosted macOS jobs do not run. The verified operator artifacts are uploaded under the same artifact names those jobs use:

| Hosted job | Operator artifacts |
| --- | --- |
| `desktop-engine` darwin-arm64 and darwin-x64 | `senpi-desktop-engine-darwin-*`, plus the signed `omo-engine-trust-helper-darwin-*` |
| `keychain-helper` | `omo-keychain-darwin-universal` |
| `build` darwin-arm64, darwin-x64 and darwin-x64-baseline (release binaries) | `omo-darwin-*` |

The darwin `build` legs still run, on ubuntu. There they only package the npm launcher.

When the input is empty, nothing changes: all the hosted legs run as before.

## Provenance

npm provenance covers the publish run only. The darwin build is attested by three things:
- the Developer ID signature (Team ID `523JNR86LZ`);
- Apple notarization;
- the sha256 of each artifact, which the release's checksum files record.

The run summary names the darwin artifacts as OPERATOR-BUILT and lists every hash and cdhash, the operator, and the dispatching actor.

## Build and upload (maintainer Mac)

```bash
APPLE_API_ISSUER=<issuer id> script/darwin-operator-build.sh <source sha> <version> <evidence dir> --upload
```

The script replays the hosted darwin steps from a fresh worktree at `<source sha>`. It signs and notarizes through `.github/scripts/macos-sign-and-notarize.sh`, which imports the certificate into a scratch keychain per call and deletes it afterwards.

It links a `__OMO_META,__build` section into each engine. The section holds `{source_sha, host, rust_target, version}` and is covered by the engine's signature.

It writes `<artifact>.sha256` files and `operator-darwin-manifest.json`, then uploads everything to the draft release `operator-darwin-<sha12>`. Every step is logged with its timestamp, command, digest and notary submission id in `<evidence dir>/OPERATOR-LOG.md`.

## Publish

Dispatch `publish.yml` with these inputs:
- `prepared_release_sha`;
- `operator_darwin_artifacts=operator-darwin-<sha12>`;
- `operator_darwin_manifest_sha256=<sha256 of the staged operator-darwin-manifest.json>`. The run trusts the draft's files only through that manifest, so editing the draft after dispatch cannot swap an artifact;
- if hosted CI is also waived, the `ci_basis_receipt` inputs.

`gate-reuse` refuses the input in any of these cases:
- `prepared_release_sha` is not a 40-hex SHA;
- the input is not `operator-darwin-<12 hex>`, or the manifest pin is not 64 lowercase hex (or is set without the input);
- `github.actor` or `github.triggering_actor` lacks the `admin` or `maintain` role.

A preparation run (one with an empty `prepared_release_sha`) that sets the input is refused, and it does not dispatch the child run.

## Verification (Linux, before anything consumes the artifacts)

The `operator-darwin` job runs `.github/workflows/operator-darwin-verify.ts` on the downloaded draft release. It refuses unless every one of these checks passes:

1. The dispatcher and triggering actor are re-checked as admin or maintain. The manifest's sha256 equals the pinned `operator_darwin_manifest_sha256`. The asset set is exactly the 8 artifacts, their `.sha256` files and the manifest, and each sha256 matches its `.sha256` file and the manifest.
2. The manifest `source_sha` is `prepared_release_sha`, or an ancestor of it whose diff touches only `.github/workflows/`, the same rule as the `ci_basis_receipt` waiver. The tag names that source.
3. Per Mach-O slice, the verifier checks the signature itself. It uses no external tool and trusts nothing the operator supplies (`operator-darwin-macho.ts`, `operator-darwin-cms.ts`):
   - every code page and every requirements/entitlements blob matches the CodeDirectory, and the CodeDirectory covers every byte before the signature;
   - the CMS has exactly one signer. The certificate it names (by issuer and serial) is the one whose RSA signature over the signed attributes verifies, and the signed message digest is the sha256 of that CodeDirectory;
   - that certificate is a Developer ID Application certificate issued by Apple's Developer ID CA (G2) under the Apple Root CA. Both CAs are pinned by fingerprint; intermediates in the signature's certificate list are never trusted;
   - the team in the CodeDirectory and the team (OU) of that signing certificate are both `523JNR86LZ`;
   - the identifier is the expected one and the hardened runtime is set.
4. Apple's ticket service returns a notarization ticket for every notarized artifact, looked up by the cdhash the verifier computed from the checked CodeDirectory. Bare Mach-O files cannot be stapled, so the ticket lookup replaces stapling. Trust helpers are signed only, as in the hosted path.
5. Each engine's `__OMO_META,__build` section names the source sha, its host and target, and the version.
6. Each `omo-darwin-*` binary embeds the verified engine, trust helper and keychain helper bytes unchanged, inside its signed bytes (the trust helpers are signed only, as on the hosted path, so this containment in a notarized binary is what notarization covers for them). That binds the binary to the engine's signed source stamp.

Trade-offs (accepted):
- No Gatekeeper or OCSP evaluation runs in CI. Notarization is read from Apple's ticket service, as Gatekeeper does for a bare binary.
- These hosted checks run only on the operator's Mac, so they are self-attested in the operator log: the engine and trust-helper selftests, the omo version and eval smokes, and the keychain helper's designated-requirement check.
- The verifier and its pins run from the dispatched ref, the same trust level as publish.yml itself.

Running Gatekeeper or OCSP in CI would need a hosted macOS job, which reintroduces the wait this path removes. The operator's local `codesign --verify --strict` and `spctl -a -t install` verdicts are recorded in the operator log, but they are self-attested.
