#!/usr/bin/env node
// Bundles the omowright library (root devDependency) into the `browser` skill as one
// self-contained ESM file plus the page bundle it reads at import time, so both editions ship the
// attached/owned browser engines without a nested node_modules tree. Mirrors the runtime-staging
// contract of packages/omo-senpi/plugin/scripts/stage-ast-grep-mcp-runtime.mjs (manifest, sha256,
// `--check` freshness gate).
import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { access, copyFile, mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const scriptDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(scriptDir, "..", "..")
const defaultSourceRoot = process.env.OMO_OMOWRIGHT_SOURCE ?? join(repoRoot, "node_modules", "omowright")
const defaultTargetDir = process.env.OMO_OMOWRIGHT_TARGET ?? join(scriptDir, "skills", "browser", "runtime", "omowright")

export const STAGED_FILES = Object.freeze(["index.js", "page-bundle.js"])

async function sha256(path) {
  return createHash("sha256").update(await readFile(path)).digest("hex")
}

async function readSourceVersion(sourceRoot) {
  const manifest = JSON.parse(await readFile(join(sourceRoot, "package.json"), "utf8"))
  if (typeof manifest.version !== "string" || manifest.name !== "omowright") {
    throw new Error(`omowright source is not the omowright package: ${sourceRoot}`)
  }
  return manifest.version
}

async function sourceDigest(sourceRoot) {
  const entries = ["package.json", "src/index.js", "src/page-bundle.js", "src/core.js"]
  const hash = createHash("sha256")
  for (const entry of entries) hash.update(entry).update("\0").update(await readFile(join(sourceRoot, entry)))
  return hash.digest("hex")
}

function bundle({ sourceRoot, outFile, bunExecutable }) {
  const result = spawnSync(
    bunExecutable,
    ["build", join(sourceRoot, "src", "index.js"), "--target=node", "--format=esm", "--minify-whitespace", `--outfile=${outFile}`],
    { cwd: sourceRoot, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  )
  if (result.status !== 0) {
    throw new Error(`bun build failed for omowright: ${result.stderr || result.stdout}`)
  }
}

export async function stageOmowrightRuntime(options = {}) {
  const sourceRoot = resolve(options.sourceRoot ?? defaultSourceRoot)
  const targetDir = resolve(options.targetDir ?? defaultTargetDir)
  const bunExecutable = options.bunExecutable ?? process.env.BUN ?? "bun"
  const version = await readSourceVersion(sourceRoot)
  const digest = await sourceDigest(sourceRoot)

  await mkdir(dirname(targetDir), { recursive: true })
  const tempParent = await mkdtemp(join(dirname(targetDir), ".tmp-omowright-runtime-"))
  const tempDir = join(tempParent, "omowright")
  const backupDir = `${targetDir}.backup-${process.pid}-${Date.now()}`
  let backupCreated = false
  let targetMoved = false
  try {
    await mkdir(tempDir, { recursive: true })
    bundle({ sourceRoot, outFile: join(tempDir, "index.js"), bunExecutable })
    await copyFile(join(sourceRoot, "src", "page-bundle.js"), join(tempDir, "page-bundle.js"))
    const files = {}
    for (const name of STAGED_FILES) files[name] = await sha256(join(tempDir, name))
    await writeFile(
      join(tempDir, "manifest.json"),
      `${JSON.stringify({ version, sourceDigest: digest, files, stagedAtUtc: new Date().toISOString() }, null, 2)}\n`,
      "utf8",
    )
    try { await access(targetDir); await rename(targetDir, backupDir); backupCreated = true } catch (error) { if (error.code !== "ENOENT") throw error }
    await rename(tempDir, targetDir)
    targetMoved = true
    if (backupCreated) await rm(backupDir, { recursive: true, force: true })
    return { ok: true, sourceRoot, targetDir, version, sourceDigest: digest, files }
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

export async function checkOmowrightRuntimeFresh(options = {}) {
  const sourceRoot = resolve(options.sourceRoot ?? defaultSourceRoot)
  const targetDir = resolve(options.targetDir ?? defaultTargetDir)
  const digest = await sourceDigest(sourceRoot)
  let manifest
  try {
    manifest = JSON.parse(await readFile(join(targetDir, "manifest.json"), "utf8"))
  } catch (error) {
    if (error.code === "ENOENT") throw new Error(`omowright runtime stale: manifest is missing: ${join(targetDir, "manifest.json")}`)
    throw new Error(`omowright runtime stale: manifest is unreadable: ${error.message}`)
  }
  if (manifest.sourceDigest !== digest) {
    throw new Error(`omowright runtime stale: staged sourceDigest ${manifest.sourceDigest} does not match ${digest}`)
  }
  for (const name of STAGED_FILES) {
    let actual
    try { actual = await sha256(join(targetDir, name)) } catch (error) {
      if (error.code === "ENOENT") throw new Error(`omowright runtime stale: ${name} is missing from ${targetDir}`)
      throw error
    }
    if (manifest.files?.[name] !== actual) {
      throw new Error(`omowright runtime stale: ${name} sha256 ${actual} does not match manifest ${manifest.files?.[name]}`)
    }
  }
  return { ok: true, sourceRoot, targetDir, version: manifest.version, sourceDigest: digest }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv.includes("--check")) {
      const result = await checkOmowrightRuntimeFresh()
      console.log(`omowright runtime is current: ${result.targetDir} (omowright ${result.version})`)
    } else {
      const result = await stageOmowrightRuntime()
      console.log(`Staged omowright ${result.version} into ${result.targetDir}`)
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  }
}
