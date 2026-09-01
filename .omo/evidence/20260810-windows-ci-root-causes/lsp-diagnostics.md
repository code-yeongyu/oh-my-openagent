# LSP diagnostics

## What was tested

The task worktree is outside the session tool's fixed workspace root, so diagnostics were executed through the repository's first-party standalone LSP MCP implementation:

```text
packages/lsp-tools-mcp/src/request-context.ts
packages/lsp-tools-mcp/src/tools.ts
packages/lsp-tools-mcp/src/lsp/manager.ts
```

The driver installed `createStandaloneMcpRequestContext()` from the task worktree, called `executeLspTool("diagnostics", { severity: "error" })`, and disposed the default LSP manager in `finally`.

## What was observed

```text
script/build.ts: 0 error diagnostics
script/build-graph-dependencies.test.ts: 0 error diagnostics
packages/senpi-task/src/lifecycle/admission-lease.test.ts: 0 error diagnostics
```

## Why this is enough

These are real language-server diagnostics using the same first-party LSP core and request-context path shipped by this repository, rooted at the actual task worktree.

## Cleanup receipt

`disposeDefaultLspManager()` completed and the Bun driver exited 0. The only remaining `typescript-language-server` process has cwd `/Users/yeongyu/sionicai/arbiter-wt/stm-5917-skill-sanitization`, so it is unrelated and was left untouched.
