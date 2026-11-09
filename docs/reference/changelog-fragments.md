# Changelog fragments (#9961, #10841)

Pull requests never edit `CHANGELOG.md`, the root `changes.md` or any `packages/<name>/changes.md`.
Every pull request used to prepend to the same first lines of those files, so each merge into `dev`
left the other open pull requests conflicting. A pull request that changes what ships adds exactly one
file instead, named for the pull request: `changes/unreleased/<pr-number>.md`.

## What goes in the fragment

The text that used to go under `## [Unreleased]`, in either of the shapes the changelog uses:

```md
**OmO loads the analytics SDK only when an event is captured.** PostHog now ships as a lazy
sidecar ... ([#10640](https://github.com/code-yeongyu/oh-my-openagent/pull/10640))
```

```md
### Fixed

- A relaunched task records its own session id.
```

After it, one block for each log you used to prepend to, naming the log:

```md
<!-- changes-log: packages/omo-senpi/changes.md -->
## 2026-10-24 - What changed in omo-senpi (#123)

The text you used to prepend to that log.
```

- One block per log; it starts with `## YYYY-MM-DD - <title>`; the log (`changes.md` or
  `packages/<name>/changes.md`) must already exist.
- Fragments are immutable once merged; a later pull request adds its own.

## What the gate checks

The `changelog-gate` workflow runs `script/check-pr-changelog.ts` from the base branch:

- A pull request that touches a shipped path (the package manifests' `files`/`bin`, the build
  generators and binary crates; `script/changelog-shipping-policy.mjs`) adds exactly one fragment,
  `changes/unreleased/<its number>.md`, non-empty. Tests, test helpers, CI scripts and docs need none.
- The `no-changelog` label waives the fragment only when no shipped path changed.
- Editing `CHANGELOG.md`, any `changes.md`, or another pull request's fragment fails. Every log block
  must be valid and name an existing log.
- The fragment's text must be what the release can place: paragraphs, or `- ` bullets (with indented
  continuation lines) under `### ` headings, before any log block. A fragment with only log blocks
  fails. A merged fragment cannot be edited, so this is checked before merge.

The rules live in `script/changelog-gate-rules.ts`, vendored byte-identical from
`sisyphuslabs/common-infra` (`bun script/check-gate-sync.ts` compares them).

## Release

Only the release-state pull request (a `release/*` branch in this repository carrying the title and body
`publish.yml` writes, whoever opened it; `script/release-pr-marker.ts`) edits
those files. `script/stamp-release-changelog.ts` writes the release section (paragraphs first, newest
pull request first, then one `### Section` group per name, each entry linking its pull request;
an entry that already links a pull request, or holds a code block, is kept exactly as written),
writes every log block into its log, and deletes the fragments, all in the release commit. Nothing
compiles fragments before the release cut. Unreleased text written before the gate switched is
released first, as written.

## Converting a branch written before fragments

```sh
bun script/changelog-fragments-cli.ts from-diff --base origin/dev --pr <n>
```

It moves the paragraphs your branch added under `## [Unreleased]` and the entries it prepended to any
`changes.md` into `changes/unreleased/<n>.md`, and puts those files back to the merge base. Review
the fragment and commit. It refuses, and writes nothing, when the branch edited a released section or
an existing entry; move that text by hand.

## Batch pull requests

A batch that merges other pull requests' branches carries their fragments, but a pull request adds
exactly one. After merging the cars, run

```sh
bun script/changelog-fragments-cli.ts fold-batch --base origin/dev --pr <batch>
```

It moves every added fragment into `changes/unreleased/<batch>.md` (newest pull request first, one
block per log) and deletes the cars' files. Commit the result.

This guide lives outside `changes/unreleased/` because the gate accepts only `<pr-number>.md` files there.
