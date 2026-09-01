---
name: lsp
description: Use when Codex needs language-server diagnostics, definitions, references, symbols, or rename safety checks in the current workspace.
---

# Codex LSP

Call `lsp` MCP tools through the tool interface; `lsp.*`/`mcp__lsp__*` are tool-call names, not shell commands.

## Tools

- `lsp.status`: list configured, installed, missing, disabled, and active language servers.
- `lsp.diagnostics`: check one file or directory for LSP diagnostics. Prefer `severity: "error"` after edits.
- `lsp.goto_definition`: locate a symbol definition from file, line, and character.
- `lsp.find_references`: find usages of a symbol across the workspace.
- `lsp.symbols`: inspect document symbols or search workspace symbols.
- `lsp.prepare_rename`: check whether a rename is valid at a position.
- `lsp.rename`: apply a language-server workspace edit for a rename.

## Config

Project config lives at `.codex/lsp-client.json`; user config lives at `~/.codex/lsp-client.json`.

```json
{
	"lsp": {
		"typescript": {
			"command": ["typescript-language-server", "--stdio"],
			"extensions": [".ts", ".tsx", ".js", ".jsx"]
		}
	}
}
```

Use `lsp.status` first when diagnostics report a missing language server.
