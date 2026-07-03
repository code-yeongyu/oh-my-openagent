#!/usr/bin/env node
import { readFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const PACKAGE_DIR = dirname(dirname(fileURLToPath(import.meta.url)))
const VENDOR_MANIFESTS = ["coding-agent", "agent", "ai", "tui"].map((name) =>
  join(PACKAGE_DIR, "vendor", name, "package.json"),
)
const TOOLCHAIN_PATH = join(PACKAGE_DIR, "vendor", "TOOLCHAIN.json")
const PACKAGE_JSON_PATH = join(PACKAGE_DIR, "package.json")
const INTERNAL_DEPENDENCY_PREFIX = "@earendil-works/pi-"
export const MIRROR_EXTRAS = {
  dependencies: {
    "typescript-language-server": "5.3.0",
    typescript: "6.0.3",
  },
}

function sortedRecord(record) {
  return Object.fromEntries(Object.entries(record).toSorted(([left], [right]) => left.localeCompare(right)))
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"))
}

function mergeDependencyBlock(target, source, { excludeInternal = false, devAllowlist = false } = {}) {
  for (const [name, version] of Object.entries(source ?? {})) {
    if (excludeInternal && name.startsWith(INTERNAL_DEPENDENCY_PREFIX)) continue
    if (devAllowlist && !(name.startsWith("@types/") || name === "typescript")) continue
    target[name] = version
  }
}

export async function generateDependencyMirror() {
  const manifests = await Promise.all(VENDOR_MANIFESTS.map((path) => readJson(path)))
  const toolchain = await readJson(TOOLCHAIN_PATH)
  const dependencies = {}
  const optionalDependencies = {}
  const devDependencies = {}

  for (const manifest of manifests) {
    mergeDependencyBlock(dependencies, manifest.dependencies, { excludeInternal: true })
    mergeDependencyBlock(optionalDependencies, manifest.optionalDependencies)
    mergeDependencyBlock(devDependencies, manifest.devDependencies, { devAllowlist: true })
  }
  mergeDependencyBlock(devDependencies, toolchain.devDependencies)
  mergeDependencyBlock(dependencies, MIRROR_EXTRAS.dependencies)

  return {
    dependencies: sortedRecord(dependencies),
    optionalDependencies: sortedRecord(optionalDependencies),
    devDependencies: sortedRecord(devDependencies),
  }
}

function stableJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`
}

function diffKeys(expected, actual, blockName) {
  const expectedKeys = Object.keys(expected)
  const actualKeys = Object.keys(actual ?? {})
  const missing = expectedKeys.filter((key) => !(key in (actual ?? {})))
  const extra = actualKeys.filter((key) => !(key in expected))
  const changed = expectedKeys.filter((key) => key in (actual ?? {}) && expected[key] !== actual[key])
  return [
    ...missing.map((key) => `${blockName}.${key} missing expected ${expected[key]}`),
    ...extra.map((key) => `${blockName}.${key} unexpected ${actual[key]}`),
    ...changed.map((key) => `${blockName}.${key} expected ${expected[key]} got ${actual[key]}`),
  ]
}

export async function checkDependencyMirror() {
  const expected = await generateDependencyMirror()
  const manifest = await readJson(PACKAGE_JSON_PATH)
  const failures = [
    ...diffKeys(expected.dependencies, manifest.dependencies, "dependencies"),
    ...diffKeys(expected.optionalDependencies, manifest.optionalDependencies, "optionalDependencies"),
    ...diffKeys(expected.devDependencies, manifest.devDependencies, "devDependencies"),
  ]
  if (failures.length > 0) {
    throw new Error(`Dependency mirror drift:\n${failures.join("\n")}`)
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const mode = process.argv[2] ?? "--json"
  if (mode === "--check") {
    checkDependencyMirror()
      .then(() => {
        console.log("DEPS-IN-SYNC")
      })
      .catch((error) => {
        console.error(error instanceof Error ? error.message : String(error))
        process.exitCode = 1
      })
  } else if (mode === "--json") {
    console.log(stableJson(await generateDependencyMirror()))
  } else {
    console.error(`Unknown option: ${mode}`)
    process.exitCode = 1
  }
}
