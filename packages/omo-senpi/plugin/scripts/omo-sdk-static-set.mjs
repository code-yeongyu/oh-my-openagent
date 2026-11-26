// What ships and runs at import in the SDK root runtime (design lane ruling of record, P1b #14950): the inputs of the
// built runtime file that keep bytes in its output, reached from the entry by static edges only, plus the node builtins
// a kept module imports. A module the bundler drops costs nothing at import and is not in the set. The metafile is the
// one of the repository's own build of that file (build-extension-core.mjs buildOmoSdkRuntime), never a separate build.
// The list is the same in every install layout: a module is named by its real file, a workspace package's file as
// `packages/<dir>/...` whether the build reached it through `node_modules/<name>` or `packages/<dir>`, a third-party
// file as `node_modules/<package>/...` with bun's store directory (`.bun/<name>@<version>/`) dropped so a lockfile bump
// does not move the list, and a node builtin as `node:<name>`. `bun omo-sdk-static-set.mjs --write` rewrites the list.
import { existsSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, isAbsolute, join, relative, resolve as resolvePath, sep } from "node:path"
import { fileURLToPath } from "node:url"

import { buildOmoSdkRuntime, omoSenpiBuildDefines } from "./build-extension-core.mjs"

const scriptsDir = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolvePath(scriptsDir, "../../../..")
export const STATIC_SET_PATH = join(scriptsDir, "omo-sdk-static-modules.json")
const omoSdkEntryPath = join(REPO_ROOT, "packages", "omo-senpi", "src", "extension", "omo-sdk.ts")

function workspacePackages(repoRoot = REPO_ROOT) {
  const names = new Map()
  for (const dir of readdirSync(join(repoRoot, "packages"))) {
    const manifest = join(repoRoot, "packages", dir, "package.json")
    if (!existsSync(manifest)) continue
    const { name } = JSON.parse(readFileSync(manifest, "utf8"))
    if (typeof name === "string") names.set(name, `packages/${dir}`)
  }
  return names
}

const posix = (path) => path.split(sep).join("/")
// A file, not a directory (a specifier `./schema` names both `schema.ts` and `schema/index.ts`).
const readdirSafe = (path) => {
  try {
    readFileSync(path)
    return true
  } catch {
    return false
  }
}

export function normalizeModulePath(
  path,
  { repoRoot = REPO_ROOT, workspaces = workspacePackages(repoRoot), base = process.cwd() } = {},
) {
  const absolute = isAbsolute(path) ? path : resolvePath(base, path)
  let real = absolute
  try {
    real = realpathSync(absolute)
  } catch {}
  const file = posix(real)
  const store = file.lastIndexOf("/node_modules/")
  if (store !== -1) {
    const tail = file.slice(store + "/node_modules/".length)
    const parts = tail.split("/")
    const name = parts[0].startsWith("@") ? `${parts[0]}/${parts[1]}` : parts[0]
    const rest = parts.slice(name.split("/").length).join("/")
    const workspace = workspaces.get(name)
    return workspace === undefined ? `node_modules/${tail}` : `${workspace}/${rest}`
  }
  const inRepo = posix(relative(repoRoot, real))
  if (!inRepo.startsWith("../")) return inRepo
  const packages = file.indexOf("/packages/")
  return packages === -1 ? file : file.slice(packages + 1)
}

const SCHEMA_LIBRARIES = ["zod", "typebox", "@sinclair/typebox"]

