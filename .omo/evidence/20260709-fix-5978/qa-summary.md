# QA Evidence - fix(file-reference-resolver): leave unresolved @tokens untouched (#5978)

## What was tested
- RED -> GREEN on the real resolver `resolveFileReferencesInText` (the only producer of the `[file not found: ...]` fragment) and on the real command-rendering entry point `formatLoadedCommand` (the function OpenCode calls to render a slash command / skill).
- A live-surface driver that runs the real `formatLoadedCommand` on a `/start-work`-style wrapper mirroring the reported header.
- Typecheck (`tsgo`) and the related caller test suites (both resolver callers).

## What was observed
### RED - unmodified dev (`red.txt`)
3 new tests fail because prose `@tokens` are corrupted through the real path:
- `(@path)` becomes `[file not found: ...\path)]`
- `@ts-ignore` becomes `[file not found: ...\ts-ignore]`
- the real reference `@notes/allowed.txt` still inlines to `allowed-content` (the feature that must be preserved)

### GREEN - with fix (`green.txt`)
`13 pass / 0 fail`. All 3 new tests pass; every pre-existing test (real inlining, traversal / absolute / symlink rejection) still passes.

### Negative control (`negative-control.txt`)
With only the resolver source change stashed, the 3 tests fail again (`10 pass / 3 fail`). Restored with `git stash pop`. This proves the tests depend on the fix.

### Live surface - real `formatLoadedCommand` (`driver-before-fix.txt`, `driver-after-fix.txt`, driver `driver.mts`)
- Before fix: 4 `[file not found: ...]` fragments (`@latest` in the install path, `(@path)`, `@ts-ignore`, `@ts-expect-error`); the real `@steps.md` inlined.
- After fix: 0 corruption fragments; `(@path)`, `@ts-ignore`, `@latest` preserved verbatim; the real `@steps.md` still inlined.

### Typecheck (`typecheck.txt`)
`tsgo --noEmit -p packages/omo-opencode/tsconfig.json` exit 0.

### Related caller suites (`related-suites.txt`)
`bun test` over `hooks/auto-slash-command`, `tools/slashcommand`, and the resolver test: `97 pass / 0 fail`. This covers the second caller, `executor.ts` `formatCommandTemplate`.

## Why it is enough
The defect lives entirely in `resolveFileReferencesInText`. The fix is existence-gated: an `@token` that does not resolve to an existing file is left verbatim, so documentation prose (`(@path)`, `@ts-ignore`) survives while real `@file` references still inline. Regex-narrowing cannot separate these cases because `@path` is itself path-shaped; file existence is the only reliable signal. Both the unit tests and the integration test drive the real production functions (no shims, no hand-built payloads), fail on unmodified dev for the behavioral reason, and pass on head; the negative control confirms the dependency. Security rejections (`[path rejected: ...]`) and the directory marker are unchanged, and the recursion guard only fires when a replacement was actually made.

## What was omitted
- A full `opencode run` TUI session: the local `bun run build` is blocked on this host by the vendored `lsp-tools-mcp` / `lsp-daemon` declaration build, which is unrelated to this change. The live surface is therefore exercised through the real rendering function `formatLoadedCommand`, which is the exact code path OpenCode invokes to render a slash command.
- No secrets or tokens appear in the captured logs; the only machine-specific strings are ephemeral OS temp directories created and removed by the tests and driver.
