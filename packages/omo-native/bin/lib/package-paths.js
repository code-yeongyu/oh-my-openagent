import { existsSync, readFileSync } from "node:fs"
import { basename, dirname, join, parse } from "node:path"
import { fileURLToPath } from "node:url"

export const packageRoot = fileURLToPath(new URL("../..", import.meta.url))

export function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"))
}

export function packageManifest() {
  return readJson(join(packageRoot, "package.json"))
}

function quotePosix(value) {
  return `'${value.replaceAll("'", "'\\''")}'`
}

export function updateTarget(root = packageRoot, platform = process.platform) {
  const updateCwd = dirname(join(root, "package.json"))
  const normalizedRoot = updateCwd.replaceAll("\\", "/")
  if (normalizedRoot.endsWith("/install/global/node_modules/omo-ai")) {
    const quotedCwd = platform === "win32"
      ? `"${normalizedRoot}"`
      : quotePosix(updateCwd)
    return {
      manager: "bun",
      command: `bun add --cwd ${quotedCwd} -g omo-ai@beta`,
    }
  }
  return { manager: "npm", command: "npm i -g omo-ai@beta" }
}

export function resolveSenpi(options = {}) {
  const {
    resolveIndex = () => fileURLToPath(import.meta.resolve("@code-yeongyu/senpi")),
    platform = process.platform,
  } = options
  let indexPath
  try {
    indexPath = resolveIndex()
  } catch (error) {
    throw new Error(`could not resolve @code-yeongyu/senpi; reinstall with: ${updateTarget().command} (${error.message})`)
  }

  const distDir = dirname(indexPath)
  const cliPath = join(distDir, "cli.js")
  if (!existsSync(cliPath)) {
    throw new Error(`senpi CLI is missing at ${cliPath}; reinstall with: ${updateTarget().command}`)
  }
  // The engine imports this module on every boot, and it is the file interrupted upgrades lose in
  // the wild (npm reify dies on a Windows-locked native module and leaves a partial tree), so
  // checking it here turns the engine's raw ERR_MODULE_NOT_FOUND stack into one actionable line.
  const brandPath = join(distDir, "core", "brand.js")
  if (!existsSync(brandPath)) {
    const windowsHint = platform === "win32"
      ? " (close every running omo/senpi process first: Windows locks loaded native modules, so npm fails with EBUSY mid-upgrade and leaves exactly this partial state)"
      : ""
    throw new Error(
      `senpi engine files are incomplete: ${brandPath} is missing, which usually means an interrupted or failed omo-ai upgrade; reinstall with: ${updateTarget().command}${windowsHint}`,
    )
  }
  return { cliPath, packageRoot: dirname(dirname(indexPath)) }
}

export function nearestNodeBin(startPath) {
  // Hoisted layouts place the engine package inside a shared node_modules (…/node_modules/senpi),
  // whose .bin is a sibling, not a child - starting the climb inside node_modules would walk to the
  // filesystem root and never find it. Begin at the package's parent so that sibling .bin is seen.
  let current = basename(startPath) === "node_modules" ? dirname(startPath)
    : basename(dirname(startPath)) === "node_modules" ? dirname(dirname(startPath))
    : startPath
  const root = parse(current).root
  while (true) {
    const candidate = join(current, "node_modules", ".bin")
    if (existsSync(candidate)) return candidate
    if (current === root) return undefined
    current = dirname(current)
  }
}
