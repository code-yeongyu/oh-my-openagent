import { join } from "node:path"

export const RUNTIME_WRAPPER_MARKER = "OMO_GENERATED_RUNTIME_WRAPPER"

export function posixRuntimeWrapper(cliPath: string, codexHome: string, binDir: string, nodeCliPath: string): string {
  const ulwLoopBin = toPosixPath(join(binDir, "omo-ulw-loop"))
  const nodeCli = escapePosixDoubleQuoted(toPosixPath(nodeCliPath))
  const escapedCliPath = escapePosixDoubleQuoted(toPosixPath(cliPath))
  const escapedCodexHome = escapePosixDoubleQuoted(toPosixPath(codexHome))
  const escapedUlwLoopBin = escapePosixDoubleQuoted(ulwLoopBin)
  return [
    "#!/bin/sh",
    `# ${RUNTIME_WRAPPER_MARKER}`,
    `export CODEX_HOME="\${CODEX_HOME:-${escapedCodexHome}}"`,
    'export OMO_SPARKSHELL_APP_SERVER_SOCKET="${OMO_SPARKSHELL_APP_SERVER_SOCKET:-$CODEX_HOME/app-server-control/app-server-control.sock}"',
    'if [ "$1" = "ulw-loop" ] && [ -x "' + escapedUlwLoopBin + '" ]; then',
    "  shift",
    '  exec "' + escapedUlwLoopBin + '" "$@"',
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
    `  echo "omo: bun runtime not found (checked PATH, ~/.bun/bin, /opt/homebrew/bin, /usr/local/bin) and the node fallback CLI is missing at ${nodeCli}; install bun from https://bun.sh, or reinstall omo and force the fallback with OMO_RUNTIME=node" >&2`,
    "  exit 127",
    "fi",
    `if [ ! -f "${escapedCliPath}" ]; then`,
    `  echo "omo: runtime target missing at ${escapedCliPath}; reinstall with: npx --yes lazycodex-ai@latest install --no-tui" >&2`,
    "  exit 1",
    "fi",
    `exec "$BUN_BINARY" "${escapedCliPath}" "$@"`,
    "",
  ].join("\n")
}

export function windowsRuntimeWrapper(cliPath: string, codexHome: string, binDir: string, nodeCliPath: string): string {
  const ulwLoopBin = join(binDir, "omo-ulw-loop.cmd")
  return [
    "@echo off",
    `rem ${RUNTIME_WRAPPER_MARKER}`,
    `if not defined CODEX_HOME set "CODEX_HOME=${codexHome}"`,
    'if not defined OMO_SPARKSHELL_APP_SERVER_SOCKET set "OMO_SPARKSHELL_APP_SERVER_SOCKET=%CODEX_HOME%\\app-server-control\\app-server-control.sock"',
    `if "%~1"=="ulw-loop" if exist "${ulwLoopBin}" (`,
    "  shift /1",
    `  "${ulwLoopBin}" %*`,
    "  exit /b %ERRORLEVEL%",
    ")",
    `if "%OMO_RUNTIME%"=="node" if exist "${nodeCliPath}" (`,
    `  node "${nodeCliPath}" %*`,
    "  exit /b %ERRORLEVEL%",
    ")",
    'if not defined BUN_BINARY where bun >nul 2>nul && set "BUN_BINARY=bun"',
    'if not defined BUN_BINARY if exist "%USERPROFILE%\\.bun\\bin\\bun.exe" set "BUN_BINARY=%USERPROFILE%\\.bun\\bin\\bun.exe"',
    "if not defined BUN_BINARY (",
    `  if exist "${nodeCliPath}" (`,
    `    node "${nodeCliPath}" %*`,
    "    exit /b %ERRORLEVEL%",
    "  )",
    `  echo omo: bun runtime not found and the node fallback CLI is missing at ${nodeCliPath}; install bun from https://bun.sh or reinstall omo and force OMO_RUNTIME=node 1>&2`,
    "  exit /b 127",
    ")",
    `if not exist "${cliPath}" (`,
    `  echo omo: runtime target missing at ${cliPath}; reinstall with: npx --yes lazycodex-ai@latest install --no-tui 1>&2`,
    "  exit /b 1",
    ")",
    `"%BUN_BINARY%" "${cliPath}" %*`,
    "",
  ].join("\r\n")
}

function toPosixPath(path: string): string {
  return path.replaceAll("\\", "/")
}

function escapePosixDoubleQuoted(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"').replaceAll("$", "\\$").replaceAll("`", "\\`")
}
