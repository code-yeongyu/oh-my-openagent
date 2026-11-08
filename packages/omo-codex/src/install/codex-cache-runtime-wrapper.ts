import { join } from "node:path"
import { windowsNodeDiscoveryLines } from "./codex-cache-command-shim"

export const RUNTIME_WRAPPER_MARKER = "OMO_GENERATED_RUNTIME_WRAPPER"

export function posixRuntimeWrapper(
  binName: string,
  cliPath: string,
  codexHome: string,
  binDir: string,
  nodeCliPath: string,
): string {
  const ulwLoopBin = toPosixPath(join(binDir, "omo-ulw-loop"))
  const nodeCli = escapePosixDoubleQuoted(toPosixPath(nodeCliPath))
  const escapedCliPath = escapePosixDoubleQuoted(toPosixPath(cliPath))
  const escapedCodexHome = escapePosixDoubleQuoted(toPosixPath(codexHome))
  const escapedUlwLoopBin = escapePosixDoubleQuoted(ulwLoopBin)
  return [
    "#!/bin/sh",
    `# ${RUNTIME_WRAPPER_MARKER}`,
    `export CODEX_HOME="\${CODEX_HOME:-${escapedCodexHome}}"`,
    `export OMO_INVOCATION_NAME=${binName}`,
    "export OMO_EDITION=codex",
    'if [ "$1" = "ulw-loop" ] && [ -x "' + escapedUlwLoopBin + '" ]; then',
    "  shift",
    '  exec "' + escapedUlwLoopBin + '" ulw-loop "$@"',
    "fi",
    `if [ "\${OMO_RUNTIME:-}" = "node" ] && [ -f "${nodeCli}" ]; then`,
    `  exec node "${nodeCli}" "$@"`,
    "fi",
    'BUN_BINARY="${BUN_BINARY:-}"',
    'if [ -z "$BUN_BINARY" ] && command -v bun >/dev/null 2>&1; then',
    "  BUN_BINARY=bun",
    "fi",
    'if [ -z "$BUN_BINARY" ]; then',
    '  for omo_bun_candidate in "$HOME/.bun/bin/bun" /opt/homebrew/bin/bun /usr/local/bin/bun; do',
    '    if [ -x "$omo_bun_candidate" ]; then',
    '      BUN_BINARY="$omo_bun_candidate"',
    "      break",
    "    fi",
    "  done",
    "fi",
    'if [ -z "$BUN_BINARY" ]; then',
    `  if [ -f "${nodeCli}" ] && command -v node >/dev/null 2>&1; then`,
    `    exec node "${nodeCli}" "$@"`,
    "  fi",
    `  echo "${binName}: bun runtime not found (checked PATH, ~/.bun/bin, /opt/homebrew/bin, /usr/local/bin) and the node fallback CLI is missing at ${nodeCli}; install bun from https://bun.sh, or reinstall ${binName} and force the fallback with OMO_RUNTIME=node" >&2`,
    "  exit 127",
    "fi",
    `if [ ! -f "${escapedCliPath}" ]; then`,
    `  echo "${binName}: runtime target missing at ${escapedCliPath}; reinstall with: npx --yes lazycodex-ai@latest install --no-tui" >&2`,
    "  exit 1",
    "fi",
    `exec "$BUN_BINARY" "${escapedCliPath}" "$@"`,
    "",
  ].join("\n")
}

export function windowsRuntimeWrapper(
  binName: string,
  cliPath: string,
  codexHome: string,
  binDir: string,
  nodeCliPath: string,
): string {
  const ulwLoopBin = escapeCmdQuoted(join(binDir, "omo-ulw-loop.cmd"))
  const cli = escapeCmdQuoted(cliPath)
  const nodeCli = escapeCmdQuoted(nodeCliPath)
  return [
    "@echo off",
    `rem ${RUNTIME_WRAPPER_MARKER}`,
    // Before `setlocal EnableDelayedExpansion` (in the node discovery lines), so only `%` is special here.
    `if not defined CODEX_HOME set "CODEX_HOME=${escapeCmdQuoted(codexHome, false)}"`,
    `set "OMO_INVOCATION_NAME=${binName}"`,
    'set "OMO_EDITION=codex"',
    ...windowsNodeDiscoveryLines(),
    `if "%~1"=="ulw-loop" if exist "${ulwLoopBin}" (`,
    "  shift /1",
    `  "${ulwLoopBin}" ulw-loop %*`,
    "  exit /b %ERRORLEVEL%",
    ")",
    `if "%OMO_RUNTIME%"=="node" if defined OMO_NODE_BINARY if exist "${nodeCli}" (`,
    `  "%OMO_NODE_BINARY%" "${nodeCli}" %*`,
    "  exit /b %ERRORLEVEL%",
    ")",
    'if not defined BUN_BINARY where bun >nul 2>nul && set "BUN_BINARY=bun"',
    'if not defined BUN_BINARY if exist "%USERPROFILE%\\.bun\\bin\\bun.exe" set "BUN_BINARY=%USERPROFILE%\\.bun\\bin\\bun.exe"',
    "if not defined BUN_BINARY (",
    `  if defined OMO_NODE_BINARY if exist "${nodeCli}" (`,
    `    "%OMO_NODE_BINARY%" "${nodeCli}" %*`,
    "    exit /b %ERRORLEVEL%",
    "  )",
    // The paths in the echo lines are quoted too: unquoted, a `)` in them (`C:\Users\Kim (Work)`) would close the block.
    `  echo ${binName}: bun runtime not found, no Node runtime was discovered from NODE_REPL_NODE_PATH or PATH, or the node fallback CLI is missing at "${nodeCli}"; install bun from https://bun.sh or rerun LazyCodex install from Codex Desktop 1>&2`,
    "  exit /b 127",
    ")",
    `if not exist "${cli}" (`,
    `  echo ${binName}: runtime target missing at "${cli}"; reinstall with: npx --yes lazycodex-ai@latest install --no-tui 1>&2`,
    "  exit /b 1",
    ")",
    `"%BUN_BINARY%" "${cli}" %*`,
    "",
  ].join("\r\n")
}

/**
 * A value for a double-quoted spot in the `.cmd` wrapper. cmd expands `%VAR%` in every line, so `%` is doubled. After
 * `setlocal EnableDelayedExpansion` (`windowsNodeDiscoveryLines`) a line holding `!` also expands `!VAR!` and strips
 * carets even inside quotes, so there a value with `!` escapes `^` and `!` for that pass. Every other metacharacter is
 * literal inside the quotes (#12811). The doctors' readers (`doctor-migration.js`, `codex-runtime-wrapper.ts`) undo it.
 */
function escapeCmdQuoted(value: string, delayedExpansion = true): string {
  const percent = value.replaceAll("%", "%%")
  return delayedExpansion && percent.includes("!") ? percent.replaceAll("^", "^^").replaceAll("!", "^!") : percent
}

function toPosixPath(path: string): string {
  return path.replaceAll("\\", "/")
}

function escapePosixDoubleQuoted(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"').replaceAll("$", "\\$").replaceAll("`", "\\`")
}
