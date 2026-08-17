# omo-ai Publishing Runbook

`omo-ai` is the npm package for the senpi-native edition of OMO. It ships a single bin, `omo`, which launches the exact-pinned `@code-yeongyu/senpi` release with the full OMO extension loaded. This runbook records the registry state the package was bootstrapped into, the mechanism that keeps the package beta-only, and the checks a maintainer runs around each release.

The package publishes exclusively through GitHub Actions (`publish.yml`) with npm OIDC trusted publishing. There is no local publish path, and this document must never grow one.

## Bootstrap state (measured 2026-08-03)

The name was reserved with a one-time placeholder publish:

- `omo-ai@0.0.0-beta.0` was published public with `--tag beta`, using a scoped granular token that was issued, used, and revoked on the same day (2026-08-03).
- The placeholder was then `npm deprecate`d with a message pointing users at the beta channel.
- npm set the `latest` dist-tag on that first publish and refuses to delete it. Deletion was attempted and the registry answered E400 (measured 2026-08-03). `latest` therefore stays pinned to the deprecated `0.0.0-beta.0` placeholder forever, by design.

Never republish the placeholder and never recreate the bootstrap token. Both were one-time actions; the pipeline covers everything after them.

## How the beta gate works

The gate is registry semantics, not the deprecation message:

1. A bare `npm i -g omo-ai` resolves the default spec as the range `*`.
2. Prerelease versions never satisfy `*`.
3. Every omo-ai version is a prerelease: the placeholder is `0.0.0-beta.0`, and the release pipeline maps each root version to a prerelease (`X.Y.Z` becomes `X.Y.Z-1`, `X.Y.Z-foo` becomes `X.Y.Z-0.foo`), so no stable version can ever exist.
4. Resolution finds no candidate and fails with ETARGET: `No matching version found for omo-ai@*` (measured live 2026-08-09).

The deprecation notice on the placeholder is cosmetic guidance only. Deprecation does not affect npm resolution, and un-deprecating the placeholder would not open the bare channel. The only thing that could is publishing a non-prerelease version, which the version mapping makes impossible.

Installing works only with an explicit opt-in:

```bash
npm i -g omo-ai@beta
```

Repository beta releases are dispatched with `/publish <explicit-semver>`, for example `/publish 5.0.0-beta.9`. The command sends that exact value through the workflow's `version` input, records the returned workflow run ID, and follows only that run. Release notes compare a beta against the preceding beta in the same channel, and the GitHub release is created with prerelease metadata explicitly set.

## Trusted Publisher (MERGE GATE, currently UNVERIFIED)

The npmjs.com Trusted Publisher entry for omo-ai is not confirmed saved. The WebAuthn-gated save failed 3 consecutive passkey attempts on 2026-08-03 ("Something went wrong"), so its persistence is unknown.

This must be verified before the omo-ai PR merges, not before the first release. The publish workflow's preflight-trust check is unconditional and runs for every package at the `prepare-release-state`, `publish-main`, and `publish-platform` stages (publish.yml:345, :559, :920). An unverified omo-ai entry would fail the entire next release, for every package in the repo.

Verification procedure (npmjs.com, may need one Touch ID or security-key approval):

1. Open package `omo-ai`, then Settings, then Trusted Publisher.
2. Configure GitHub Actions: org/user `code-yeongyu`, repository `oh-my-openagent`, workflow `publish.yml`, environment left blank, permission "Allow npm publish" only.
3. Save, then reload the settings page and confirm the entry persisted. Capture a screenshot as evidence.
4. Confirm the npm access tokens list shows no live omo-ai token.

## Beta channel contract

- Every omo-ai publish uses `--tag beta`. Always. The tag is hardcoded in the workflow and independent of the repo-wide `DIST_TAG` derivation.
- Every version is a prerelease, forever, through the release mapping described above.
- `latest` never advances past the placeholder. Leaving beta is out of scope for this plan and requires a separately approved plan.
- Remediation if `latest` ever advances anyway:

```bash
npm dist-tag add omo-ai@0.0.0-beta.0 latest
```

## First-beta-release checklist (user-dispatched)

The first real omo-ai release is not automated into any merge. The user dispatches `publish.yml` as usual, then confirms in the run log:

- [ ] The bin-ownership assertion passed (root `package.json` does not re-declare `.bin.omo`).
- [ ] The omo-ai stamp, build, payload-verify, and publish steps ran with OIDC. No `NODE_AUTH_TOKEN` appears anywhere in the omo-ai steps.
- [ ] The dist-tag guard passed: `beta` points at the new version and `latest` is still `0.0.0-beta.0`.
- [ ] Live verification passed: a fresh-prefix `npm i -g omo-ai@beta` installed the stamped version, `omo --version` exited 0, and the bare-channel `npm i -g omo-ai` probe failed with ETARGET.

## Brand contract (what makes the product read as omo)

The launcher hands the pinned engine a single `SENPI_BRAND` JSON profile before spawning it. The
engine resolves it once and then scrubs it, so a senpi the agent itself spawns keeps the engine
identity instead of impersonating the product.

| field | value | effect |
| --- | --- | --- |
| `name` | `omo` | welcome header, terminal titles, help, tips, first-run, system-prompt identity |
| `displayVersion` | the omo-ai version | `omo --version` and the TUI header; the engine version stays internal for update comparisons |
| `configDir` + `flatLayout` | `.omo`, nested | agent state lives at `~/.omo/agent` - the one directory every omo entry point resolves through `bin/lib/agent-dir.js`; the launcher pins it for the engine with `OMO_CODING_AGENT_DIR` plus the legacy `SENPI_CODING_AGENT_DIR` |
| `envPrefix` | `OMO` | `OMO_*` variables are read first, then the legacy `SENPI_*` and `PI_*` names |
| `userAgent` / `originator` | `omo` | outgoing request identity |
| `update` | `omo-ai`, `beta`, `npm i -g omo-ai@beta` | the update banner checks the beta dist-tag of omo-ai and prints the product's own command |

The update channel matters: omo-ai's `latest` tag is pinned to the deprecated bootstrap
placeholder forever, so a `latest` lookup would never see a release. The engine therefore reads
the dist-tag named in the profile. `omo update`, `omo update --self` and the engine's own
self-update path all answer with the npm command instead of replacing the pinned engine.

Requires an engine release that understands `SENPI_BRAND`; the pin in `packages/omo-native/package.json`
must point at that release or newer.

## Install and upgrade order (EEXIST)

Machines that still carry a pre-rename root package (oh-my-openagent or oh-my-opencode at 4.19.4 or earlier) have a global `omo` bin shim from that package. Installing omo-ai on top of it fails with EEXIST because npm refuses to overwrite a bin link owned by another package.

Order matters:

1. First upgrade oh-my-openagent/oh-my-opencode to a post-rename release (which drops the `omo` bin), or uninstall it.
2. Then `npm i -g omo-ai@beta`.

Machines already on a renamed release have no global `omo` and install cleanly in one step.
