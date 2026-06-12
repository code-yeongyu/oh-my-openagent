# Dart — LSP setup

- **Builtin server:** `dart` — `dart language-server --lsp`
- **Extensions:** `.dart`
- **Install hint:** `Included with the Dart/Flutter SDK`

## Install

The language server ships inside the Dart SDK (and the Flutter SDK, which bundles Dart). There is no separate package to install — just put `dart` (or `flutter`) on PATH.

- **macOS:** `brew install dart` (or install Flutter and use its bundled `dart`)
- **Linux:** install the Dart SDK from your package manager / `https://dart.dev/get-dart`, or install Flutter
- **Windows:** install the Dart SDK or Flutter SDK and add its `bin` to PATH

Confirm it resolves:

```bash
command -v dart
```

## Configure

Builtin — usually NO config needed (auto-resolved by extension). Configure only to set priority, init options, override extensions, or disable. Same JSON shape in `.codex/lsp-client.json` (Codex) AND `.opencode/lsp.json` (OpenCode/omo):

```json
{ "lsp": { "dart": { "priority": 100 } } }
```

For builtin ids in a PROJECT config, `command` is supplied automatically — only set `priority`/`initialization`/`extensions`/`disabled`/`env`. A fully custom (non-builtin) server with its own `command` must go in the USER config (`~/.codex/lsp-client.json`).

### Initialization options (only if commonly needed)

None commonly required.

## Alternatives

None.

## Troubleshooting
- **PATH:** `dart` must be on PATH; reopen the shell after installing the SDK. Flutter users: ensure `<flutter>/bin/cache/dart-sdk/bin` or the Flutter `bin` is exported.
- **Flutter vs Dart:** if you only have Flutter installed, the bundled `dart` works — make sure Flutter's `bin` is on PATH rather than relying on a separate Dart install.
- **SDK out of date:** run `dart --version` / `flutter upgrade` if analysis behaves oddly on newer language features.

## Verify

```bash
bun ../../scripts/verify-lsp.ts path/to/file.dart
```
