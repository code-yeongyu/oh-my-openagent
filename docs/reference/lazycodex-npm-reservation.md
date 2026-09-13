# Publishing the lazycodex-ai npm name (publish playbook)

`lazycodex-ai` is the npm package and bin alias for the Codex CLI Light edition. `lazycodex` (without the `-ai` suffix) is the GitHub repository that hosts the native Codex marketplace bundle. Neither is the marketplace identity. Codex installs marketplace `sisyphuslabs` and plugin `omo`, enabled as `omo@sisyphuslabs`.

> The bare `lazycodex` npm name was unpublished on 2026-05-30 and is no longer installable. Use `lazycodex-ai` for all npm/bin references.

The `publish.yml` trusted-publisher preflight is a hard gate for every selected release package, including `lazycodex-ai`. Missing trusted publishing fails preflight and blocks the release.

## LazyCodex-only version namespace

Dispatch `publish.yml` with `lazycodex_only=true`, `publish_lazycodex=true`, and an explicit version based on the current omo release, with a reserved `lazycodex.N` prerelease suffix (positive counter):

- Current omo `5.0.0-beta.62`: use `5.0.0-beta.62.lazycodex.1`, then `.2`, etc. These publish `lazycodex-ai` to **beta**. The next omo release remains `5.0.0-beta.63`.
- Stable base `5.0.0`: use `5.0.0-lazycodex.1`. These are prereleases on the **lazycodex** dist-tag, not `latest`; install with `lazycodex-ai@lazycodex` or the exact version.

The source tag remains `lazycodex-v<version>`. No omo manifests, npm packages or release tags are changed. Normal omo releases reject the reserved `lazycodex` identifier; LazyCodex-only releases reject normal omo versions. Validation runs in release metadata before release-state drafting, and the local omo publish/preparation script enforces the same reservation. Historical tag/npm collision guards remain for immutable payloads and old releases. Existing consumed plain versions cannot be reclaimed.

Full releases keep their existing channel semantics: LazyCodex follows the root prerelease channel (or `latest` for stable releases); `omo-ai` keeps its ordered version mapping and always publishes to `beta`. No prerelease may explicitly use the `latest` channel.

## Preflight diagnostics and retry budget

Each OIDC request/token exchange has a 30-second timeout and at most six attempts. Transport/TLS errors, HTTP 408, HTTP 429, HTTP 5xx, and ambiguous HTTP 404 responses retry after 1, 2, 4, 8 and 16 seconds. Numeric `Retry-After` can extend a delay, capped at 30 seconds. Every failed attempt starts its diagnostic with the package (or GitHub OIDC) and actual HTTP status or transport error code, followed by redacted error detail.

HTTP 400/401/403, or a 404 explicitly reporting an absent/mismatched trusted publisher, fail immediately; package exchange failures in this class print the setup URL and workflow identity. Unknown non-transient HTTP statuses fail closed without setup guidance. Ambiguous 404 exhaustion and transient exhaustion report the actual error, not a claim that publishing is unconfigured. Persistent outages still fail closed after the bounded budget. Successful exchange credentials are discarded and never logged.

Before publishing `lazycodex-ai`, configure GitHub Actions trusted publishing at:
https://www.npmjs.com/package/lazycodex-ai/access
Set Provider to GitHub Actions, Organization to `code-yeongyu`, Repository to `oh-my-openagent`, and Workflow filename to `publish.yml`.
Publish through `publish.yml`; do not use a one-time manual `npm publish` with `NPM_AUTH_TOKEN`.

The same release workflow prepares `code-yeongyu/lazycodex` from `packages/omo-codex/marketplace.json` and `packages/omo-codex/plugin/`. It pushes the marketplace repository whenever those generated files differ from the marketplace repository. Separately, it compares the generated marketplace payload with the previous published `lazycodex-ai` package and creates a `code-yeongyu/lazycodex` GitHub Release only when that npm-payload comparison reports a change. The cross-repo push and release require the `LAZYCODEX_SYNC_TOKEN` repository secret.
