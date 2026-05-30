# Reserving the lazycodex npm name (first-publish playbook)

`lazycodex` is the npm/bin alias for the Codex CLI Light edition and the Git repository that hosts the native Codex marketplace bundle. It is not the marketplace identity. Codex installs marketplace `sisyphuslabs` and plugin `omo`, enabled as `omo@sisyphuslabs`.

The `publish.yml` workflow includes `lazycodex` in trusted-publisher preflight, but that check is soft for first publish.
If `lazycodex` is not yet claimed on npm, the workflow warns and continues so existing package releases are not blocked.
To claim the name, run a one-time manual `npm publish` for `lazycodex` from a trusted environment (for example local shell with `NPM_AUTH_TOKEN`).
After the first manual publish, configure GitHub Actions trusted publishing at:
https://www.npmjs.com/package/lazycodex/access
Set Provider to GitHub Actions, Organization to `code-yeongyu`, Repository to `oh-my-openagent`, and Workflow filename to `publish.yml`.
After this setup, subsequent releases from `publish.yml` can publish `lazycodex` automatically.

The same release workflow also syncs `packages/omo-codex/marketplace.json` and `packages/omo-codex/plugin/` into `code-yeongyu/lazycodex` as `.agents/plugins/marketplace.json` and `plugins/omo/`. That cross-repo push requires the `LAZYCODEX_SYNC_TOKEN` repository secret.
