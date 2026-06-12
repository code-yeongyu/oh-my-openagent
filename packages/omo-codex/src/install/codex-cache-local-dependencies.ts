import { isPlainRecord } from "./codex-cache-fs"
import { realpathSync } from "node:fs"
import { readFile, readdir, writeFile } from "node:fs/promises"
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path"
import { isPathInside } from "./codex-cache-paths"

export async function rewriteCachedPackageLocalFileDependencies(pluginRoot: string, sourceRoot: string): Promise<void> {
  const packageJsonPaths: string[] = []
  await collectPackageJsonPaths(pluginRoot, pluginRoot, packageJsonPaths)
  const packageLock = await readPackageLock(pluginRoot)
  for (const packageJsonPath of packageJsonPaths) {
    const raw = await readFile(packageJsonPath, "utf8")
    const parsed: unknown = JSON.parse(raw)
    if (!isPlainRecord(parsed)) continue
    const packageDir = dirname(packageJsonPath)
    const sourcePackageDir = join(sourceRoot, relative(pluginRoot, packageDir))
    let changed = false
    for (const field of ["dependencies", "optionalDependencies", "peerDependencies"] as const) {
      const dependencies = parsed[field]
      if (!isPlainRecord(dependencies)) continue
      for (const [name, specifier] of Object.entries(dependencies)) {
        if (typeof specifier !== "string" || !specifier.startsWith("file:")) continue
        const filePath = specifier.slice("file:".length)
        if (filePath.length === 0 || isAbsolute(filePath)) continue
        const targetPath = resolve(packageDir, filePath)
        if (isPathInside(targetPath, pluginRoot)) continue
        const sourceTargetPath = resolve(sourcePackageDir, filePath)
        dependencies[name] = `file:${sourceTargetPath}`
        rewritePackageLockFileDependency({
          dependencyName: name,
          field,
          packageDir,
          packageLock,
          pluginRoot,
          sourceTargetPath,
          targetPath,
        })
        changed = true
      }
    }
    if (changed) await writeFile(packageJsonPath, `${JSON.stringify(parsed, null, "\t")}\n`)
  }
  if (packageLock.changed) await writeFile(packageLock.path, `${JSON.stringify(packageLock.value, null, "\t")}\n`)
}

type PackageLockState = {
  readonly path: string
  readonly value: Record<string, unknown> | null
  changed: boolean
}

async function readPackageLock(pluginRoot: string): Promise<PackageLockState> {
  const path = join(pluginRoot, "package-lock.json")
  try {
    const parsed: unknown = JSON.parse(await readFile(path, "utf8"))
    return { path, value: isPlainRecord(parsed) ? parsed : null, changed: false }
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return { path, value: null, changed: false }
    }
    throw error
  }
}

function rewritePackageLockFileDependency(input: {
  readonly dependencyName: string
  readonly field: "dependencies" | "optionalDependencies" | "peerDependencies"
  readonly packageDir: string
  readonly packageLock: PackageLockState
  readonly pluginRoot: string
  readonly sourceTargetPath: string
  readonly targetPath: string
}): void {
  const packages = getPackageLockPackages(input.packageLock.value)
  if (!packages) return

  const lockRoot = canonicalizeExistingPath(input.pluginRoot)
  const packageKey = toPackageLockPath(relative(input.pluginRoot, input.packageDir))
  const oldTargetKey = toPackageLockPath(relative(input.pluginRoot, input.targetPath))
  const newTargetKey = toPackageLockPath(relative(lockRoot, input.sourceTargetPath))
  const newSpecifier = `file:${input.sourceTargetPath}`

  const packageEntry = packages[packageKey]
  if (isPlainRecord(packageEntry)) {
    const dependencyRecord = packageEntry[input.field]
    if (isPlainRecord(dependencyRecord) && dependencyRecord[input.dependencyName] !== newSpecifier) {
      dependencyRecord[input.dependencyName] = newSpecifier
      input.packageLock.changed = true
    }
  }

  if (oldTargetKey !== newTargetKey && isPlainRecord(packages[oldTargetKey])) {
    packages[newTargetKey] = packages[oldTargetKey]
    delete packages[oldTargetKey]
    input.packageLock.changed = true
  }

  const nodeModulesKey = `node_modules/${input.dependencyName}`
  const nodeModulesEntry = packages[nodeModulesKey]
  if (isPlainRecord(nodeModulesEntry) && nodeModulesEntry.resolved !== newTargetKey) {
    nodeModulesEntry.resolved = newTargetKey
    input.packageLock.changed = true
  }
}

function getPackageLockPackages(packageLock: Record<string, unknown> | null): Record<string, unknown> | null {
  if (!packageLock) return null
  const packages = packageLock.packages
  return isPlainRecord(packages) ? packages : null
}

function toPackageLockPath(path: string): string {
  return path.split(sep).join("/")
}

function canonicalizeExistingPath(path: string): string {
  try {
    return realpathSync(path)
  } catch (error) {
    if (error instanceof Error) return path
    throw error
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
