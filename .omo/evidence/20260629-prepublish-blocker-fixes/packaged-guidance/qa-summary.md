# Packaged QA Guidance Docs Evidence

## RED

- Scenario: current `origin/dev` package dry-run before the fix.
- Invocation: `bun pm pack --dry-run --ignore-scripts > .omo/evidence/20260629-prepublish-blocker-fixes/packaged-guidance/red-pack-dry-run.txt 2>&1`
- Binary observable: command exited `0`, but `rg -n "docs/reference/(web-terminal-visual-qa|github-attachment-upload)\\.md|web-terminal-visual-qa\\.md|github-attachment-upload\\.md" .omo/evidence/20260629-prepublish-blocker-fixes/packaged-guidance/red-pack-dry-run.txt` exited `1`.
- Captured artifacts:
  - `.omo/evidence/20260629-prepublish-blocker-fixes/packaged-guidance/red-pack-dry-run.txt`
  - `.omo/evidence/20260629-prepublish-blocker-fixes/packaged-guidance/red-referenced-docs-absent.txt`

## GREEN

- Scenario: root package dry-run after adding the referenced docs to `package.json` files.
- Invocation: `bun pm pack --dry-run --ignore-scripts > .omo/evidence/20260629-prepublish-blocker-fixes/packaged-guidance/green-pack-dry-run.txt 2>&1`
- Binary observable: command exited `0`; `green-referenced-docs-present.txt` shows packed paths for both `docs/reference/github-attachment-upload.md` and `docs/reference/web-terminal-visual-qa.md`.
- Captured artifacts:
  - `.omo/evidence/20260629-prepublish-blocker-fixes/packaged-guidance/green-pack-dry-run.txt`
  - `.omo/evidence/20260629-prepublish-blocker-fixes/packaged-guidance/green-referenced-docs-present.txt`

## Regression Tests

- Scenario: package layout regression for root npm package.
- Invocation: `bun test script/package-layout.test.ts > .omo/evidence/20260629-prepublish-blocker-fixes/packaged-guidance/green-package-layout-test.txt 2>&1`
- Binary observable: command exited `0`; package layout test asserts both referenced guidance docs ship.
- Captured artifact: `.omo/evidence/20260629-prepublish-blocker-fixes/packaged-guidance/green-package-layout-test.txt`

- Scenario: lazycodex publish workflow package-file rewrite remains self-contained for shipped shared skills.
- Invocation: `bun test script/publish-lazycodex-workflow.test.ts > .omo/evidence/20260629-prepublish-blocker-fixes/packaged-guidance/green-publish-lazycodex-workflow-test.txt 2>&1`
- Binary observable: command exited `0`; workflow test asserts the rewritten lazycodex `files` list includes both referenced guidance docs.
- Captured artifact: `.omo/evidence/20260629-prepublish-blocker-fixes/packaged-guidance/green-publish-lazycodex-workflow-test.txt`

## Hygiene

- Scenario: TypeScript script/test diagnostics for changed TypeScript tests.
- Invocation: `bun run typecheck:script > .omo/evidence/20260629-prepublish-blocker-fixes/packaged-guidance/green-typecheck-script.txt 2>&1`
- Binary observable: command exited `0`.
- Captured artifact: `.omo/evidence/20260629-prepublish-blocker-fixes/packaged-guidance/green-typecheck-script.txt`

- Scenario: focused changed-file whitespace/error diff check.
- Invocation: `{ printf 'Invocation: git diff --check\n'; if git diff --check; then printf 'exit_code=0\n'; else code=$?; printf 'exit_code=%s\n' "$code"; exit "$code"; fi; } > .omo/evidence/20260629-prepublish-blocker-fixes/packaged-guidance/green-diff-check.txt 2>&1`
- Binary observable: command exited `0`.
- Captured artifact: `.omo/evidence/20260629-prepublish-blocker-fixes/packaged-guidance/green-diff-check.txt`

- Scenario: focused committed-range whitespace/error diff check after the fix commit.
- Invocation: `{ printf 'Invocation: git diff --check origin/dev..HEAD\n'; if git diff --check origin/dev..HEAD; then printf 'exit_code=0\n'; else code=$?; printf 'exit_code=%s\n' "$code"; exit "$code"; fi; } > .omo/evidence/20260629-prepublish-blocker-fixes/packaged-guidance/green-commit-range-diff-check.txt 2>&1`
- Binary observable: command exited `0`.
- Captured artifact: `.omo/evidence/20260629-prepublish-blocker-fixes/packaged-guidance/green-commit-range-diff-check.txt`

- Scenario: TypeScript no-excuse audit for changed test files.
- Invocation: `test -f scripts/typescript/check-no-excuse-rules.ts && bun run scripts/typescript/check-no-excuse-rules.ts script/package-layout.test.ts script/publish-lazycodex-workflow.test.ts > .omo/evidence/20260629-prepublish-blocker-fixes/packaged-guidance/green-no-excuse-typescript.txt 2>&1 || printf 'scripts/typescript/check-no-excuse-rules.ts not present\n' > .omo/evidence/20260629-prepublish-blocker-fixes/packaged-guidance/green-no-excuse-typescript.txt`
- Binary observable: script file was not present in this repository checkout; artifact records the unavailable audit. The enforced `bun run typecheck:script` and focused tests covered the changed TypeScript files.
- Captured artifact: `.omo/evidence/20260629-prepublish-blocker-fixes/packaged-guidance/green-no-excuse-typescript.txt`

## Why This Is Enough

The RED dry-run proves blocker #5 against the package surface: shipped skill guidance referenced docs absent from npm package contents. The GREEN dry-run proves the docs now ship. The package-layout test prevents regression for the root package, and the lazycodex workflow test covers the separate publish-time `files` rewrite that also ships shared skills referencing the attachment guidance.

## Omitted

No OpenCode or Codex live harness QA was run because this change only alters npm package inclusion metadata and package-layout tests. No logs containing secrets, auth headers, cookies, or upload tokens were captured.