export async function staticModuleSet(entry = omoSdkEntryPath, options = {}) {
  const { version } = JSON.parse(readFileSync(join(REPO_ROOT, "packages", "omo-senpi", "package.json"), "utf8"))
  const dir = mkdtempSync(join(tmpdir(), "omo-sdk-static-set-"))
  let metafile
  try {
    const metafilePath = join(dir, "meta.json")
    await buildOmoSdkRuntime(join(dir, "sdk.js"), omoSenpiBuildDefines(version), { entry, keepMetafile: metafilePath })
    metafile = JSON.parse(readFileSync(metafilePath, "utf8"))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
  // The build runs with the repository root as its working directory, so the metafile's paths are relative to it.
  const resolve = (path) => resolvePath(REPO_ROOT, path)
  const inputs = metafile.inputs
  const [output] = Object.values(metafile.outputs)
  const kept = (key) => (output.inputs[key]?.bytesInOutput ?? 0) > 0
  // An edge may name its target in another form than the target's own key (absolute against cwd-relative), so edges
  // are matched by resolved path.
  const byResolved = new Map(Object.keys(inputs).map((key) => [posix(resolve(key)), key]))
  const target = (edgePath) => byResolved.get(posix(resolve(edgePath)))
  // A side-effect-free re-export barrel (`export * from "./x"`) the bundler elides has no input of its own, yet an edge
  // still names it; the walk goes through it to the modules it re-exports, as the bundler's resolution does.
  const throughBarrel = (file, seen = new Set()) => {
    if (seen.has(file) || !existsSync(file)) return []
    seen.add(file)
    const source = readFileSync(file, "utf8")
    return [...source.matchAll(/^\s*(?:import|export)\b[^;]*?\bfrom\s+["'](\.[^"']+)["']/gm)].flatMap(
      ([, specifier]) => {
        const base = resolvePath(dirname(file), specifier)
        const candidate = [
          base,
          `${base}.ts`,
          `${base}.tsx`,
          `${base}.js`,
          `${base}.mjs`,
          join(base, "index.ts"),
          join(base, "index.js"),
        ].find((path) => existsSync(path) && !path.endsWith("/") && readdirSafe(path))
        if (candidate === undefined) return []
        const key = byResolved.get(posix(candidate))
        return key !== undefined ? [key] : throughBarrel(candidate, seen)
      },
    )
  }
  const entryKey = Object.keys(inputs).find((key) => posix(resolve(key)) === posix(resolve(entry)))
  const first = entryKey ?? Object.keys(inputs).find((key) => entry.endsWith(key.replace(/^(\.\.\/)+/, "")))
  const reached = new Set([first])
  const builtins = new Set()
  const queue = [first]
  while (queue.length > 0)
    for (const edge of inputs[queue.shift()]?.imports ?? []) {
      if (edge.kind === "dynamic-import") continue
      const key = target(edge.path)
      if (key === undefined && edge.external === true) {
        builtins.add(edge.path.startsWith("node:") ? edge.path : `node:${edge.path}`)
        continue
      }
      for (const next of key === undefined ? throughBarrel(resolve(edge.path)) : [key]) {
        if (reached.has(next)) continue
        reached.add(next)
        queue.push(next)
      }
    }
  const shipped = [...reached].filter(kept)
  const keptBuiltins = new Set(
    shipped.flatMap((key) =>
      inputs[key].imports
        .filter((edge) => edge.kind !== "dynamic-import" && target(edge.path) === undefined && edge.external === true)
        .map((edge) => (edge.path.startsWith("node:") ? edge.path : `node:${edge.path}`)),
    ),
  )
  const workspaces = workspacePackages(options.repoRoot)
  const name = (key) => normalizeModulePath(key, { base: REPO_ROOT, ...options, workspaces })
  const set = [...new Set([...shipped.map(name), ...[...builtins].filter((b) => keptBuiltins.has(b))])].sort()
  const isSchemaLibrary = (named) => SCHEMA_LIBRARIES.some((library) => named.startsWith(`node_modules/${library}/`))
  const schemaUsers = shipped.filter(
    (key) =>
      !isSchemaLibrary(name(key)) &&
      inputs[key].imports.some((edge) => {
        const target = name(edge.path)
        return SCHEMA_LIBRARIES.some((library) => target.startsWith(`node_modules/${library}/`))
      }),
  ).length
  return { set, reached: [...reached].map(name), schemaUsers, dropped: reached.size - shipped.length }
}

export const STATIC_SET_DEFINITION =
  "modules of runtime/omo-sdk/sdk.js that keep bytes in its output and are reached from the entry by static edges only, plus the node builtins a kept module imports; named by real path, layout-independent"

export const difference = (actual, pinned) => ({
  added: actual.filter((path) => !pinned.includes(path)),
  removed: pinned.filter((path) => !actual.includes(path)),
})

if (import.meta.main && process.argv.includes("--write")) {
  const { set } = await staticModuleSet()
  writeFileSync(STATIC_SET_PATH, `${JSON.stringify({ definition: STATIC_SET_DEFINITION, modules: set }, null, 2)}\n`)
  console.log(`${set.length} modules -> ${relative(REPO_ROOT, STATIC_SET_PATH)}`)
}
