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

### Real OpenCode run - AGENTS.md-mandated surface (`real-opencode-qa.md`, `real-opencode-fix-rendered.txt`, `real-opencode-dev-rendered.txt`)
The runtime bundle `dist/index.js` was loaded into a real `opencode` v1.18.1 process in an isolated XDG sandbox, and `/probetoken` was driven end to end through the auto-slash-command executor (`chat.message` -> `formatCommandTemplate` -> `resolveFileReferencesInText`). The rendered wrapper actually sent to the model was captured from a request-logging fake model:
- Before fix (dev bundle): 6 `[file not found: ...]` fragments - `(@path)`, `@ts-ignore`, and `@latest` corrupted; the real `@realref.txt` still inlines.
- After fix (head bundle): 0 corruption fragments; `(@path)`, `@ts-ignore`, `@latest` preserved verbatim; the real `@realref.txt` still inlines.
- Isolation proof: `opencode db path` resolved inside the sandbox; the real `~/.local/share/opencode/opencode.db` session count was 2564 before and 2564 after.

## Why it is enough
The defect lives entirely in `resolveFileReferencesInText`. The fix is existence-gated: an `@token` that does not resolve to an existing file is left verbatim, so documentation prose (`(@path)`, `@ts-ignore`) survives while real `@file` references still inline. Regex-narrowing cannot separate these cases because `@path` is itself path-shaped; file existence is the only reliable signal. Both the unit tests and the integration test drive the real production functions (no shims, no hand-built payloads), fail on unmodified dev for the behavioral reason, and pass on head; the negative control confirms the dependency. Security rejections (`[path rejected: ...]`) and the directory marker are unchanged, and the recursion guard only fires when a replacement was actually made.

## What was omitted
- The full `opencode run` proof is now included above and in `real-opencode-qa.md`. Only the runtime bundle was built (`bun build packages/omo-opencode/src/index.ts`), not the full `bun run build`, because the vendored `lsp-tools-mcp` / `lsp-daemon` declaration build fails on this host and is unrelated to this change; the runtime bundle is all OpenCode loads to run the plugin.
- The raw ~127 KB request logs (full OpenCode system prompt) are not committed - only the extracted rendered command wrapper, which is the surface this fix affects. No secrets or tokens appear; sandbox paths are shown as `<SANDBOX>`.
