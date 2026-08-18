# Senpi dependency update and OMO 5.0.0-beta.6 release evidence

## What was tested

- Exact dependency declaration and lock resolution for `@code-yeongyu/senpi@2026.8.11-4`.
- Affected OMO Senpi tests, typecheck, build, generated bundle consistency, and a real terminal smoke.
- Pull request gates and merge-commit landing into `dev`.
- Code-backed unpublished changes since the latest stable and beta publications.
- GitHub Actions beta publish plus npm and GitHub prerelease artifacts for `5.0.0-beta.6`.

## What was observed

Evidence is appended as each scenario runs. RED must precede dependency edits; GREEN and real-surface artifacts must follow.

## Why it is enough

The evidence combines a failing-first exact version contract, package-level regression checks, generated artifact verification, a real terminal surface, protected-branch CI, and live registry/release verification.

## What was omitted

Secret-bearing environment dumps, npm/GitHub credentials, auth headers, and raw private logs are not copied. Only redacted command output needed to verify behavior is recorded.

## Tier

HEAVY: this run changes a harness dependency, lands a PR, and executes external npm/GitHub release writes under an explicit ultrawork request.

## Skills

- `get-unpublished-changes`: code-backed release-layer synthesis.
- `publish`: ship-only workflow trigger and artifact verification.
- `work-with-pr`: isolated worktree, PR, checks, merge, cleanup.
- `ulw-loop`: RED/GREEN and real-surface evidence discipline.
- `programming`: Bun/TypeScript verification conventions.
- `git-master`: atomic history-aligned commits.

