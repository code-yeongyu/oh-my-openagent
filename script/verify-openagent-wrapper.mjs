#!/usr/bin/env node
// oh-my-openagent publishes from packages/oh-my-openagent-wrapper with --ignore-scripts. This is the last check that it
// stays a thin forwarder over the oh-my-opencode payload: one exact payload pin at its own version, no lifecycle
// scripts (the payload's postinstall must run once, not twice), the payload's bins and plugin subpaths, and nothing
// packed beyond what those name.

import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { pathToFileURL } from "node:url"

import { npmSpawnOptions } from "./npm-invocation.mjs"
import { parseNpmPackPaths } from "./npm-pack-paths.mjs"

export const WRAPPER_DIR = "packages/oh-my-openagent-wrapper"
const PAYLOAD_NAME = "oh-my-opencode"
// The subpaths OpenCode, doctor and schema users resolve on the package named in the config.
const WRAPPER_EXPORTS = [".", "./server", "./tui", "./schema.json", "./package.json"]
// npm packs these whatever `files` says.
const ALWAYS_PACKED = new Set(["package.json", "README.md", "LICENSE.md", "LICENSE"])

const relative = (target) => target.replace(/^\.\//, "")

function exportTargets(entry) {
  if (typeof entry === "string") return [entry]
  return Object.values(entry ?? {}).filter((target) => typeof target === "string")
}

/** Every reason the wrapper manifest and its packed paths are not a thin forwarder over the payload manifest. */
export function wrapperShapeRefusals(wrapper, packedPaths, payload) {
  const refusals = []
  if (wrapper.name !== "oh-my-openagent") refusals.push(`name is ${wrapper.name}, expected oh-my-openagent`)
  const dependencies = Object.entries(wrapper.dependencies ?? {})
  if (dependencies.length !== 1 || dependencies[0][0] !== PAYLOAD_NAME || dependencies[0][1] !== wrapper.version) {
    refusals.push(`dependencies must be exactly { "${PAYLOAD_NAME}": "${wrapper.version}" }`)
  }
  for (const field of ["scripts", "optionalDependencies", "peerDependencies", "bundleDependencies"]) {
    if (Object.keys(wrapper[field] ?? {}).length > 0) refusals.push(`${field} must be empty`)
  }

  const packed = new Set(packedPaths)
  const referenced = new Set()
  const requirePacked = (owner, target) => {
    const path = relative(target)
    referenced.add(path)
    if (!packed.has(path)) refusals.push(`${owner} points at ${path}, which is not packed`)
  }

  const expectedBins = Object.keys(payload.bin ?? {}).sort()
  const bins = Object.keys(wrapper.bin ?? {}).sort()
  if (bins.join() !== expectedBins.join()) refusals.push(`bins are [${bins}], expected the payload's [${expectedBins}]`)
  for (const [name, target] of Object.entries(wrapper.bin ?? {})) requirePacked(`bin ${name}`, target)

  const exportKeys = Object.keys(wrapper.exports ?? {}).sort()
  if (exportKeys.join() !== [...WRAPPER_EXPORTS].sort().join()) {
    refusals.push(`exports are [${exportKeys}], expected [${WRAPPER_EXPORTS}]`)
  }
  for (const [key, entry] of Object.entries(wrapper.exports ?? {})) {
    for (const target of exportTargets(entry)) requirePacked(`export ${key}`, target)
  }

  for (const path of packedPaths) {
    if (!referenced.has(path) && !ALWAYS_PACKED.has(path)) refusals.push(`${path} is packed but nothing names it`)
  }
  return refusals
}

function packedPaths() {
  const raw = execFileSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts", `./${WRAPPER_DIR}`], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
    ...npmSpawnOptions(),
  })
  return parseNpmPackPaths(raw)
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const wrapper = JSON.parse(readFileSync(`${WRAPPER_DIR}/package.json`, "utf8"))
  const payload = JSON.parse(readFileSync("package.json", "utf8"))
  const refusals = wrapperShapeRefusals(wrapper, packedPaths(), payload)
  if (wrapper.version !== payload.version)
    refusals.push(`version ${wrapper.version} differs from the payload's ${payload.version}`)
  if (refusals.length > 0) {
    console.error(`oh-my-openagent wrapper is not a thin forwarder (${refusals.length}):`)
    for (const refusal of refusals) console.error(`  ${refusal}`)
    process.exit(1)
  }
  console.log(`oh-my-openagent wrapper OK (${wrapper.version}, pins ${PAYLOAD_NAME}@${wrapper.version})`)
}
