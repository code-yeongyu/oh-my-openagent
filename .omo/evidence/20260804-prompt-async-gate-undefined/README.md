# Evidence: real OpenCode QA for prompt path compatibility

Date: 2026-08-04
PR: https://github.com/code-yeongyu/oh-my-openagent/pull/6583
Issue: https://github.com/code-yeongyu/oh-my-openagent/issues/6582
Commit under test: `938d35003` plus this evidence artifact

> **Authentic production reproduction:** the `got undefined` fault this PR fixes occurred
> live in a real OpenCode user session (`ses_038a0d10dffe7hHQyjy3ndVIgF`, model
> `9router/5.6 terra`, agent `Atlas`), not just a synthetic repro. Full transcript
> provenance, the exact installed-plugin bug line, and minimal-repro failing events are in
> `./TESTIMONY-USER-SESSION.md`. That file is the primary observed-behavior evidence; this
> README documents the complementary real-harness harness run on a fresh plugin build.

## Environment
- OpenCode: `1.18.11`
- Model: `9router/Light`
- QA directory: `/tmp/oh-my-openagent`
- Real OpenCode DB session count before/after: `25` / `25`
- Existing unrelated submodule worktree changes were preserved and not included.

## Real harness test
Command:
```bash
opencode run "Use the edit tool to append a comment '// QA: tool dispatch test' to packages/utils/src/prompt-async-gate.ts. Confirm TOOL_QA_OK." -m 9router/Light --format json --dir /tmp/oh-my-openagent --print-logs
```

Observed structured OpenCode events:
- `step_start`
- `tool_use` with `tool: "read"`, `state.status: "completed"`
- `tool_use` with `tool: "edit"`, `state.status: "completed"`, `filediff.additions: 1`, `filediff.deletions: 0`
- final `text`: `TOOL_QA_OK`
- final `step_finish` with `reason: "stop"`

This drives the actual installed OpenCode CLI, model, SDK/plugin tool dispatch, and `edit` tool path. No `path` type error occurred. The QA-only marker was reverted immediately after the run with:
```bash
git checkout packages/utils/src/prompt-async-gate.ts
```

## Isolation / regression proof
```bash
$ opencode db "SELECT count(*) AS cnt FROM session"
25

$ opencode db "SELECT count(*) AS cnt FROM session"  # after QA
25
```

The real DB session count stayed unchanged. The run used the repository-local QA directory and did not alter tracked source files after the marker rollback.

## Supporting checks
```bash
$ bun test src/prompt-async-gate-path-compat.test.ts  # packages/utils
3 pass, 0 fail, 6 expect() calls

$ bun test src/shared/prompt-async-gate-path-compat.test.ts  # packages/omo-opencode
3 pass, 0 fail, 6 expect() calls
```

Full raw JSON output was captured at `/tmp/opencode-qa-output.log` during QA. The relevant structured `tool_use` and `TOOL_QA_OK` events are summarized above.

## Caveat
The repository-wide build reached generated plugin bundles but stopped in unrelated `build:senpi-plugin` metadata generation (`packages/omo-senpi/plugin/extensions/omo.js.meta.json` missing). This does not affect the real installed OpenCode CLI run or the targeted unit tests above.
