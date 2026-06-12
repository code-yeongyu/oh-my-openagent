# Java — LSP setup

- **Builtin server:** `jdtls` — `jdtls`
- **Extensions:** `.java`
- **Install hint:** `https://github.com/eclipse-jdtls/eclipse.jdt.ls`

## Install

- **macOS:** `brew install jdtls`
- **Linux:** Download from [eclipse-jdtls/eclipse.jdt.ls](https://github.com/eclipse-jdtls/eclipse.jdt.ls) releases, extract, and wrap the launcher as `jdtls` on PATH (some distros package it as `jdtls`/`jdt-language-server`).
- **Windows:** Download the release archive and add the `jdtls` launcher (`bin/jdtls.bat` or the Python wrapper) to PATH.

Requires a **JDK 17+** to run the language server itself (the project may target an older Java version).

Confirm it resolves:

```bash
command -v jdtls
```

## Configure

Builtin — usually NO config needed (auto-resolved by extension). Configure only to set priority, init options, override extensions, or disable. Same JSON shape in `.codex/lsp-client.json` (Codex) AND `.opencode/lsp.json` (OpenCode/omo):

```json
{ "lsp": { "jdtls": { "priority": 100 } } }
```

For builtin ids in a PROJECT config, `command` is supplied automatically — only set `priority`/`initialization`/`extensions`/`disabled`/`env`. A fully custom (non-builtin) server with its own `command` must go in the USER config (`~/.codex/lsp-client.json`).

### Initialization options (only if commonly needed)

jdtls maintains a per-project **workspace data directory** and the **first index is slow** (it resolves the full classpath and builds). Point `JAVA_HOME` at a JDK 17+ if `jdtls` cannot find one:

```json
{ "lsp": { "jdtls": { "env": { "JAVA_HOME": "/Library/Java/JavaVirtualMachines/temurin-17.jdk/Contents/Home" } } } }
```

Most settings (runtimes, format, import order) are passed via `settings.java.*` initialization options; defaults work for Maven/Gradle projects with a standard layout.

## Alternatives

- **No mainstream alternative.** `jdtls` (Eclipse JDT Language Server) is the de-facto standard and powers the official VS Code Java extension.

## Troubleshooting

- **PATH:** `jdtls` on PATH; reopen shell after install.
- **No JDK found:** server exits immediately — set `JAVA_HOME` to a JDK 17+.
- **Slow / no completions at first:** the initial classpath index can take a minute or more on large Maven/Gradle projects; wait for it to finish.
- **Stale state:** delete the jdtls workspace data dir to force a clean re-index if results go wrong after big dependency changes.
- **Build tool required:** keep `pom.xml` / `build.gradle` valid; a broken build descriptor breaks symbol resolution.

## Verify

```bash
bun ../../scripts/verify-lsp.ts path/to/File.java
```
