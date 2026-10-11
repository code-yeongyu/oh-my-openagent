# Desktop (computer-use) crates

The cross-platform computer-use engine behind omo-senpi's `computer` tool. It is tracked in code-yeongyu/oh-my-openagent#8893, and the `senpi-desktop-*` names follow omo's senpi-integration naming (as in `senpi-task`).

- `senpi-desktop-core` - types, errors, frames, keys, AX registry, backend traits, the frozen JSON-RPC contract.
- `senpi-desktop-safety` - fail-closed Supervisor, stop-path registry, `gate()`.
- `senpi-desktop-session` - session loop, `mutate()` choke point, screenshot budget, audit.
- `senpi-desktop-backend-{fake,macos,x11,atspi,wayland,win32}` - per-OS backends.
- `senpi-desktop-engine` - the standalone JSON-RPC 2.0 NDJSON stdio binary.

PR-0 (this branch) lands the contract, the scaffold and the native build pipeline; later PRs fill in the backends and host surfaces.
