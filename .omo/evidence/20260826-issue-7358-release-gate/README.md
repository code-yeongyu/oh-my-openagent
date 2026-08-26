# Issue #7358 release-gate QA

## What was tested

- Failing-first workflow invariant:
  `bun test script/publish-workflow.test.ts`
- Focused and related workflow regression suites.
- Script and repository TypeScript checks.
- GitHub Actions syntax with pinned `rhysd/actionlint:1.7.10`.
- Full repository build.
- Manual parse of the shipped workflow's `publish-main` job using Ruby YAML.

The intended behavior is narrow: `publish-main` must wait for `publish-platform`,
must not be suppressed by its job result, and must still fail closed when the
platform npm packages are missing from the registry.

## What was observed

- Before the workflow edit, the new regression failed with:
  `Expected: false`, `Received: true`, and
  `binary smoke failures must not suppress the registry-backed npm publish gate`.
- After the edit, the focused suite passed: 13 tests, 0 failures.
- Related publish/workflow suites passed: 70 tests across 14 files, 0 failures.
- `bun run typecheck:script` and `bun run typecheck` completed without diagnostics.
- Pinned actionlint completed with no diagnostics.
- `bun run build` ended with `build: all steps completed`.
- The parsed workflow reported:
  - it still waits for `publish-platform`;
  - `needs.publish-platform.result` no longer blocks it;
  - the `Verify platform packages are published` proof remains;
  - a failed binary smoke with published platform packages is eligible to continue;
  - missing platform packages still fail closed.

Exact concise outputs are recorded in `verification.txt` and `manual-qa.txt`.

## Why this is enough

The changed values are GitHub Actions machine-consumed YAML. The failing-first test
pins the three-part safety contract, actionlint validates the workflow syntax, and the
independent Ruby YAML driver exercises the shipped file through a real parser. The
related workflow suite, full typecheck, and build cover surrounding release automation.

The actual musl and Windows binary smoke defects remain tracked by #7358. This change
only removes their ability to suppress an otherwise registry-valid npm publication.

## What was omitted

- No live release workflow was dispatched because that surface can publish packages,
  create tags/releases, and write external repositories.
- No provider credentials, tokens, authentication headers, environment dumps, private
  paths, or personal agent configuration were captured.
- Build logs were summarized rather than copied because they contain large generated
  artifact inventories unrelated to the changed workflow condition.
