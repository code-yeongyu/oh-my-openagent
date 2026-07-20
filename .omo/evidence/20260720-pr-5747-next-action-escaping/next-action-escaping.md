# PR #5747 Next Action escaping QA — 2026-07-20

## Scope

The Stop-hook continuation directive now serializes the snapshot Next Action as a JSON string instead of wrapping it in Markdown inline-code delimiters. This prevents a backtick from ending the wrapper and exposing the remaining text as directive prose.

## Failing-first proof

Before the production change, the focused test with `Run \`bun test\` before updating the PR` failed because the generated line was:

```text
- Next action: `Run `bun test` before updating the PR`
```

That output has nested inline-code delimiters.

## Verification

```text
OMO_QA_SANDBOX_ROOT=D:/Vibe Project/Contribute/oh-my-openagent-5747/.qa-sandbox/start-work-continuation node node_modules/.bun/vitest@4.1.10+91dafe736c534b74/node_modules/vitest/vitest.mjs --run packages/omo-codex/plugin/components/start-work-continuation/test/ulw-snapshot-reader.test.ts
```

Observed: 1 file / 48 tests passed. The new Stop-hook scenario observes:

```text
- Next action: "Run `bun test` before updating the PR"
```

The test used only the fixed QA sandbox and no cleanup/deletion was performed. LSP reported no errors for `src/codex-hook.ts`; `git diff --check` passed; the file remains at 97 pure LOC.
