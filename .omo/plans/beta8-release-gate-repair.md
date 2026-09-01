# beta.8 release-gate repair: version-stamped test + release bundle rebuild

## Evidence
- Publish run 32035291056 / job 95404552495: release-state PR #6855 red on the version-bumped tree.
- Red 1: packages/omo-senpi/src/components/telemetry/product-identity.test.ts:48 pins "5.0.0-beta.7"; bumped tree returns 5.0.0-beta.8.
- Red 2: senpi-compatibility "omo-senpi extension build is not current: stale-output" because the release commit bumps packages/omo-senpi/plugin/package.json without rebuilding plugin/extensions bundles. beta.7 shipped only via manual rebuild commit dc14e9518.

## Changes
1. product-identity.test.ts: derive expected packageVersion from root package.json (independent read), pinning the fallback derivation contract instead of a literal.
2. .github/workflows/publish.yml prepare-release-state: after `bun install --lockfile-only`, run `node packages/omo-senpi/plugin/scripts/build-extension.mjs` (bun 1.3.12 already on PATH) and force-add the rebuilt bundles into the release commit.
3. script/publish-workflow.test.ts: pin that the prepare step rebuilds + stages extension bundles before the release commit.

## Verification
- RED: current test against jq-bumped root package.json (Expected beta.7 / Received beta.8); new workflow pin against current YAML.
- GREEN: focused test + pin after fixes.
- STRICT local release simulation on a committed simulation branch: exact prepare bump sequence + rebuild, then the full release-branch CI surface locally with CI Bun 1.3.12:
  a) the exact senpi-compatibility check block from ci.yml,
  b) script/remove-stale-self-package-tests.ts + full root bun test,
  c) bun run typecheck,
  d) bun run test:codex,
  e) bun run build.
- Only after all local gates green: PR, CI, merge, redispatch publish.
