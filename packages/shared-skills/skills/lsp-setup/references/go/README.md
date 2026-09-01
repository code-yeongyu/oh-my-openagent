# Go — LSP setup

- **Builtin server:** `gopls` — `gopls`
- **Extensions:** `.go`
- **Install hint:** `go install golang.org/x/tools/gopls@latest`

## Install

- **macOS:** `go install golang.org/x/tools/gopls@latest` (or `brew install gopls`)
- **Linux:** `go install golang.org/x/tools/gopls@latest`
- **Windows:** `go install golang.org/x/tools/gopls@latest`

Requires the Go toolchain. `go install` drops the binary in `$GOPATH/bin`
(default `~/go/bin`) — that directory must be on PATH.

```bash
export PATH="$PATH:$(go env GOPATH)/bin"
```

Confirm it resolves:

```bash
command -v gopls
```

## Configure

Builtin — usually NO config needed (auto-resolved by extension). Configure only to set priority, init options, override extensions, or disable. Same JSON shape in `.codex/lsp-client.json` (Codex) AND `.opencode/lsp.json` (OpenCode/omo):

```json
{ "lsp": { "gopls": { "priority": 100 } } }
```

For builtin ids in a PROJECT config, `command` is supplied automatically — only set `priority`/`initialization`/`extensions`/`disabled`/`env`. A fully custom (non-builtin) server with its own `command` must go in the USER config (`~/.codex/lsp-client.json`).

### Initialization options (only if commonly needed)

None commonly required. To enable extra analyses or staticcheck:

```json
{ "lsp": { "gopls": { "initialization": { "staticcheck": true } } } }
```

## Alternatives

None — `gopls` is the official and de facto sole Go language server.

## Troubleshooting
- **PATH:** `gopls` must be on PATH; ensure `$(go env GOPATH)/bin` is exported, then reopen the shell.
- **No diagnostics / "no required module":** open the directory containing `go.mod` as the workspace root. Outside a module, gopls degrades. Run `go mod tidy` if dependencies are unresolved.
- **Stale toolchain:** reinstall with `go install golang.org/x/tools/gopls@latest` after upgrading Go.

## Verify

```bash
bun ../../scripts/verify-lsp.ts path/to/file.go
```
