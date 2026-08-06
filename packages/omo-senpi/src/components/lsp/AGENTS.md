# omo-senpi LSP Component

Daemon-backed Senpi LSP adapter. This component retains only Senpi-facing descriptors, schemas, renderers, path extraction, post-edit wiring, and migration-warning helpers adapted from `pi-lsp-client` / oh-my-pi by Yeongyu Kim. Client, transport, JSON-RPC, manager, server-resolution, project-trust, diagnostics, workspace-edit, and process execution live in `@oh-my-opencode/lsp-core` plus the packaged `@code-yeongyu/lsp-daemon` runtime.

Project-local `.pi/lsp-client.json` commands are intentionally ignored here. Users who still need custom LSP commands must move those definitions to their user `.pi/lsp-client.json`; project configs may keep safe fields such as extensions and priorities, but command/env entries only produce a migration warning.
