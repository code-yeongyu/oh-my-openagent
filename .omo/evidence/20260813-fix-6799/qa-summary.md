# QA summary - issue #6799 ZAI-only installer fallback

Captured 2026-08-13 on Windows 11 with Bun 1.3.14.

## What was tested

1. A red-green regression that generates installer configuration with ZAI as
   the only provider and rejects every `opencode/` model.
2. The complete `model-fallback.test.ts` and
   `model-fallback-providers.test.ts` suites.
3. The TypeScript no-excuse audit for both changed files.
4. The OpenCode adapter package typecheck against the same upstream base.
5. The real non-interactive installer in an isolated HOME and XDG sandbox
   with only `--zai-coding-plan=yes`.

## What was observed

- Before the source fix, the regression failed and printed fourteen
  `opencode/gpt-5-nano` routes across agents and categories.
- After deriving the unresolved-route fallback for ZAI-only installs, both
  installer suites passed: 53 pass, 0 fail.
- The no-excuse audit reported no violations.
- The main upstream OpenCode adapter typecheck exited zero; the sparse issue
  clone cannot run a standalone package typecheck because its untouched
  workspace package links are intentionally absent. The changed module is
  covered by the strict source audit and the fully loaded Bun tests.
- The isolated real installer exited zero and wrote
  `.omo/omo.jsonc` with every generated agent/category model under
  `zai-coding-plan/`; no `opencode/` model appears.

Exact concise captures:

- `red-green.txt`
- `verification.txt`
- `installer-output.txt`

## Why it is enough

The regression toggles the reported installer output directly. The complete
fallback suites protect all established native, Copilot, Zen, and mixed
provider routes. The non-interactive installer is the matching user surface
and proves the shipped config writer persists the corrected ZAI-only result in
an isolated environment.

## What was omitted

No credentials, tokens, authentication headers, or host configuration were
used. The isolated cache files and verbose passing test lines were summarized.
