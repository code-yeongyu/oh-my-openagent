# Stats Pagination Fix QA

## Success Criteria

1. Real paginated GitHub releases output is represented at the script boundary.
   - Scenario: direct GitHub CLI pagination probe.
   - Invocation: `gh api repos/code-yeongyu/oh-my-openagent/releases --paginate --slurp | bun -e '<summarize pages/releases/downloads>'`.
   - Binary observable: command exits 0 and reports a slurped page array with `pages: 3`, `releases: 207`, `asset_downloads: 12615`.
   - Artifact: `.omo/evidence/20260629-prepublish-blocker-fixes/stats-pagination/gh-slurp-shape.txt`.

2. Download aggregation handles slurped paginated release pages.
   - RED invocation: `bun test script/stats.test.ts`.
   - RED observable: new slurped-pages test fails with Zod `expected object, received array` at page indices.
   - RED artifact: `.omo/evidence/20260629-prepublish-blocker-fixes/stats-pagination/red-bun-test-stats.txt`.
   - GREEN invocation: `bun test script/stats.test.ts`.
   - GREEN observable: 3 tests pass, including `#given slurped GitHub release pages #when collected #then stats aggregate every page`.
   - GREEN artifact: `.omo/evidence/20260629-prepublish-blocker-fixes/stats-pagination/green-bun-test-stats.txt`.

3. The real stats CLI can run through the GitHub + npm data path without uploading.
   - Scenario: dry-run stats script against live npm and GitHub APIs.
   - Invocation: `bun run script/stats.ts --dry-run`.
   - Binary observable: command exits 0 and prints four PostHog event payloads; GitHub release event count is `12615`, matching the direct slurp probe.
   - Artifact: `.omo/evidence/20260629-prepublish-blocker-fixes/stats-pagination/cli-dry-run.txt`.

4. TypeScript/script quality gates pass for the touched surface.
   - Invocation: `bun run typecheck:script`.
   - Observable: exits 0.
   - Artifact: `.omo/evidence/20260629-prepublish-blocker-fixes/stats-pagination/typecheck-script.txt`.
   - Invocation: `bun run packages/shared-skills/skills/programming/scripts/typescript/check-no-excuse-rules.ts script/stats.ts script/stats.test.ts`.
   - Observable: exits 0 with no violations.
   - Artifact: `.omo/evidence/20260629-prepublish-blocker-fixes/stats-pagination/no-excuse-typescript.txt`.
   - Invocation: `git diff --check`.
   - Observable: exits 0 with no whitespace errors.
   - Artifact: `.omo/evidence/20260629-prepublish-blocker-fixes/stats-pagination/git-diff-check.txt`.

## Why This Is Enough

The failing test pins the exact release blocker shape chosen for the fix: GitHub CLI pagination with `--slurp`, where the JSON value is an array of pages. The implementation now calls `gh api --paginate --slurp` and parses both historical flat release arrays and slurped page arrays into the same aggregation path. The direct GitHub probe and dry-run script show the live command shape and the stats script agree on the same GitHub asset download total.

## Omitted

No PostHog send was performed; `--dry-run` was used to avoid writing analytics events. No OpenCode or Codex harness QA was run because this change is limited to a repository script and its workflow-facing data parsing.
