# GitHub "Latest" must follow the highest published semver

Date: 2026-09-04 · Branch: `fix/release-latest-by-semver` · Base: `origin/dev` @ 27f5db24e
Follow-up to PR #7743 (`.omo/plans/20260904-github-release-never-prerelease.md`).

## Why this is a defect, not a nit

PR #7743 stopped marking releases as pre-releases and passes `--latest` to `gh release create`.
`gh` sends `make_latest: "true"` for that flag, and it sends nothing when the flag is omitted,
which GitHub defaults to `true` as well (verified in `cli/cli` `pkg/cmd/release/create/create.go`
and `create/http.go`). Either way GitHub marks the release being created as Latest regardless of
its version. The workflow's `version` input accepts any semver, so a hotfix dispatched for an
older line (for example `4.19.5` after `5.0.0-beta.40`) would take the Latest badge, and
`releases/latest/download/<asset>` - the URL printed by the compiled omo binary's update hint
(`packages/omo-native/compile-entry.ts`) - would serve the old-line binary to everyone.
The code reviewer flagged this as LOW on #7743; the standing order says such items are fixed to
the ideal state in the same run, not recorded as debt.

`gh release create --latest` is a boolean flag (`cmdutil.NilBoolFlag`), so GitHub's
`make_latest: legacy` (server-side "highest version") cannot be expressed through it, and its
comparator is opaque. The repo already orders versions with `Bun.semver` in
`script/generate-changelog.ts`; deciding Latest with the same, spec-compliant comparator keeps the
rule deterministic and unit-testable.

## Ideal end state

- One function decides the flag: `resolveLatestFlag(version, releasedTags)` in
  `script/release-latest-flag.ts` -> `--latest` when no published release has a higher semver,
  `--latest=false` otherwise. Non-semver tags (`_pr-attachments`, `next`) are ignored; an equal
  version (rerun) yields `--latest`; an invalid version throws.
- Every release-creation path uses it: `publish.yml` "Create GitHub release", `publish.yml`
  "Create LazyCodex GitHub release" (against the lazycodex release list), and the local
  `script/publish.ts`. `--prerelease` appears nowhere.
- `RELEASE_VERSION_PATTERN` lives once (new module) and `generate-changelog.ts` imports it.
- Docs state the rule: omo-ai-publishing.md, the step comment, AGENTS.md:223 wording,
  script/AGENTS.md table row.

## Changes

| File | Change | Verification |
|---|---|---|
| `script/release-latest-flag.test.ts` | NEW - unit cases: highest -> `--latest`; lower -> `--latest=false`; equal -> `--latest`; non-semver tags ignored; `v` prefix tolerated; beta.9 < beta.10 and beta.99 < beta.100; stable after beta -> `--latest`; 4.19.5 after 5.0.0-beta.40 -> `--latest=false`; invalid version throws | RED (module missing) -> GREEN; mutation (inverted comparison) -> RED -> restore GREEN; on mengmotaMac via bunshin |
| `script/release-latest-flag.ts` | NEW - `RELEASE_VERSION_PATTERN`, `resolveLatestFlag`, `import.meta.main` CLI: `bun script/release-latest-flag.ts <version>` reads tags from stdin, prints the flag | unit test; live run against the real release list (C4) |
| `script/generate-changelog.ts` | import `RELEASE_VERSION_PATTERN` from the new module | `generate-changelog.test.ts` unchanged and green |
| `script/publish.ts` | compute the flag with `resolveLatestFlag` from `gh release list` and pass it to `gh release create` | typecheck (`bun run typecheck:script` on CI) |
| `.github/workflows/publish.yml` | both `gh release create` steps: `LATEST_FLAG="$(gh release list ... \| bun script/release-latest-flag.ts "$VERSION")"` then `"$LATEST_FLAG"`; comment updated | `omo-ai-publish-shape.test.ts` rewritten to assert the wiring on the command lines; actionlint on PR |
| `script/omo-ai-publish-shape.test.ts` | assert: each `gh release create` line carries `"$LATEST_FLAG"`, no `gh release` line carries `--prerelease`, the step invokes the CLI with `"$VERSION"` fed by `gh release list --exclude-drafts` | RED against current dev workflow, GREEN after |
| `docs/reference/omo-ai-publishing.md`, `AGENTS.md`, `script/AGENTS.md` | describe the rule; remove the ambiguous "prereleases skip" | read-through |

## Evidence

`.omo/evidence/20260904-release-latest-by-semver/` - RED/GREEN/mutation captures, live CLI run,
merge receipt.
