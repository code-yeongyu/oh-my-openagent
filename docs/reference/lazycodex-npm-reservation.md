# Publishing the lazycodex-ai npm name (publish playbook)

`lazycodex-ai` is the npm package and bin alias for the Codex CLI Light edition. `lazycodex` (without the `-ai` suffix) is the GitHub repository that hosts the native Codex marketplace bundle. Neither is the marketplace identity. Codex installs marketplace `sisyphuslabs` and plugin `omo`, enabled as `omo@sisyphuslabs`.

> The bare `lazycodex` npm name was unpublished on 2026-05-30 and is no longer installable. Use `lazycodex-ai` for all npm/bin references.

The `publish.yml` workflow includes `lazycodex-ai` in trusted-publisher preflight, but that check is soft for first publish.
If `lazycodex-ai` is not yet claimed on npm, the workflow warns and continues so existing package releases are not blocked.
To claim the name, run a one-time manual `npm publish` for `lazycodex-ai` from a trusted environment (for example local shell with `NPM_AUTH_TOKEN`).
After the first manual publish, configure GitHub Actions trusted publishing at:
https://www.npmjs.com/package/lazycodex-ai/access
Set Provider to GitHub Actions, Organization to `code-yeongyu`, Repository to `oh-my-openagent`, and Workflow filename to `publish.yml`.
After this setup, subsequent releases from `publish.yml` can publish `lazycodex-ai` automatically.

The same release workflow prepares `code-yeongyu/lazycodex` from `packages/omo-codex/marketplace.json` and `packages/omo-codex/plugin/`, then compares that generated marketplace payload against the previous published `lazycodex-ai` package. It pushes the marketplace repo and creates a `code-yeongyu/lazycodex` GitHub Release only when that payload changed. That cross-repo push and release requires the `LAZYCODEX_SYNC_TOKEN` repository secret.
