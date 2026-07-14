#!/usr/bin/env node
import { createHash } from "node:crypto"
import { existsSync } from "node:fs"
import { access, cp, mkdir, mkdtemp, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises"
import { dirname, join, relative, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const scriptDir = dirname(fileURLToPath(import.meta.url))
const pluginRoot = dirname(scriptDir)
const packageRoot = dirname(pluginRoot)
const repoRoot = resolve(packageRoot, "..", "..")
const defaultSourceDist = join(repoRoot, "packages", "lsp-daemon", "dist")
const defaultTargetDist = join(pluginRoot, "runtime", "lsp-daemon", "dist")

const REQUIRED_OUTPUTS = [
  "cli.js",
  "index.js",
  "index.d.ts",
  "client.js",
  "client.d.ts",
  "daemon-client.js",
  "daemon-client.d.ts",
  "package.json",
]

const INPUT_CANDIDATES = [
  "packages/lsp-daemon/package.json",
  "packages/lsp-daemon/tsconfig.build.json",
  "packages/lsp-daemon/src",
  "packages/lsp-core/package.json",
  "packages/lsp-core/src",
  "packages/mcp-stdio-core/package.json",
  "packages/mcp-stdio-core/src",
]

const manifestName = ".omo-runtime-manifest.json"

export async function stageLspDaemonRuntime(options = {}) {
  const sourceDist = resolve(options.sourceDist ?? defaultSourceDist)
  const targetDist = resolve(options.targetDist ?? defaultTargetDist)
  const root = resolve(options.repoRoot ?? repoRoot)
  await validateRequiredOutputs(sourceDist)
  const inputDigest = await computeInputDigest(root, options.inputCandidates ?? INPUT_CANDIDATES)
  await mkdir(dirname(targetDist), { recursive: true })
  const tempParent = await mkdtemp(join(dirname(targetDist), ".tmp-omo-senpi-lsp-runtime-"))
  const tempDist = join(tempParent, "dist")
  const backupDist = `${targetDist}.backup-${process.pid}-${Date.now()}`
  let backupCreated = false
  let targetMoved = false

  try {
    await cp(sourceDist, tempDist, { recursive: true, force: true, verbatimSymlinks: true })
    await validateRequiredOutputs(tempDist)
    await writeManifest(tempDist, inputDigest)
    await verifyRuntimeDist(tempDist)
    if (existsSync(targetDist)) {
      await rename(targetDist, backupDist)
      backupCreated = true
    }
    if (process.env.OMO_SENPI_STAGE_FAIL_AFTER_BACKUP === "1") {
      throw new Error("Injected Senpi runtime staging failure after backup")
    }
    await rename(tempDist, targetDist)
    targetMoved = true
    if (backupCreated) await rm(backupDist, { recursive: true, force: true })
    return { ok: true, targetDist, manifestPath: join(targetDist, manifestName) }
  } catch (error) {
    if (!targetMoved && backupCreated) {
      await rm(targetDist, { recursive: true, force: true })
      await rename(backupDist, targetDist)
    }
    throw error
  } finally {
    await rm(tempParent, { recursive: true, force: true })
  }
}

export async function verifyRuntimeDist(distDir) {
  const dist = resolve(distDir)
  await validateRequiredOutputs(dist)
  const manifest = await readRuntimeManifest(dist)
  const outputs = await hashOutputs(dist)
  const actual = JSON.stringify(outputs)
  const expected = JSON.stringify(manifest.outputs)
  if (actual !== expected) {
    throw new Error(`Senpi LSP runtime manifest output hash mismatch at ${join(dist, manifestName)}`)
  }
  return { ok: true, version: manifest.version, inputDigest: manifest.inputDigest, outputs }
}

export async function checkRuntimeDistFresh(options = {}) {
  const root = resolve(options.repoRoot ?? repoRoot)
  const targetDist = resolve(options.targetDist ?? defaultTargetDist)
  const manifest = await readRuntimeManifest(targetDist)
  const expectedInputDigest = await computeInputDigest(root, options.inputCandidates ?? INPUT_CANDIDATES)
  if (manifest.inputDigest !== expectedInputDigest) {
    throw new Error(`Senpi LSP runtime manifest is stale at ${join(targetDist, manifestName)}`)
  }
  return verifyRuntimeDist(targetDist)
}

async function writeManifest(distDir, inputDigest) {
  const packageJson = await readJsonObject(join(distDir, "package.json"))
  const version = stringField(packageJson, "version", join(distDir, "package.json"))
  const manifest = {
    schemaVersion: 1,
    version,
    inputDigest,
    outputs: await hashOutputs(distDir),
  }
  const manifestPath = join(distDir, manifestName)
  const tempPath = `${manifestPath}.${process.pid}.${Date.now()}.tmp`
  await writeFile(tempPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8")
  await rename(tempPath, manifestPath)
}

async function readRuntimeManifest(distDir) {
  const manifestPath = join(distDir, manifestName)
  const manifest = await readJsonObject(manifestPath)
  const schemaVersion = manifest.schemaVersion
  const version = manifest.version
  const inputDigest = manifest.inputDigest
  const outputs = manifest.outputs
  if (schemaVersion !== 1) throw new Error(`Senpi LSP runtime manifest schemaVersion must be 1: ${manifestPath}`)
  if (typeof version !== "string" || version.length === 0) throw new Error(`Senpi LSP runtime manifest version is invalid: ${manifestPath}`)
  if (typeof inputDigest !== "string" || !/^sha256:[0-9a-f]{64}$/.test(inputDigest)) {
    throw new Error(`Senpi LSP runtime manifest inputDigest is invalid: ${manifestPath}`)
  }
  if (!Array.isArray(outputs)) throw new Error(`Senpi LSP runtime manifest outputs must be an array: ${manifestPath}`)
  for (const output of outputs) {
    if (!isRecord(output) || typeof output.path !== "string" || typeof output.sha256 !== "string") {
      throw new Error(`Senpi LSP runtime manifest output entry is invalid: ${manifestPath}`)
    }
    if (!/^[0-9a-f]{64}$/.test(output.sha256)) {
      throw new Error(`Senpi LSP runtime manifest output hash is invalid: ${manifestPath}`)
    }
  }
  const sorted = [...outputs].sort((left, right) => left.path.localeCompare(right.path))
  if (JSON.stringify(sorted) !== JSON.stringify(outputs)) {
    throw new Error(`Senpi LSP runtime manifest outputs must be sorted: ${manifestPath}`)
  }
  return { schemaVersion, version, inputDigest, outputs }
}

async function computeInputDigest(root, candidates) {
  const files = []
  for (const candidate of candidates) {
    const path = join(root, candidate)
    if (await fileExists(path)) files.push(...await listFiles(path))
  }
  files.sort((left, right) => relative(root, left).localeCompare(relative(root, right)))
  const hash = createHash("sha256")
  for (const file of files) {
    hash.update(toPortablePath(relative(root, file)))
    hash.update("\0")
    hash.update(await sha256(file))
    hash.update("\0")
  }
  return `sha256:${hash.digest("hex")}`
}

async function hashOutputs(distDir) {
  const files = (await listFiles(distDir))
    .filter((file) => relative(distDir, file) !== manifestName)
    .sort((left, right) => relative(distDir, left).localeCompare(relative(distDir, right)))
  const outputs = []
  for (const file of files) {
    outputs.push({ path: toPortablePath(relative(distDir, file)), sha256: await sha256(file) })
  }
  return outputs
}

async function validateRequiredOutputs(distDir) {
  for (const output of REQUIRED_OUTPUTS) {
    const path = join(distDir, output)
    let stats
    try {
      stats = await stat(path)
    } catch (error) {
      if (isErrno(error, "ENOENT")) throw new Error(`Senpi LSP runtime is missing ${output} at ${distDir}`)
      throw error
    }
    if (!stats.isFile()) throw new Error(`Senpi LSP runtime output is not a file: ${path}`)
  }
}

async function listFiles(path) {
  const stats = await stat(path)
  if (stats.isFile()) return [path]
  if (!stats.isDirectory()) return []
  const entries = await readdir(path, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const entryPath = join(path, entry.name)
    if (entry.isDirectory()) files.push(...await listFiles(entryPath))
    else if (entry.isFile()) files.push(entryPath)
  }
  return files
}

async function readJsonObject(path) {
  const parsed = JSON.parse(await readFile(path, "utf8"))
  if (!isRecord(parsed)) throw new Error(`${path} must contain a JSON object`)
  return parsed
}

function stringField(record, field, path) {
  const value = record[field]
  if (typeof value !== "string" || value.length === 0) throw new Error(`${path} must contain string field ${field}`)
  return value
}

async function sha256(path) {
  return createHash("sha256").update(await readFile(path)).digest("hex")
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value)
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

function toPortablePath(path) {
  return path.replaceAll("\\", "/")
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv.includes("--check")) {
      await checkRuntimeDistFresh()
      console.log(`Senpi LSP runtime is current: ${defaultTargetDist}`)
    } else {
      const result = await stageLspDaemonRuntime()
      console.log(`Staged Senpi LSP runtime: ${result.targetDist}`)
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  }
}
