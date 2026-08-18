# GREEN - root build gate and serialized plugin ownership

## What was tested

```bash
cd <worktree>
npx --yes bun@1.3.12 run build
```

## What was observed

Build node flush order (completion order) put the Codex owner of the shared plugin tree before the Senpi stager, which is the ordering this PR introduces:

```text
... build:lsp-daemon, build:lsp-tools-mcp, build:codex-plugin, build:senpi-plugin
build: all steps completed
ROOT_BUILD_DONE exit=0
```

`build:codex-plugin` precedes `build:senpi-plugin` (asserted programmatically: codex index < senpi index).

## Attribution of the nested lockfile warning

`build:codex-plugin` printed `UnknownLockfileVersion: failed to parse lockfile: 'bun.lock'` from the
`components/bootstrap` sub-build. That is an untracked component lockfile written by the workstation's
Bun 1.4.0 and re-read by the CI-pinned Bun 1.3.12; the sub-build ignores it, re-resolves, and succeeds.
The tracked root `bun.lock` was verified unchanged (`git diff --exit-code -- bun.lock` -> LOCKFILE_UNCHANGED).
CI uses one Bun version per job, so this mixed-version warning cannot occur there.

## Why this is enough

The clean-install failure on Windows was concurrent mutation of `packages/omo-codex/plugin/node_modules`
by two build nodes. This run proves the graph now serializes those two nodes on a real build, and the
authored graph invariant is pinned by `script/build-graph-dependencies.test.ts`.

## Cleanup receipt

The build regenerated six generated artifacts (codegraph dist x2, install-dist bundle, three Senpi
extension bundles) under local Bun 1.4.0 minifier churn. All six were restored with
`git restore --source=HEAD --`; `git status` afterwards showed only the four authored changes.
