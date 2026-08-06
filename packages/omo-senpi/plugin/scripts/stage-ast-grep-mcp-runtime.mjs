#!/usr/bin/env node
import { createHash } from "node:crypto"
import { constants, existsSync } from "node:fs"
import { access, chmod, copyFile, mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const scriptDir = dirname(fileURLToPath(import.meta.url))
const pluginRoot = dirname(scriptDir)
const packageRoot = dirname(pluginRoot)
const repoRoot = resolve(packageRoot, "..", "..")
const defaultSourceEntry = join(repoRoot, "packages", "ast-grep-mcp", "dist", "cli.js")
const defaultTargetEntry = join(pluginRoot, "runtime", "ast-grep-mcp", "cli.js")

export async function stageAstGrepMcpRuntime(options = {}) {
  const sourceEntry = resolve(options.sourceEntry ?? defaultSourceEntry)
  const targetEntry = resolve(options.targetEntry ?? defaultTargetEntry)
  await validateEntry(sourceEntry, "built")

  const targetDir = dirname(targetEntry)
  await mkdir(dirname(targetDir), { recursive: true })
  const tempParent = await mkdtemp(join(dirname(targetDir), ".tmp-omo-senpi-ast-grep-runtime-"))
  const tempDir = join(tempParent, "ast-grep-mcp")
  const tempEntry = join(tempDir, "cli.js")
  const tempManifest = join(tempDir, "manifest.json")
  const backupDir = `${targetDir}.backup-${process.pid}-${Date.now()}`
  let backupCreated = false
  let targetMoved = false

  try {
    await mkdir(tempDir, { recursive: true })
    await copyFile(sourceEntry, tempEntry)
    await chmod(tempEntry, 0o755)
    await validateEntry(tempEntry, "staged")
    const stagedStat = await stat(tempEntry)
    const stagedSha256 = await sha256(tempEntry)
    await writeFile(
      tempManifest,
      `${JSON.stringify({
        sha256: stagedSha256,
        mode: stagedStat.mode & 0o777,
        stagedAtUtc: new Date().toISOString(),
      }, null, 2)}\n`,
      "utf8",
    )

    if (existsSync(targetDir)) {
      await rename(targetDir, backupDir)
      backupCreated = true
    }
    await rename(tempDir, targetDir)
    targetMoved = true
    if (backupCreated) await rm(backupDir, { recursive: true, force: true })
    return {
      ok: true,
      sourceEntry,
      targetEntry,
      manifestPath: join(targetDir, "manifest.json"),
      sha256: stagedSha256,
    }
  } catch (error) {
    if (!targetMoved && backupCreated) {
      await rm(targetDir, { recursive: true, force: true })
      await rename(backupDir, targetDir)
    }
    throw error
  } finally {
    await rm(tempParent, { recursive: true, force: true })
  }
}

export async function checkAstGrepMcpRuntimeFresh(options = {}) {
  const sourceEntry = resolve(options.sourceEntry ?? defaultSourceEntry)
  const targetEntry = resolve(options.targetEntry ?? defaultTargetEntry)
  const manifestPath = resolve(options.manifestPath ?? join(dirname(targetEntry), "manifest.json"))
  const platform = options.platform ?? process.platform
  await validateEntry(sourceEntry, "built")

  let targetStat
  try {
    targetStat = await stat(targetEntry)
  } catch (error) {
    if (isErrno(error, "ENOENT")) {
      throw new Error(`ast-grep-mcp runtime stale: staged CLI is missing: ${targetEntry}`)
    }
    throw error
  }
  if (!targetStat.isFile()) {
    throw new Error(`ast-grep-mcp runtime stale: staged CLI is not a file: ${targetEntry}`)
  }
  try {
    await access(targetEntry, constants.X_OK)
  } catch (error) {
    if (isErrno(error, "EACCES")) {
      throw new Error(`ast-grep-mcp runtime stale: staged CLI is not executable: ${targetEntry}`)
    }
    throw error
  }

  const [sourceSha256, stagedSha256] = await Promise.all([sha256(sourceEntry), sha256(targetEntry)])
  if (sourceSha256 !== stagedSha256) {
    throw new Error(
      `ast-grep-mcp runtime stale: staged sha256 ${stagedSha256} does not match built sha256 ${sourceSha256}`,
    )
  }

  const manifest = await readManifest(manifestPath)
  const stagedMode = targetStat.mode & 0o777
  if (manifest.sha256 !== stagedSha256) {
    throw new Error(
      `ast-grep-mcp runtime stale: manifest sha256 ${manifest.sha256} does not match staged sha256 ${stagedSha256}`,
    )
  }
  if (platform !== "win32" && manifest.mode !== stagedMode) {
    throw new Error(`ast-grep-mcp runtime stale: manifest mode ${manifest.mode} does not match staged mode ${stagedMode}`)
  }
  return { ok: true, sourceEntry, targetEntry, manifestPath, sha256: sourceSha256, mode: stagedMode }
}

async function readManifest(manifestPath) {
  let raw
  try {
    raw = await readFile(manifestPath, "utf8")
  } catch (error) {
    if (isErrno(error, "ENOENT")) throw new Error(`ast-grep-mcp runtime stale: manifest is missing: ${manifestPath}`)
    throw error
  }

  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error(`ast-grep-mcp runtime stale: manifest is invalid JSON: ${manifestPath}`)
  }
  if (
    parsed === null ||
    typeof parsed !== "object" ||
    !/^[a-f0-9]{64}$/.test(parsed.sha256) ||
    !Number.isInteger(parsed.mode) ||
    typeof parsed.stagedAtUtc !== "string" ||
    Number.isNaN(Date.parse(parsed.stagedAtUtc))
  ) {
    throw new Error(`ast-grep-mcp runtime stale: manifest is malformed: ${manifestPath}`)
  }
  return parsed
}

async function validateEntry(entry, kind) {
  let entryStat
  try {
    entryStat = await stat(entry)
  } catch (error) {
    if (isErrno(error, "ENOENT")) throw new Error(`Senpi ast-grep MCP ${kind} CLI is missing: ${entry}`)
    throw error
  }
  if (!entryStat.isFile()) throw new Error(`Senpi ast-grep MCP ${kind} CLI is not a file: ${entry}`)
  await access(entry, constants.X_OK)
}

async function sha256(path) {
  return createHash("sha256").update(await readFile(path)).digest("hex")
}

async function fileExists(path) {
  try {
    await access(path)
    return true
  } catch (error) {
    if (isErrno(error, "ENOENT")) return false
    throw error
  }
}

function isErrno(error, code) {
  return error instanceof Error && "code" in error && error.code === code
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv.includes("--check")) {
      // Fresh-checkout-safe: if ast-grep-mcp was never built locally (its dist is a gitignored
      // build output), there is nothing to verify — CI covers the full build in its dedicated job.
      if (!(await fileExists(defaultSourceEntry))) {
        console.log(`runtime dist not built locally; skipping freshness check: ${defaultSourceEntry}`)
      } else {
        const result = await checkAstGrepMcpRuntimeFresh()
        console.log(`Senpi ast-grep-mcp runtime is current: ${result.targetEntry} sha256=${result.sha256}`)
      }
    } else {
      const result = await stageAstGrepMcpRuntime()
      console.log(`Staged Senpi ast-grep MCP runtime: ${result.targetEntry}`)
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  }
}
