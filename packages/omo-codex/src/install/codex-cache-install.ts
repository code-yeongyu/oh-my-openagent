import { cp, mkdir, readFile, rename, rm } from "node:fs/promises"
import { basename, dirname, join, sep } from "node:path"
import { copyBundledMcpRuntimeDists } from "./codex-cache-bundled-mcps"
import { fileExistsStrict, isPlainRecord } from "./codex-cache-fs"
import { rewriteCachedPackageLocalFileDependencies } from "./codex-cache-local-dependencies"
import { rewriteCachedManifestRoot, rewriteCachedMcpManifest } from "./codex-cache-mcp-manifest"
import type { InstalledPlugin, RunCommand } from "./types"

type RenameDirectory = (fromPath: string, toPath: string) => Promise<void>

export async function installCachedPlugin(input: {
  readonly buildSource?: boolean
  readonly codexHome: string
  readonly marketplaceName: string
  readonly name: string
  readonly renameDirectory?: RenameDirectory
  readonly sourcePath: string
  readonly version: string
  readonly runCommand: RunCommand
}): Promise<InstalledPlugin> {
  if (input.buildSource !== false) {
    await maybeRunNpmInstall(input.sourcePath, input.runCommand)
    await maybeRunNpmBuild(input.sourcePath, input.runCommand)
  }

  const targetPath = join(input.codexHome, "plugins", "cache", input.marketplaceName, input.name, input.version)
  const tempPath = createTempSiblingPath(targetPath)
  await rm(tempPath, { recursive: true, force: true })
  try {
    await copyDirectory(input.sourcePath, tempPath)
    await rewriteCachedPackageLocalFileDependencies(tempPath, input.sourcePath)
    await copyBundledMcpRuntimeDists({ pluginRoot: tempPath, sourceRoot: input.sourcePath })
    await maybeRunNpmInstall(tempPath, input.runCommand, ["ci", "--omit=dev"])
    await rewriteCachedMcpManifest(tempPath, input.sourcePath)
    await rewriteCachedManifestRoot(tempPath, tempPath, targetPath)
    await promoteDirectory(tempPath, targetPath, input.renameDirectory ?? rename)
  } catch (error) {
    await rm(tempPath, { recursive: true, force: true })
    throw error
  }
  return { name: input.name, version: input.version, path: targetPath }
}

async function maybeRunNpmInstall(cwd: string, runCommand: RunCommand, args: readonly string[] = ["install"]): Promise<void> {
  if (!(await fileExistsStrict(join(cwd, "package.json")))) return
  await runCommand("npm", args, { cwd })
}

async function maybeRunNpmBuild(cwd: string, runCommand: RunCommand): Promise<void> {
  if (!(await fileExistsStrict(join(cwd, "package.json")))) return
  const packageJson: unknown = JSON.parse(await readFile(join(cwd, "package.json"), "utf8"))
  if (!isPlainRecord(packageJson)) return
  const scripts = packageJson.scripts
  if (!isPlainRecord(scripts) || typeof scripts.build !== "string") return
  await runCommand("npm", ["run", "build"], { cwd })
}

function createTempSiblingPath(targetPath: string): string {
  return join(dirname(targetPath), `.tmp-${basename(targetPath)}-${process.pid}-${Date.now()}`)
}

function createBackupSiblingPath(targetPath: string): string {
  return join(dirname(targetPath), `.backup-${basename(targetPath)}-${process.pid}-${Date.now()}`)
}

async function copyDirectory(sourcePath: string, targetPath: string): Promise<void> {
  await mkdir(dirname(targetPath), { recursive: true })
  await cp(sourcePath, targetPath, { recursive: true, filter: (source) => shouldCopyPluginPath(source, sourcePath) })
}

async function promoteDirectory(tempPath: string, targetPath: string, renameDirectory: RenameDirectory): Promise<void> {
  const backupPath = createBackupSiblingPath(targetPath)
  await rm(backupPath, { recursive: true, force: true })
  let backupMoved = false
  try {
    if (await fileExistsStrict(targetPath)) {
      await renameDirectory(targetPath, backupPath)
      backupMoved = true
    }
    await renameDirectory(tempPath, targetPath)
  } catch (error) {
    if (backupMoved) await restoreBackupDirectory(backupPath, targetPath, renameDirectory)
    throw error
  }
  if (backupMoved) await rm(backupPath, { recursive: true, force: true })
}

async function restoreBackupDirectory(backupPath: string, targetPath: string, renameDirectory: RenameDirectory): Promise<void> {
  if (!(await fileExistsStrict(backupPath))) return
  await rm(targetPath, { recursive: true, force: true })
  await renameDirectory(backupPath, targetPath)
}

function shouldCopyPluginPath(path: string, root: string): boolean {
  const relative = path === root ? "" : path.slice(root.length + sep.length)
  if (relative === "") return true
  const parts = relative.split(sep)
  return !parts.some((part) => part === ".git" || part === "node_modules")
}
