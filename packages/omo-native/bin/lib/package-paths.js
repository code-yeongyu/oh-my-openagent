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
