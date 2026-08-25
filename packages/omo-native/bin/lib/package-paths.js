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

export function resolveSenpi() {
  let indexPath
  try {
    indexPath = fileURLToPath(import.meta.resolve("@code-yeongyu/senpi"))
  } catch (error) {
    throw new Error(`could not resolve @code-yeongyu/senpi; reinstall with: ${updateTarget().command} (${error.message})`)
  }

  const cliPath = join(dirname(indexPath), "cli.js")
  if (!existsSync(cliPath)) {
    throw new Error(`senpi CLI is missing at ${cliPath}; reinstall with: ${updateTarget().command}`)
  }
  return { cliPath, packageRoot: dirname(dirname(indexPath)) }
}

export function nearestNodeBin(startPath, options = {}) {
  // Hoisted layouts place the engine package inside a shared node_modules (…/node_modules/senpi),
  // whose .bin is a sibling, not a child - starting the climb inside node_modules would walk to the
  // filesystem root and never find it. Begin at the package's parent so that sibling .bin is seen.
  let current = basename(startPath) === "node_modules" ? dirname(startPath)
    : basename(dirname(startPath)) === "node_modules" ? dirname(dirname(startPath))
    : startPath
  const root = parse(current).root
  const platform = options.platform ?? process.platform
  const fileExists = options.fileExists ?? existsSync
  while (true) {
    const candidate = join(current, "node_modules", ".bin")
    // #6847: scoped npm installs materialize a node_modules/.bin inside the scoped package even
    // when it holds no shims, and that empty bin would shadow the ancestor bin carrying the
    // executable. Only a bin that can actually serve name lookups may be returned.
    if (fileExists(candidate) && (!options.executable || hasBinShim(candidate, options.executable, platform, fileExists))) return candidate
    if (current === root) return undefined
    current = dirname(current)
  }
}

function hasBinShim(binDir, executable, platform, fileExists) {
  const shim = join(binDir, platform === "win32" ? `${executable}.cmd` : executable)
  return fileExists(shim)
}
