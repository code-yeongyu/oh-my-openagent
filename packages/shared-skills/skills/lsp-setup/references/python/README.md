# Python — LSP setup

- **Builtin server:** `basedpyright` — `basedpyright-langserver --stdio`
- **Extensions:** `.py .pyi`
- **Install hint:** `pip install basedpyright`

## Install

- **macOS:** `pip install basedpyright` (or `uv tool install basedpyright`)
- **Linux:** `pip install basedpyright` (or `uv tool install basedpyright`)
- **Windows:** `pip install basedpyright`

Prefer `uv tool install basedpyright` when the project uses uv — it keeps the
server isolated from project venvs and always on PATH.

Confirm it resolves:

```bash
command -v basedpyright-langserver
```

## Configure

Builtin — usually NO config needed (auto-resolved by extension). Configure only to set priority, init options, override extensions, or disable. Same JSON shape in `.codex/lsp-client.json` (Codex) AND `.opencode/lsp.json` (OpenCode/omo):

```json
{ "lsp": { "basedpyright": { "priority": 100 } } }
```

For builtin ids in a PROJECT config, `command` is supplied automatically — only set `priority`/`initialization`/`extensions`/`disabled`/`env`. A fully custom (non-builtin) server with its own `command` must go in the USER config (`~/.codex/lsp-client.json`).

### Initialization options (only if commonly needed)

None commonly required. Type-check mode is usually set via `pyrightconfig.json`
or `[tool.basedpyright]` in `pyproject.toml`, not the LSP config.

## Choosing a server

All four are builtin. Type checkers and the linter serve different roles — run a
type server, and optionally `ruff` ALONGSIDE it (not instead).

| id            | command                       | install                | role                                    |
| ------------- | ----------------------------- | ---------------------- | --------------------------------------- |
| `basedpyright`| `basedpyright-langserver --stdio` | `pip install basedpyright` | strictest types, **default**       |
| `pyright`     | `pyright-langserver --stdio`  | `pip install pyright`  | upstream Microsoft type checker         |
| `ty`          | `ty server`                   | `pip install ty`       | Astral, very fast, pre-1.0/experimental |
| `ruff`        | `ruff server`                 | `pip install ruff`     | lint + format only, complements a type server |

Recommended priority: **basedpyright** (default) > pyright > ty (experimental).
`ruff` complements via priority — it does not type-check, so keep a type server
enabled.

Enable ruff alongside basedpyright, disabling pyright:

```json
{ "lsp": {
  "basedpyright": { "priority": 100 },
  "ruff": { "priority": 90 },
  "pyright": { "disabled": true }
} }
```

## Troubleshooting
- **PATH:** `basedpyright-langserver` must be on PATH; reopen shell after install. `uv tool install` writes to `~/.local/bin`.
- **Wrong interpreter / missing imports:** the server must see the project venv. Set `python.pythonPath` / `venvPath` in `pyrightconfig.json`, or activate the venv before launching.

## Verify

```bash
bun ../../scripts/verify-lsp.ts path/to/file.py
```
