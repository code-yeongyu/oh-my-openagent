# Evidence: GitHub releases must never be pre-releases (2026-09-04)

Plan: `.omo/plans/20260904-github-release-never-prerelease.md`

## What was tested
- `script/omo-ai-publish-shape.test.ts` (new test `creates every GitHub release as a full latest release, never a pre-release`) against the ORIGINAL and the FIXED `.github/workflows/publish.yml`. Run with `bun test` (bun 1.4.0) on mengmotaMac over the bunshin mesh in a hermetic dir holding only those two files (no bunfig preload), per the no-local-test standing order.
- Live repair of the existing releases with `gh release edit` (receipts in `03-*`, `04-*`).

## What was observed
- `01-red-shape-test-mengmotaMac.txt`: 8 pass / 1 fail; the new test fails on the old workflow for the intended reason (`gh release create ... "${RELEASE_FLAGS[@]}"` carries no `--latest`).
- `02-green-shape-test-mengmotaMac.txt`: 9 pass / 0 fail on the fixed workflow (`gh release create "v${VERSION}" --latest ...`, no `--prerelease` anywhere in the step).
- `00-before-release-list.txt`: 21 pre-releases before the repair, Latest stuck on v5.0.0-beta.19.

## Why it is enough
- The only producer of the pre-release flag was the removed hyphen check; the test now fails if `--prerelease` returns to the step or `--latest` disappears from the create command, and it is a machine-consumed CLI flag, not prose.
- The workflow step is otherwise unchanged (same idempotent `gh release view || gh release create` shape), so the rerun/skip_platform paths documented in `docs/reference/release-process.md` are untouched. actionlint runs on the PR via `lint-workflows.yml`.
- The change touches no opencode/codex/senpi package, so no harness QA skill applies; the live proof is the next `publish.yml` run creating a non-pre-release Latest release.

## What was omitted
- No secrets, tokens, or auth headers appear in these files; `gh` output was captured as plain JSON fields only.
