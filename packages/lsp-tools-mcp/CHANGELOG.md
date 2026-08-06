# Changelog

All notable changes to this project are documented in this file.

## [0.1.0] - 2026-05-18

### Added

- Initial standalone extraction from `codex-lsp`:
  - LSP runtime (`src/lsp/*`)
  - MCP server (`src/mcp.ts`)
  - Tool definitions (`src/tools.ts`)
  - Standalone CLI (`src/cli.ts`, `mcp` subcommand only)
- Config path override support:
  - `LSP_TOOLS_MCP_PROJECT_CONFIG`
  - `LSP_TOOLS_MCP_USER_CONFIG`
- Full test suite import (excluding Codex-specific hook tests)
- CI workflow matrix (ubuntu/macos/windows x node 20/22)
- Release-triggered npm publish workflow
- Repository governance files (ruleset, CODEOWNERS, dependabot, issue templates, PR template)
