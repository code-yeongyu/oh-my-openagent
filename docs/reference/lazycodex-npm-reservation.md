# Publishing the lazycodex-ai npm name (publish playbook)

`lazycodex-ai` is the npm package and bin alias for the Codex CLI Light edition. `lazycodex` (without the `-ai` suffix) is the GitHub repository that hosts the native Codex marketplace bundle. Neither is the marketplace identity. Codex installs marketplace `sisyphuslabs` and plugin `omo`, enabled as `omo@sisyphuslabs`.

> The bare `lazycodex` npm name was unpublished on 2026-05-30 and is no longer installable. Use `lazycodex-ai` for all npm/bin references.

The `publish.yml` trusted-publisher preflight is a hard gate for every selected release package, including `lazycodex-ai`. Missing trusted publishing fails preflight and blocks the release.

Before publishing `lazycodex-ai`, configure GitHub Actions trusted publishing at:
https://www.npmjs.com/package/lazycodex-ai/access
Set Provider to GitHub Actions, Organization to `code-yeongyu`, Repository to `oh-my-openagent`, and Workflow filename to `publish.yml`.
Publish through `publish.yml`; do not use a one-time manual `npm publish` with `NPM_AUTH_TOKEN`.

The same release workflow prepares `code-yeongyu/lazycodex` from `packages/omo-codex/marketplace.json` and `packages/omo-codex/plugin/`. It pushes the marketplace repository whenever those generated files differ from the marketplace repository. Separately, it compares the generated marketplace payload with the previous published `lazycodex-ai` package and creates a `code-yeongyu/lazycodex` GitHub Release only when that npm-payload comparison reports a change. The cross-repo push and release require the `LAZYCODEX_SYNC_TOKEN` repository secret.
