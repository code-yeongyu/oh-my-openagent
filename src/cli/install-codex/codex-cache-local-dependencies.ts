import { readFile, readdir, writeFile } from "node:fs/promises"
import { dirname, isAbsolute, join, relative, resolve } from "node:path"
import { isPathInside } from "./codex-cache-paths"

export async function rewriteCachedPackageLocalFileDependencies(pluginRoot: string, sourceRoot: string): Promise<void> {
  const packageJsonPaths: string[] = []
  await collectPackageJsonPaths(pluginRoot, pluginRoot, packageJsonPaths)
  for (const packageJsonPath of packageJsonPaths) {
    const raw = await readFile(packageJsonPath, "utf8")
    const parsed: unknown = JSON.parse(raw)
    if (!isRecord(parsed)) continue
    const packageDir = dirname(packageJsonPath)
    const sourcePackageDir = join(sourceRoot, relative(pluginRoot, packageDir))
    let changed = false
    for (const field of ["dependencies", "optionalDependencies", "peerDependencies"] as const) {
      const dependencies = parsed[field]
      if (!isRecord(dependencies)) continue
      for (const [name, specifier] of Object.entries(dependencies)) {
        if (typeof specifier !== "string" || !specifier.startsWith("file:")) continue
        const filePath = specifier.slice("file:".length)
        if (filePath.length === 0 || isAbsolute(filePath)) continue
        const targetPath = resolve(packageDir, filePath)
        if (isPathInside(targetPath, pluginRoot)) continue
        dependencies[name] = `file:${resolve(sourcePackageDir, filePath)}`
        changed = true
      }
    }
    if (changed) await writeFile(packageJsonPath, `${JSON.stringify(parsed, null, "\t")}\n`)
  }
}

async function collectPackageJsonPaths(directory: string, root: string, paths: string[]): Promise<void> {
  const entries = await readdir(directory, { withFileTypes: true })
  if (entries.some((entry) => entry.isFile() && entry.name === "package.json")) {
    paths.push(join(directory, "package.json"))
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    if (entry.name === "node_modules" || entry.name === ".git" || entry.name === "dist") continue
    const childPath = join(directory, entry.name)
    if (!isPathInside(childPath, root)) continue
    await collectPackageJsonPaths(childPath, root, paths)
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
