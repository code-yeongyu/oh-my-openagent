# PR 7492 base refresh

## What was tested

Merged dev `c6c22332f291422751c299fb3ecd7590033b0dc2` into PR head
`1c06aac92446b472dc9a50c80d0a2f3e2bf5fa35`. The automatic merge had no
conflicts and required no new production logic.

With Bun 1.4.0 and Node 24:

- Ran the focused config-directory, misplaced-category, plugin-factory,
  live-route, startup, telemetry and config suites.
- Ran `tsgo --noEmit -p packages/omo-opencode/tsconfig.json`.
- Ran the full `bun run build`.
- Ran actual OpenCode 1.18.30 against the resulting plugin in a disposable
  Docker container, using global SSE and the config endpoint.

## What was observed

Focused tests: 256 passed, zero failed. Compiler and full build passed.
The build required command-scoped permission for existing local submodule
transports; no permanent Git configuration was changed.

The misplaced-location case returned HTTP 200 and emitted `tui.toast.show`
with variant `warning` and this message:

```
OMO ignores "categories" in /qa/server-misplaced/home/project/opencode.jsonc; move it to /qa/server-misplaced/home/project/.omo/omo.jsonc under "[opencode]".categories.
```

The correctly located configuration returned HTTP 200, configured the real
plugin agents and emitted no misplaced-category warning. Both servers exited
0. Both isolated databases contained zero sessions.

The host OpenCode session count remained 8083 before and after. No real home,
private skills, configuration or credentials were mounted. Only the built
plugin, public package metadata, zod and task-owned evidence were mounted.

## Why this is sufficient

The tests cover discovery and precedence; the wire event proves the actual
default factory emitted the warning, rather than merely completing a model
turn. The correctly located control exercises warning suppression.

## Limitations and omissions

The initial validation used older host tools. The accepted tests, build and
both real-server cases above were rerun with the fixed toolchain. Distinct
ports in the isolated container avoid the previous connection-reuse failure.

LSP rejected sibling-worktree access; command-line compilation passed.
Desktop/TUI rendering and live model conversations were not exercised.
Unrelated generated build drift remains unstaged. Historical whitespace
warnings were not concealed.

Full raw logs, synthetic fixtures and replay drivers are retained locally.
Private paths, host configuration contents and raw environment values are
omitted from this public summary.
