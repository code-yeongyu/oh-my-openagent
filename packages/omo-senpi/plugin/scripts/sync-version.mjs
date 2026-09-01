#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const scriptDir = dirname(fileURLToPath(import.meta.url))
const pluginRoot = dirname(scriptDir)
const packageRoot = dirname(pluginRoot)
const adapterManifestPath = join(packageRoot, "package.json")
const pluginManifestPath = join(pluginRoot, "package.json")

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"))
}

async function writeJson(path, value) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`)
}

export async function syncVersion(options = {}) {
  const adapterManifest = await readJson(options.adapterManifestPath ?? adapterManifestPath)
  const pluginManifest = await readJson(options.pluginManifestPath ?? pluginManifestPath)
  const version = adapterManifest.version
  if (typeof version !== "string" || version.length === 0) {
    throw new Error("Cannot sync omo-senpi plugin version: adapter package.json has no version")
  }

  const changed = pluginManifest.version !== version
  if (changed && options.check === true) {
    return { ok: false, version, current: pluginManifest.version }
  }
  if (changed) {
    pluginManifest.version = version
    await writeJson(options.pluginManifestPath ?? pluginManifestPath, pluginManifest)
  }
  return { ok: true, version, changed }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await syncVersion({ check: process.argv.includes("--check") })
  if (!result.ok) {
    console.error(`omo-senpi plugin/package.json version mismatch: expected ${result.version}, found ${result.current}`)
    process.exit(1)
  }
  console.log(`omo-senpi plugin/package.json version ${result.version}${result.changed ? " synced" : " current"}`)
}
