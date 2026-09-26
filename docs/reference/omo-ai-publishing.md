# omo-ai Publishing Runbook

`omo-ai` is the npm package for OmO Native. It ships a single bin, `omo`, which launches the exact-pinned `@code-yeongyu/senpi` release with the full OMO extension loaded. This runbook records the registry state the package was bootstrapped into, how a release picks its channel, and the checks a maintainer runs around each release.

The package publishes exclusively through GitHub Actions (`publish.yml`) with npm OIDC trusted publishing. There is no local publish path, and this document must never grow one.

## Bootstrap state (measured 2026-08-03)

The name was reserved with a one-time placeholder publish:

- `omo-ai@0.0.0-beta.0` was published public with `--tag beta`, using a scoped granular token that was issued, used, and revoked on the same day (2026-08-03).
- The placeholder was then `npm deprecate`d with a message pointing users at the beta channel.
- npm set the `latest` dist-tag on that first publish and refuses to delete it. Deletion was attempted and the registry answered E400 (measured 2026-08-03). `latest` stayed on the deprecated `0.0.0-beta.0` placeholder through the whole 5.0.0 beta line, until the first stable release moved it.

Never republish the placeholder and never recreate the bootstrap token. Both were one-time actions; the pipeline covers everything after them.

## How a release picks its channel

The channel follows the version being released (`Calculate omo-ai metadata` in `publish.yml`):

| Root version | omo-ai version | dist-tag | Install line |
| --- | --- | --- | --- |
| `X.Y.Z-<suffix>` (prerelease) | `X.Y.Z-0.<suffix>` | `beta` | `bun add -g omo-ai@beta` |
| `X.Y.Z` (stable) | `X.Y.Z` | `latest` | `bun add -g omo-ai` |

Every product surface derives the same spelling from the running package's own version: the update banner (`update.distTag`), `omo update`, `omo doctor`, the launcher's reinstall hints, the OpenCode installer and its in-session nudge, and the release-notes install footer. A stable build never tells a user to add `@beta`, and a prerelease build never points at `latest`.

History: through the 5.0.0 beta line every root version mapped to a prerelease (`X.Y.Z` became `X.Y.Z-1`), so a bare `npm i -g omo-ai` resolved nothing and failed with ETARGET (measured 2026-08-09). The 5.0.0 release retired that gate.

Repository beta releases are dispatched with `/publish <explicit-semver>`, for example `/publish 5.0.0-beta.9`. The command sends that exact value through the workflow's `version` input, records the returned workflow run ID, and follows only that run. Release notes compare a beta against the preceding beta in the same channel. The GitHub release itself is always a full release, never a GitHub pre-release: the npm dist-tag carries the channel semantics. The **Latest** badge is decided by [`script/release-latest-flag.ts`](../../script/release-latest-flag.ts) from the highest already published semver (`Bun.semver` ordering, non-semver tags such as `_pr-attachments` ignored), not by creation order, so a hotfix dispatched for an older line gets `--latest=false` and does not steal the badge. That badge is load-bearing: the compiled `omo` binary's update hint downloads from `releases/latest/download/<asset>`.

## Trusted Publisher (MERGE GATE, currently UNVERIFIED)

The npmjs.com Trusted Publisher entry for omo-ai is not confirmed saved. The WebAuthn-gated save failed 3 consecutive passkey attempts on 2026-08-03 ("Something went wrong"), so its persistence is unknown.

This must be verified before the omo-ai PR merges, not before the first release. The publish workflow's preflight-trust check is unconditional and runs for every package at the `prepare-release-state`, `publish-main`, and `publish-platform` stages (publish.yml:345, :559, :920). An unverified omo-ai entry would fail the entire next release, for every package in the repo.

Verification procedure (npmjs.com, may need one Touch ID or security-key approval):

1. Open package `omo-ai`, then Settings, then Trusted Publisher.
2. Configure GitHub Actions: org/user `code-yeongyu`, repository `oh-my-openagent`, workflow `publish.yml`, environment left blank, permission "Allow npm publish" only.
3. Save, then reload the settings page and confirm the entry persisted. Capture a screenshot as evidence.
4. Confirm the npm access tokens list shows no live omo-ai token.

