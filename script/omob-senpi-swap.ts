// script/omob-senpi-swap.ts
// Places the source-built senpi engine into the omo cache clone as the ONE copy every importer resolves.
//
// bun's isolated linker gives each workspace its own link into node_modules/.bun, so replacing only the root
// node_modules/@code-yeongyu/senpi left packages/omo-native (the trust stage), omo-senpi and senpi-task on the
// registry copy. The binary then bundled two engines with two module-scoped adopted-trust records: omo recorded
// the adopted generation in one, senpi's `host ensure` read the other, so the supervisor and its host child were
// spawned without the trust hand-off, re-ran the trust exec, and that exec closed the startup pipe - every
// coordinated host start timed out in supervisor_bootstrap.

import { cpSync, existsSync, lstatSync, mkdirSync, readdirSync, realpathSync, rmSync, symlinkSync } from "node:fs"
import { dirname, join, sep } from "node:path"

const SENPI_SCOPE = "@code-yeongyu"
const SENPI_NAME = "senpi"

function senpiLinkUnder(nodeModules: string): string {
  return join(nodeModules, SENPI_SCOPE, SENPI_NAME)
}

function childDirectories(directory: string): string[] {
  if (!existsSync(directory)) return []
  return readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(directory, entry.name))
}

/** Every place a module in the clone can resolve `@code-yeongyu/senpi` from: the root, each workspace, the bun store. */
export function senpiResolutionPaths(omoDir: string): string[] {
  const root = join(omoDir, "node_modules")
  const store = join(root, ".bun")
  const candidates = [
    senpiLinkUnder(root),
    senpiLinkUnder(join(store, "node_modules")),
    ...childDirectories(store).map((entry) => senpiLinkUnder(join(entry, "node_modules"))),
    ...childDirectories(join(omoDir, "packages")).map((workspace) => senpiLinkUnder(join(workspace, "node_modules"))),
  ]
  return candidates.filter((candidate) => {
    try {
      lstatSync(candidate)
      return true
    } catch {
      return false
    }
  })
}

function resolvedOrUndefined(path: string): string | undefined {
  try {
    return realpathSync(path)
  } catch {
    return undefined
  }
}

function nearestExistingRealpath(path: string): string {
  for (let current = path; ; current = dirname(current)) {
    const resolved = resolvedOrUndefined(current)
    if (resolved !== undefined || dirname(current) === current) return resolved ?? current
  }
}

/**
 * Copies the built engine to the root resolution and turns every other directory a resolution points at into a
 * link to it, so the bundler (which follows links to real paths) sees one module per engine file. Returns the root.
 */
export function placeBuiltSenpi(omoDir: string, builtSenpiRoot: string): string {
  const target = senpiLinkUnder(join(omoDir, "node_modules"))
  const others = new Set<string>()
  for (const path of senpiResolutionPaths(omoDir)) {
    if (path === target) continue
    const resolved = resolvedOrUndefined(path)
    if (resolved !== undefined) others.add(resolved)
  }
  const clone = realpathSync(omoDir) + sep
  const outside = [...others].filter((directory) => !directory.startsWith(clone))
  const rootHome = nearestExistingRealpath(dirname(target)) + sep
  if (!rootHome.startsWith(clone)) outside.push(target)
  if (outside.length > 0)
    throw new Error(`senpi resolves outside the clone ${omoDir}; refusing to replace: ${outside.join(", ")}`)
  rmSync(target, { recursive: true, force: true })
  mkdirSync(dirname(target), { recursive: true })
  cpSync(builtSenpiRoot, target, { recursive: true })
  const canonical = realpathSync(target)
  for (const directory of others) {
    if (directory === canonical) continue
    rmSync(directory, { recursive: true, force: true })
    mkdirSync(dirname(directory), { recursive: true })
    symlinkSync(canonical, directory, process.platform === "win32" ? "junction" : "dir")
  }
  const split = senpiResolutionPaths(omoDir).filter((path) => resolvedOrUndefined(path) !== canonical)
  if (split.length > 0) throw new Error(`senpi still resolves outside ${canonical} from: ${split.join(", ")}`)
  return target
}
