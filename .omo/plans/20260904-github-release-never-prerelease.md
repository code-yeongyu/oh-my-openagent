# GitHub releases must never be pre-releases

Date: 2026-09-04 · Branch: `fix/github-release-never-prerelease` · Base: `origin/dev` @ 40f750337

## Symptom

`https://github.com/code-yeongyu/oh-my-openagent/releases` shows every release since
v5.0.0-beta.20 (2026-08-25) with a **Pre-release** badge, and the **Latest** badge is stuck on
v5.0.0-beta.19 (2026-08-24). `releases/latest` therefore resolves to a two-week-old build.

## Root cause (why it "keeps happening")

Commit 12e5bb33c (2026-08-18, "fix(publish): support explicit beta release dispatch") made the
`release` job's "Create GitHub release" step pass `--prerelease` whenever `$VERSION` contains a
hyphen. Every shipping version of this project is `5.0.0-beta.N`, so every release became a
GitHub pre-release. The behaviour was then locked in three places, which is why earlier fixes
never stuck:

1. `.github/workflows/publish.yml` — the `RELEASE_FLAGS+=(--prerelease)` mapping itself.
2. `script/omo-ai-publish-shape.test.ts` — a test asserting the mapping exists, so removing the
   flag turns CI red and gets reverted.
3. `docs/reference/omo-ai-publishing.md` — prose stating the GitHub release is "created with
   prerelease metadata explicitly set", so a reader treats the badge as intended.

Tags v5.0.0-beta.17..19 already contain 12e5bb33c yet are full releases: they were flipped by
hand (symptom fix). beta.20..beta.40 were never flipped, and the workflow kept producing
pre-releases.

Functional impact beyond cosmetics: `packages/omo-native/compile-entry.ts` prints the update
recipe `curl -fsSL https://github.com/code-yeongyu/oh-my-openagent/releases/latest/download/<asset>`,
and `releases/latest` ignores pre-releases, so that recipe downloads v5.0.0-beta.19.

## Ideal state

- Every GitHub release, on every channel, is a full release and is marked **Latest** at creation.
  The npm dist-tag (`beta`, `next`, `latest`) carries the channel semantics; GitHub's pre-release
  flag is not part of this project's release contract.
- The test locks the new contract (no `--prerelease`, explicit `--latest` on `gh release create`).
- The docs describe the actual behaviour.
- Existing releases beta.20..beta.40 are repaired (pre-release → release, beta.40 = Latest).
  `_pr-attachments` ("Not a product release") stays as it is.

## Changes

| File | Change | Verification |
|---|---|---|
| `script/omo-ai-publish-shape.test.ts` | Replace the "marks GitHub releases as prereleases…" test with one asserting `gh release create` carries `--latest` and the step never passes `--prerelease` | RED against the old workflow, GREEN against the new one (run on mengmotaMac via bunshin) |
| `.github/workflows/publish.yml` | Drop `RELEASE_FLAGS` / hyphen check; `gh release create "v${VERSION}" --latest …` with a comment stating the contract | shape test GREEN; actionlint via `lint-workflows.yml` on the PR |
| `docs/reference/omo-ai-publishing.md` | Replace the "prerelease metadata explicitly set" sentence | read-through |
| GitHub (not in repo) | `gh release edit v5.0.0-beta.{20..40} --prerelease=false`, `--latest` on beta.40 | `gh release list` → 0 product pre-releases; `releases/latest` → v5.0.0-beta.40 |

## Evidence

`.omo/evidence/20260904-github-release-never-prerelease/` — RED/GREEN test output, release flip
receipts, before/after release list.
