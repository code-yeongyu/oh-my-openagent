# Bash — LSP setup

- **Builtin server:** `bash` — `bash-language-server start`
- **Extensions:** `.sh .bash .zsh .ksh`
- **Install hint:** `npm install -g bash-language-server`

An alias id `bash-ls` exists with the identical command; either id works.

## Install

- **macOS:** `npm install -g bash-language-server`
- **Linux:** `npm install -g bash-language-server`
- **Windows:** `npm install -g bash-language-server` (PowerShell)

For real diagnostics, also install `shellcheck`:

- **macOS:** `brew install shellcheck`
- **Linux:** `apt install shellcheck` (or `dnf install ShellCheck`)
- **Windows:** `scoop install shellcheck`

Confirm it resolves:

```bash
command -v bash-language-server
command -v shellcheck
```

## Configure

Builtin — usually NO config needed (auto-resolved by extension). Configure only to set priority, init options, override extensions, or disable. Same JSON shape in `.codex/lsp-client.json` (Codex) AND `.opencode/lsp.json` (OpenCode/omo):

```json
{ "lsp": { "bash": { "priority": 100 } } }
```

For builtin ids in a PROJECT config, `command` is supplied automatically — only set `priority`/`initialization`/`extensions`/`disabled`/`env`. A fully custom (non-builtin) server with its own `command` must go in the USER config (`~/.codex/lsp-client.json`).

### Initialization options (only if commonly needed)

None commonly required. `bash-language-server` discovers `shellcheck` on PATH automatically. To point at a non-PATH binary, export `SHELLCHECK_PATH` via `env`:

```json
{ "lsp": { "bash": { "env": { "SHELLCHECK_PATH": "/opt/bin/shellcheck" } } } }
```

## Alternatives

- `shellcheck` standalone as a linter-only flow (no LSP).
- `shfmt` for formatting (complements, does not replace, the LSP).

## Troubleshooting
- **PATH:** `bash-language-server` on PATH; reopen shell after `npm -g` install.
- **No diagnostics:** `shellcheck` missing — diagnostics are powered by it; install and reopen.
- **Wrong shell dialect:** `.zsh`/`.ksh` are linted as bash; shellcheck may flag shell-specific syntax.

## Verify

```bash
bun ../../scripts/verify-lsp.ts path/to/file.sh
```