## Channel contract

- A prerelease publishes with `--tag beta`; a stable release publishes with `--tag latest`. The tag comes from `omo_ai_dist_tag`, never from the repo-wide `DIST_TAG`.
- `Guard omo-ai dist-tags` asserts the channel tag points at the new version, and that a prerelease never lands on `latest`.
- `Verify omo-ai live install` installs the channel's own spelling in a fresh prefix (`omo-ai` for stable, `omo-ai@beta` for a prerelease) and requires the new version.
- After a stable release, move `beta` to it with `npm-dist-tag-rollback.yml` (`version=X.Y.Z`, `dist_tag=beta`) so users still on `@beta` get the stable build.
- Remediation if a prerelease ever reaches `latest`: `npm dist-tag add omo-ai@<last stable> latest`.

## Release checklist

The user dispatches `publish.yml` as usual, then confirms in the run log:

- [ ] The bin-ownership assertion passed (root `package.json` does not re-declare `.bin.omo`).
- [ ] The omo-ai stamp, build, payload-verify, and publish steps ran with OIDC. No `NODE_AUTH_TOKEN` appears anywhere in the omo-ai steps.
- [ ] The dist-tag guard passed: the channel tag (`latest` for stable, `beta` for a prerelease) points at the new version.
- [ ] Live verification passed: a fresh-prefix install of the channel spelling installed the stamped version and `omo --version` exited 0.

## Brand contract (what makes the product read as omo)

The launcher hands the pinned engine a single `SENPI_BRAND` JSON profile before spawning it. The
engine resolves it once and then scrubs it, so a senpi engine the agent itself spawns keeps the engine
identity instead of impersonating the product.

| field | value | effect |
| --- | --- | --- |
| `name` | `OmO` | welcome header, terminal titles, help, tips, first-run, system-prompt identity |
| `displayVersion` | the omo-ai version | `omo --version` and the TUI header; the engine version stays internal for update comparisons |
| `configDir` + `flatLayout` | `.omo`, nested | agent state lives at `~/.omo/agent` - the one directory every omo entry point resolves through `bin/lib/agent-dir.js`; the launcher pins it for the engine with `OMO_CODING_AGENT_DIR` plus the legacy `SENPI_CODING_AGENT_DIR` |
| `envPrefix` | `OMO` | `OMO_*` variables are read first, then the legacy `SENPI_*` and `PI_*` names |
| `userAgent` / `originator` | `omo` | outgoing request identity |
| `update` | `omo-ai`, the channel tag, `npm i -g omo-ai` (stable) or `npm i -g omo-ai@beta` (prerelease) | the update banner checks the dist-tag of this build's channel and prints the product's own command |

The display name also becomes Senpi's `APP_NAME`, so process titles, exported
session filenames, debug-log filenames, and opt-in provider attribution headers
use `OmO`. Machine contracts remain explicitly pinned by the other fields:
`.omo`, `OMO_*`, the `omo` User-Agent/originator, and the lowercase `omo`
command/package names do not derive from the display spelling.

The update channel matters: omo-ai's `latest` tag is pinned to the deprecated bootstrap
placeholder forever, so a `latest` lookup would never see a release. The engine therefore reads
the dist-tag named in the profile. `omo update`, `omo update --self` and the engine's own
self-update path all answer with the npm command instead of replacing the pinned engine.

Requires an engine release that understands `SENPI_BRAND`; the pin in `packages/omo-native/package.json`
must point at that release or newer.

## Install and upgrade order (EEXIST)

Machines that still carry a pre-rename root package (oh-my-openagent or oh-my-opencode at 4.19.4 or earlier) have a global `omo` bin shim from that package. `latest` is still 4.19.4, so this is the state of every machine that never moved to the 5.x beta. Two ways it breaks:

- `npm i -g omo-ai@beta` fails with `EEXIST: file already exists <prefix>/bin/omo`; npm refuses to overwrite a bin link owned by another package.
- `bun add -g omo-ai@beta` succeeds into the bun prefix, but both bins now exist. With the npm prefix earlier on PATH, `omo --version` keeps printing `4.19.4` and the user is silently running the old CLI.

