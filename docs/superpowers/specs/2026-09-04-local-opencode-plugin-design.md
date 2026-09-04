# Local OpenCode Plugin Wiring Design

## Goal

Configure the installed OpenCode 1.18.27 instance to load the oh-my-openagent source from the cloned checkout at:

```text
file:///home/heki/workspace/oh-my-openagent/packages/omo-opencode/src/index.ts
```

After this change, pulling new commits into the checkout updates the code OpenCode loads without republishing or relinking the package.

## Configuration behavior

The existing OpenCode configuration remains intact. Its `model-watch` plugin entry and `ouroboros` MCP definition are preserved. Before adding the source entry, any existing package-style `oh-my-opencode` or `oh-my-openagent` plugin entry is removed so the runtime duplicate-OMO guard cannot disable startup. The OMO source entry is then added to the active OpenCode JSONC plugin array and is kept idempotent, meaning repeated setup does not create duplicates.

The checkout's workspace dependencies must be installed for the source entry to resolve. If a future pull changes dependency manifests or the lockfile, the dependency install step must be repeated; source-only pulls are picked up immediately.

## Verification

Verification covers four boundaries:

1. The OpenCode config parses, contains the source entry exactly once, and contains no OMO package-style plugin entry.
2. Existing plugin and MCP entries remain present.
3. The OMO doctor recognizes the local source plugin and the installed OpenCode version.
4. A real OpenCode smoke run loads a faithful copy of the edited configuration — including `model-watch`, `ouroboros`, and the OMO source entry — in an isolated XDG sandbox, while the real OpenCode session database remains unchanged.

Secrets, authentication values, and private environment data are not copied into repository evidence.

## Residual risk

The source path is machine-specific and therefore intentionally local to this checkout. Moving the clone requires updating the plugin entry. Dependency changes after a pull still require the repository's package-manager install command.
