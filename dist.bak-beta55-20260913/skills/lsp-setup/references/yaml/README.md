# YAML — LSP setup

- **Builtin server:** `yaml-ls` — `yaml-language-server --stdio`
- **Extensions:** `.yaml .yml`
- **Install hint:** `npm install -g yaml-language-server`

## Install

- **macOS:** `npm install -g yaml-language-server`
- **Linux:** `npm install -g yaml-language-server`
- **Windows:** `npm install -g yaml-language-server` (PowerShell)

Confirm it resolves:

```bash
command -v yaml-language-server
```

## Configure

Builtin — usually NO config needed (auto-resolved by extension). Configure only to set priority, init options, override extensions, or disable. Same JSON shape in `.codex/lsp-client.json` (Codex) AND `.opencode/lsp.json` (OpenCode/omo):

```json
{ "lsp": { "yaml-ls": { "priority": 100 } } }
```

For builtin ids in a PROJECT config, `command` is supplied automatically — only set `priority`/`initialization`/`extensions`/`disabled`/`env`. A fully custom (non-builtin) server with its own `command` must go in the USER config (`~/.codex/lsp-client.json`).

### Initialization options (only if commonly needed)

Schema association is the main reason to configure yaml-ls. Map globs to a schema URL or local path under `yaml.schemas`:

```json
{
  "lsp": {
    "yaml-ls": {
      "initialization": {
        "yaml": {
          "schemas": {
            "https://json.schemastore.org/github-workflow.json": ".github/workflows/*.yml",
            "https://json.schemastore.org/kustomization.json": "kustomization.yaml",
            "./schemas/my-config.schema.json": "config/*.yaml"
          },
          "validate": true,
          "completion": true,
          "format": { "enable": true }
        }
      }
    }
  }
}
```

Set `"yaml.schemaStore": { "enable": true }` to auto-resolve schemas from SchemaStore (catalog at https://www.schemastore.org/). Inline `# yaml-language-server: $schema=<url>` modelines also work without config.

## Alternatives

- `redhat.vscode-yaml` bundles the same server in editors.
- `yamllint` standalone for style/lint-only checks.

## Troubleshooting
- **PATH:** `yaml-language-server` on PATH; reopen shell after `npm -g` install.
- **No validation:** no schema matched — add a `yaml.schemas` glob or a `$schema` modeline.
- **Wrong schema applied:** SchemaStore guessed by filename; pin explicitly under `yaml.schemas`.

## Verify

```bash
bun ../../scripts/verify-lsp.ts path/to/file.yaml
```
