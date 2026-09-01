# GREEN - shared plugin build ownership

## What was tested

```bash
cd /Volumes/mengmotaStorage/local-workspaces/omo-wt/fix/windows-ci-root-causes
bun test script/build-graph-dependencies.test.ts
```

## What was observed

```text
(pass) build graph resource ownership > #given Codex and Senpi plugin builds #when graph dependencies are audited #then Codex provisions the shared plugin tree first

1 pass
0 fail
1 expect() calls
```

## Why this is enough

The native TypeScript AST audit now proves `senpi-plugin` depends on `codex-plugin`, so the graph cannot launch two clean installers against the shared Codex plugin tree. The real clean `windows-latest` install remains the required surface proof before merge.

## Cleanup receipt

The test created no persistent process, server, socket, or temporary worktree.
