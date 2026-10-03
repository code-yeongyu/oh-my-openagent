# Patch hunk guard verification (refs #7546)

## What

- `script/verify-patch-hunks.ts`: for every `patches/*.patch`, resolves `<pkg>@<version>` from the file name, downloads the exact published tarball from the npm registry, and runs `git apply --check` against it. On a whole-patch failure each hunk is checked standalone; failing hunks are classified obsolete (added lines already present upstream, or removal-only with nothing left to remove) or conflict. Non-applying hunks fail the run with `::error` file annotations.
- CI: new "Verify version-scoped patch hunks" step in the `build` job, before dependency install, `run_heavy` gated.
- Unit tests: `script/verify-patch-hunks.test.ts` (9 cases, given/when/then).

## QA

- unit tests: 9 pass, 0 fail (`unit-tests.log`)
- positive: committed `patches/@code-yeongyu%2Fsenpi@2026.8.31.patch` against published `@code-yeongyu/senpi@2026.8.31`: all hunks apply, exit 0 (`positive-run.log`)
- negative: pre-fix patch content from `e109689` (the #7546 defect: renamed to 2026.8.31 without rebasing) against the same published version: hunks 1, 2, 5 apply, hunk 3 obsolete (its imports landed upstream), hunk 4 conflict (upstream rewrote the read/update path), exit 1 with drop/rebase remediation (`negative-run.log`). Matches the shipped fix `3fdd94f`, which dropped the trust-storage half.
- `bun run typecheck:script`: no errors from the new files; one pre-existing dev error in `script/senpi-hooks-state.test.ts(52)` from 6139295, unrelated to this change
- actionlint 1.7.7 on `.github/workflows/ci.yml`: clean

## Notes

- Patch text is normalized CRLF to LF before checking: Windows checkouts (`core.autocrlf=true`, no `*.patch` rule in `.gitattributes`) otherwise produce false "corrupt patch" failures. CI (Linux) is unaffected either way.
- Per-hunk files are newline-terminated; git apply rejects a hunk whose final line lacks a newline.
