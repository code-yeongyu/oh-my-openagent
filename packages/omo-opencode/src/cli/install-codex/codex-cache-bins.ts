import { chmod, lstat, mkdir, readFile, readdir, readlink, rm, stat, symlink, writeFile } from "node:fs/promises"
import { basename, isAbsolute, join, relative, resolve, sep } from "node:path"
import { COMMAND_SHIM_MARKER } from "./codex-cache-command-shim"
import { isNodeErrorWithCode, isPlainRecord } from "./codex-cache-fs"
import { removeLegacyCodexComponentBins } from "./codex-cache-legacy-bins"

type LinkPlatform = NodeJS.Platform

const RESERVED_NESTED_BIN_NAMES = new Set(["omo", "lazycodex", "lazycodex-ai", "oh-my-opencode", "oh-my-openagent"])
const RUNTIME_WRAPPER_MARKER = "OMO_GENERATED_RUNTIME_WRAPPER"

export async function linkCachedPluginBins(input: {
  readonly binDir: string
  readonly pluginRoot: string
  readonly platform?: LinkPlatform
}): Promise<readonly { name: string; path: string; target: string }[]> {
  const binLinks = await discoverPackageBins(input.pluginRoot)
  const platform = input.platform ?? process.platform
  await mkdir(input.binDir, { recursive: true })
  await removeLegacyCodexComponentBins(input.binDir, platform)
  const linked: Array<{ name: string; path: string; target: string }> = []
  for (const link of binLinks) {
    const linkPath = await linkCachedPluginBin(input.binDir, link, platform)
    linked.push({ name: link.name, path: linkPath, target: link.target })
  }
  return linked
}

export async function linkRootRuntimeBin(input: {
  readonly binDir: string
  readonly codexHome: string
  readonly repoRoot: string
  readonly platform?: LinkPlatform
}): Promise<{ readonly name: string; readonly path: string; readonly target: string } | null> {
  const cliPath = join(input.repoRoot, "dist", "cli", "index.js")
  if (!(await isFile(cliPath))) return null

  const nodeCliPath = join(input.repoRoot, "dist", "cli-node", "index.js")
  const platform = input.platform ?? process.platform
  await mkdir(input.binDir, { recursive: true })
  if (platform === "win32") {
    const linkPath = join(input.binDir, "omo.cmd")
    await replaceRuntimeWrapper(linkPath, windowsRuntimeWrapper(cliPath, input.codexHome, input.binDir, nodeCliPath))
    return { name: "omo", path: linkPath, target: cliPath }
  }

  const linkPath = join(input.binDir, "omo")
  await replaceRuntimeWrapper(linkPath, posixRuntimeWrapper(cliPath, input.codexHome, input.binDir, nodeCliPath))
  await chmod(linkPath, 0o755)
  return { name: "omo", path: linkPath, target: cliPath }
}

async function linkCachedPluginBin(
  binDir: string,
  link: { readonly name: string; readonly target: string },
  platform: LinkPlatform,
): Promise<string> {
  if (platform === "win32") {
    const linkPath = join(binDir, `${link.name}.cmd`)
    await replaceCommandShim(linkPath, link.target)
    return linkPath
  }

  const linkPath = join(binDir, link.name)
  await replaceSymlink(linkPath, link.target)
  return linkPath
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile()
  } catch (error) {
    if (isNodeErrorWithCode(error) && error.code === "ENOENT") return false
    throw error
  }
}

async function discoverPackageBins(root: string): Promise<readonly { name: string; target: string }[]> {
  const links: Array<{ name: string; target: string }> = []
  await collectPackageBins(root, root, links)
  return links
}

async function collectPackageBins(directory: string, root: string, links: Array<{ name: string; target: string }>): Promise<void> {
  const entries = await readdir(directory, { withFileTypes: true })
  if (entries.some((entry) => entry.isFile() && entry.name === "package.json")) {
    await appendPackageBinLinks(join(directory, "package.json"), directory, root, links)
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    if (entry.name === "node_modules" || entry.name === ".git" || entry.name === "dist") continue
    const childPath = join(directory, entry.name)
    if (!childPath.startsWith(root)) continue
    await collectPackageBins(childPath, root, links)
  }
}

