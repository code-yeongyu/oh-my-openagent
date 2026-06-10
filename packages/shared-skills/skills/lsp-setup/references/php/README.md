# PHP — LSP setup

- **Builtin server:** `php` — `intelephense --stdio`
- **Extensions:** `.php`
- **Install hint:** `npm install -g intelephense`

## Install

Intelephense is a Node package, so Node.js (and npm) must be installed first.

- **macOS:** `npm install -g intelephense`
- **Linux:** `npm install -g intelephense`
- **Windows:** `npm install -g intelephense`

Confirm it resolves:

```bash
command -v intelephense
```

## Configure

Builtin — usually NO config needed (auto-resolved by extension). Configure only to set priority, init options, override extensions, or disable. Same JSON shape in `.codex/lsp-client.json` (Codex) AND `.opencode/lsp.json` (OpenCode/omo):

```json
{ "lsp": { "php": { "priority": 100 } } }
```

For builtin ids in a PROJECT config, `command` is supplied automatically — only set `priority`/`initialization`/`extensions`/`disabled`/`env`. A fully custom (non-builtin) server with its own `command` must go in the USER config (`~/.codex/lsp-client.json`).

### Initialization options (only if commonly needed)

Intelephense's premium features (rename, find-all-implementations, declaration providers, etc.) require a licence key. Supply it via `initialization`:

```json
{
  "lsp": {
    "php": {
      "initialization": {
        "licenceKey": "YOUR-LICENCE-KEY"
      }
    }
  }
}
```

Without a key the server runs fine in free mode.

## Alternatives

- **phpactor** (not builtin): `phpactor language-server`. Pure-PHP, no Node dependency.

## Troubleshooting
- **PATH:** `intelephense` must be on PATH; reopen the shell after a global npm install. If missing, check `npm bin -g` is on PATH.
- **No Node:** Intelephense fails to start without Node.js. Install Node, then reinstall.
- **Wrong PHP version inference:** set `intelephense.environment.phpVersion` via `initialization` to match your project.

## Verify

```bash
bun ../../scripts/verify-lsp.ts path/to/file.php
```
