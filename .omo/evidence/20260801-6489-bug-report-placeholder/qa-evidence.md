# QA Evidence — #6489 bug_report.yml OpenCode version placeholder

**Date:** 2026-08-01
**Change:** `docs: update stale 1.0.150 OpenCode version placeholder in bug report template`
**Scope:** `.github/ISSUE_TEMPLATE/bug_report.yml` (docs/template only — not wired into any opencode/codex runtime component; `opencode-qa`/`codex-qa` harness skills not applicable).

## WHAT WAS TESTED

- The two stale `1.0.150` strings in `.github/ISSUE_TEMPLATE/bug_report.yml` were updated to the current OpenCode release.
  - `doctor` output example line: `✓ OpenCode version: 1.0.150` → `1.18.10`.
  - `opencode-version` input placeholder: `placeholder: "1.0.150"` → `"1.18.10"`.
- The current OpenCode release was cross-checked against two independent sources.
- The YAML template still parses after the edit.

## WHAT WAS OBSERVED

- `git diff` shows exactly two hunks, both pure version-string substitutions (no structural YAML change).
- `grep -c "1\.0\.150"` on the file → `0` (no stale occurrence remains).
- Current OpenCode version confirmed as **1.18.10** from two sources:
  - `opencode --version` (local install) → `1.18.10`.
  - GitHub `sst/opencode` releases page → latest tag `v1.18.10` (fetched 2026-08-01).
- YAML validation via `yaml.safe_load` (PyYAML 6.0.2) → parses cleanly; assertions pass:
  - `name: Bug Report`, `labels: ["bug", "needs-triage"]`.
  - `opencode-version` input `placeholder == "1.18.10"`.
  - `doctor` output example contains `1.18.10`.

## WHY IT IS ENOUGH

- The template is consumed by GitHub's issue-template YAML parser; a structural parse check + unchanged indentation covers the only failure mode.
- The version value is pinned to the current stable OpenCode release at the time of writing, so the doctor example and the input placeholder no longer advertise a version below the plugin's own minimum (`MIN_OPENCODE_VERSION = 1.4.0`, verified in `packages/omo-opencode/src/cli/doctor/framework/constants.ts` and `postinstall.mjs`).
- The change touches no build, runtime, or test surface; no `bun test` / typecheck run is meaningful here.

## WHAT WAS OMITTED

- No full `bun test` / `bun run typecheck` run: not applicable to a single YAML template string change.
- No `opencode-qa` / `codex-qa` harness drive: this file never reaches the OpenCode or Codex runtime.
- No screenshots of GitHub's rendered issue form (requires repo write access to preview; structural validation above covers correctness).

## Residual risk

Low. If OpenCode ships a newer stable before merge, the placeholder may need a one-line bump. It is an example/placeholder only and does not enforce any version.
