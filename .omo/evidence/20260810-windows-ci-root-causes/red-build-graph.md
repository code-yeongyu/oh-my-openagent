# RED - shared plugin build ownership

## What was tested

```bash
cd /Volumes/mengmotaStorage/local-workspaces/omo-wt/fix/windows-ci-root-causes
bun test script/build-graph-dependencies.test.ts
```

## What was observed

```text
Expected to contain: "codex-plugin"
Received: [ "ast-grep-mcp", "lsp-daemon" ]

0 pass
1 fail
Command exited with code 1
```

## Why this is enough

The test parses the executable `BuildNode[]` AST from `script/build.ts`. It fails because the Senpi staging node can start before the Codex node that provisions the shared `packages/omo-codex/plugin/node_modules` tree.

## What was omitted

Two earlier harness-only failures were discarded because they did not reach the graph assertion: TypeScript 7 does not expose the legacy compiler API, and its native AST does not expose legacy `forEachChild`. The final RED uses the repository's native async AST API and fails only on the missing graph dependency.