`bunx oh-my-openagent@beta install --platform=native` is the supported path and does the ordering itself (the `@beta` tag is required: `latest` 4.19.4 rejects `--platform=native`):

1. It scans the PATH directories and the bun global bin dir for an `omo` command, resolves each to its owning package (symlink target, or the package path inside a launcher shim), and removes only the ones owned by oh-my-openagent / oh-my-opencode, plus the generated `omo` wrapper a pre-rename Codex Light install wrote into `~/.local/bin`. The package itself and its other commands (`oh-my-openagent`, `lazycodex`, ...) stay; only the alias the rename orphaned is dropped, and the removal is printed.
2. It installs `omo-ai@beta` with bun, or npm when bun is absent.
3. It runs the resolved `omo --version` and requires the answer to come from omo-ai. If another `omo` still resolves first, or omo-ai landed in a directory that is not on PATH, it prints the exact `export PATH=...` fix instead of claiming success.

By hand, the equivalent is: remove `<prefix>/bin/omo` (or uninstall the old package), then `npm i -g omo-ai@beta`. Uninstalling the old package after omo-ai is in place is not symmetric: `npm uninstall -g oh-my-openagent` unlinks every bin name that package declares, so it also deletes the `omo` in the npm bin dir that npm-installed omo-ai now owns (the installer prints this note on the npm path); reinstall with `npm i -g omo-ai@beta` afterwards. `bun remove -g` keeps a bin another package owns. Machines already on a renamed release have no global `omo` and install cleanly in one step.

## Runtime selection (bun wherever it exists)

The launcher (`bin/lib/bun-runtime.js`) runs the product on bun whenever the machine has one, with
no configuration. First match wins:

1. already running on bun - stay (loop guard);
2. `OMO_RUNTIME=node` - stay; the only way to keep a bun machine on node;
3. no bun binary (`$BUN_INSTALL/bin`, `~/.bun/bin`, then PATH) - stay; npm-only machines never notice;
4. `OMO_RUNTIME=bun` - re-exec under the discovered bun, no version check (explicit opt-in);
5. the script lives in bun's global tree (`bun add -g`) - re-exec; the bun that installed omo runs it;
6. any other install (npm, project-local, `bunx`) - probe `bun --version` once per node boot and
   re-exec when it is >= `BUN_MIN_VERSION` (1.4.0, the engine's verified floor); an older bun, or one
   that cannot answer within 3s, leaves the launch on node.

The engine inherits the answer through `SENPI_RUNTIME`, so launcher and engine never disagree.

## Bun-global launcher shim (POSIX)

A `bun add -g` install reaches `bin/omo.js` through a symlink in the bun bin dir, so node boots
first and the launcher re-execs bun on every launch - a measured 70-85ms node tax per invocation.
On darwin/linux the launcher therefore keeps that user-facing bin as a tiny `#!/bin/sh` shim
(`bin/lib/bun-bin-shim.js`) that execs bun on the real `bin/omo.js` directly:

- the check runs on node boots only (a bun process already arrived through the shim), costs one
  lstat per boot plus a few-hundred-byte read when the bin is already a shim, and is fail-open:
  any error leaves the launch untouched and only `OMO_DEBUG` narrates it;
- only bun's own link to this install is replaced - a foreign file, a foreign symlink, or a
  missing bin is never touched, and nothing is created from nothing;
- `bun add -g` rewrites the bin link back to a symlink on every update, and the next launch
  regenerates the shim (verified against bun 1.4.0: updates replace the file, `bun remove -g`
  removes it); deleting the shim by hand has the same self-healing effect;
- `OMO_RUNTIME=node` is honored inside the shim: it execs the entrypoint, whose
  `#!/usr/bin/env node` line is exactly what the stock symlink did, so launcher and engine both
  stay on node end to end; a bun that moved or vanished falls back the same way;
- npm installs and Windows never enter the repair: the package's `bin/omo.js` shebang and bin
  mapping - the only inputs npm's Windows `.cmd`/`.ps1` shims read - are unchanged, and the
  generated shim's `#!/bin/sh` line exists only inside the user's bun bin dir, which Windows
  never resolves.