async function appendPackageBinLinks(
  packageJsonPath: string,
  packageRoot: string,
  root: string,
  links: Array<{ name: string; target: string }>,
): Promise<void> {
  const packageJson: unknown = JSON.parse(await readFile(packageJsonPath, "utf8"))
  if (!isPlainRecord(packageJson)) return
  const packageName = packageJson.name
  const packageBin = packageJson.bin
  if (typeof packageBin === "string" && typeof packageName === "string") {
    const name = assertSafeCommandName(basename(packageName))
    if (!isReservedNestedBinName(name, packageRoot, root)) {
      links.push({ name, target: resolvePackageBinTarget(packageRoot, packageBin) })
    }
    return
  }
  if (!isPlainRecord(packageBin)) return
  for (const [name, target] of Object.entries(packageBin)) {
    if (typeof target !== "string") continue
    const commandName = assertSafeCommandName(name)
    if (isReservedNestedBinName(commandName, packageRoot, root)) continue
    links.push({ name: commandName, target: resolvePackageBinTarget(packageRoot, target) })
  }
}

function assertSafeCommandName(name: string): string {
  if (name.length === 0 || name === "." || name === ".." || name.includes("/") || name.includes("\\") || name.includes("\0")) {
    throw new Error(`Invalid package bin command name: ${name}`)
  }
  return name
}

function isReservedNestedBinName(name: string, packageRoot: string, root: string): boolean {
  return packageRoot !== root && RESERVED_NESTED_BIN_NAMES.has(name)
}

function resolvePackageBinTarget(packageRoot: string, target: string): string {
  if (target.includes("\0")) throw new Error("Package bin target must stay inside package root")
  const root = resolve(packageRoot)
  const resolvedTarget = resolve(root, target)
  const relativeTarget = relative(root, resolvedTarget)
  if (relativeTarget === "" || (relativeTarget !== ".." && !relativeTarget.startsWith(`..${sep}`) && !isAbsolute(relativeTarget))) {
    return resolvedTarget
  }
  throw new Error("Package bin target must stay inside package root")
}

async function replaceSymlink(linkPath: string, targetPath: string): Promise<void> {
  if (await existingNonSymlink(linkPath)) throw new Error(`${linkPath} already exists and is not a symlink`)
  await rm(linkPath, { force: true })
  await symlink(targetPath, linkPath)
}

async function replaceCommandShim(linkPath: string, targetPath: string): Promise<void> {
  if (await existingNonShim(linkPath)) throw new Error(`${linkPath} already exists and is not a command shim`)
  await writeFile(linkPath, `@echo off\r\n${COMMAND_SHIM_MARKER}\r\nnode "${targetPath}" %*\r\n`)
}

async function replaceRuntimeWrapper(linkPath: string, content: string): Promise<void> {
  if (await existingNonRuntimeWrapper(linkPath)) throw new Error(`${linkPath} already exists and is not a generated OMO runtime wrapper`)
  await rm(linkPath, { force: true })
  await writeFile(linkPath, content)
}

async function existingNonRuntimeWrapper(path: string): Promise<boolean> {
  try {
    const stat = await lstat(path)
    if (stat.isSymbolicLink()) return false
    if (!stat.isFile()) return true
    const content = await readFile(path, "utf8")
    return !content.includes(RUNTIME_WRAPPER_MARKER)
  } catch (error) {
    if (isNodeErrorWithCode(error) && error.code === "ENOENT") return false
    throw error
  }
}

function posixRuntimeWrapper(cliPath: string, codexHome: string, binDir: string, nodeCliPath: string): string {
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
    `exec "$BUN_BINARY" "${escapedCliPath}" "$@"`,
    "",
  ].join("\n")
}

function windowsRuntimeWrapper(cliPath: string, codexHome: string, binDir: string, nodeCliPath: string): string {
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
    `"%BUN_BINARY%" "${cliPath}" %*`,
    "",
  ].join("\r\n")
}

function toPosixPath(p: string): string {
  return p.replaceAll("\\", "/")
}

function escapePosixDoubleQuoted(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"').replaceAll("$", "\\$").replaceAll("`", "\\`")
}

async function existingNonShim(path: string): Promise<boolean> {
  try {
    const stat = await lstat(path)
    if (!stat.isFile()) return true
    const content = await readFile(path, "utf8")
    if (content.includes(COMMAND_SHIM_MARKER)) return false
    throw new Error(`${path} already exists and is not a generated command shim`)
  } catch (error) {
    if (isNodeErrorWithCode(error) && error.code === "ENOENT") return false
    throw error
  }
}

async function existingNonSymlink(path: string): Promise<boolean> {
  try {
    const stat = await lstat(path)
    if (!stat.isSymbolicLink()) return true
    await readlink(path)
    return false
  } catch (error) {
    if (isNodeErrorWithCode(error) && error.code === "ENOENT") return false
    throw error
  }
}
