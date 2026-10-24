// Preloaded into every process of the bundle recipe by bundle-inputs.mjs (node --import, bun --preload).
// Appends one JSON line per path the process reads, lists or loads to OMO_BUNDLE_INPUTS_TRACE, and
// every input the bundler reports: a spawned `bun build` gets a --metafile when it has none, and
// Bun.build runs with metafile: true. Nothing here changes what the recipe builds.
import fs from "node:fs"
import childProcess from "node:child_process"
import module from "node:module"
import { basename, dirname, isAbsolute, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const log = process.env.OMO_BUNDLE_INPUTS_TRACE
const scratch = process.env.OMO_BUNDLE_INPUTS_TMP
const appendLine = fs.appendFileSync.bind(fs)
const readText = fs.readFileSync.bind(fs)
const exists = fs.existsSync.bind(fs)
const isDirectory = (value) => {
  try { return fs.statSync(toPath(value)).isDirectory() } catch { return false }
}

const toPath = (value) => {
  if (value instanceof URL) return fileURLToPath(value)
  if (typeof value === "string") return value
  if (Buffer.isBuffer(value)) return value.toString()
  return undefined
}

const record = (kind, value, cwd = process.cwd()) => {
  const path = toPath(value)
  if (log === undefined || path === undefined) return
  appendLine(log, `${JSON.stringify({ kind, path: isAbsolute(path) ? path : resolve(cwd, path) })}\n`)
}

const wrap = (target, name, kind) => {
  const original = target[name]
  if (typeof original !== "function") return
  target[name] = function traced(path, ...rest) {
    record(typeof kind === "function" ? kind(path) : kind, path)
    return original.call(this, path, ...rest)
  }
}

// A recursive cp copies whatever the source directory holds, so its source is a listed directory, not a file.
const copyKind = (path) => (isDirectory(path) ? "list" : "read")
for (const name of ["readFile", "readFileSync", "createReadStream", "copyFile", "copyFileSync"]) wrap(fs, name, "read")
for (const name of ["cp", "cpSync"]) wrap(fs, name, copyKind)
for (const name of ["readdir", "readdirSync", "opendir", "opendirSync"]) wrap(fs, name, "list")
for (const name of ["readFile", "copyFile"]) wrap(fs.promises, name, "read")
wrap(fs.promises, "cp", copyKind)
for (const name of ["readdir", "opendir"]) wrap(fs.promises, name, "list")

let metafiles = 0
const isBunBuild = (command, args) => /^bun(?:\.exe)?$/.test(basename(String(command))) && Array.isArray(args) && args[0] === "build"
const recordMetafile = (metafile, cwd) => {
  const path = isAbsolute(metafile) ? metafile : resolve(cwd, metafile)
  if (!exists(path)) return record("missing-metafile", path)
  for (const input of Object.keys(JSON.parse(readText(path, "utf8")).inputs ?? {})) record("bundle", input, cwd)
}
const spawnSync = childProcess.spawnSync
childProcess.spawnSync = function tracedSpawnSync(command, args, options) {
  if (!isBunBuild(command, args)) return spawnSync.call(this, command, args, options)
  const given = args.find((arg) => typeof arg === "string" && arg.startsWith("--metafile="))
  const metafile = given?.slice("--metafile=".length) ?? join(scratch ?? process.cwd(), `meta-${process.pid}-${metafiles++}.json`)
  // A shell spawn (build-install uses shell: true on win32) joins argv unquoted, so a scratch path with spaces would split.
  const added = options?.shell ? `--metafile="${metafile}"` : `--metafile=${metafile}`
  const result = spawnSync.call(this, command, given === undefined ? [...args, added] : args, options)
  if (result.status === 0) recordMetafile(metafile, options?.cwd ?? process.cwd())
  return result
}
module.syncBuiltinESMExports()

const entry = process.argv[1] !== undefined && exists(process.argv[1]) ? fs.realpathSync(process.argv[1]) : undefined
if (entry !== undefined) record("module", entry)
if (typeof module.registerHooks === "function") {
  module.registerHooks({
    load(url, context, next) {
      if (url.startsWith("file:")) record("module", new URL(url))
      return next(url, context)
    },
  })
} else if (typeof Bun !== "undefined" && typeof Bun.plugin === "function") {
  // Bun has no load hooks, and a named node:fs import there escapes the wraps above, so a module the
  // step's entry pulls in could read files this trace never sees. The entry's own imports are recorded
  // (the recipe names them); any deeper import fails the trace (mapFromTrace) instead of under-reporting.
  const real = (path) => { try { return fs.realpathSync(path) } catch { return path } }
  // A file entry imports as itself; a `bun -e` entry imports as a path that is no file (`<dir>/[eval]` or a directory).
  const isFile = (path) => { try { return fs.statSync(path).isFile() } catch { return false } }
  const isEntry = (importer) => !isFile(importer) || real(importer) === entry
  const resolveFrom = (path, importer) => {
    if (path.startsWith("file:")) return new URL(path)
    const from = isFile(importer) || importer.endsWith("[eval]") ? dirname(importer) : importer
    try { return Bun.resolveSync(path, from) } catch { return undefined }
  }
  let resolving = false // Bun.resolveSync runs this plugin again
  Bun.plugin({
    name: "omo-bundle-inputs-trace",
    setup(build) {
      build.onResolve({ filter: /.*/ }, ({ path, importer }) => {
        if (resolving || importer === undefined || importer === "" || importer.startsWith("bun:") || module.isBuiltin(path)) return undefined
        if (!isEntry(importer)) {
          record("missing-module-hooks", `${importer} -> ${path}`)
          return undefined
        }
        resolving = true
        try {
          const resolved = resolveFrom(path, importer)
          if (resolved === undefined) record("missing-module-hooks", `${importer} -> ${path} (unresolved)`)
          else record("module", resolved)
        } finally {
          resolving = false
        }
        return undefined
      })
    },
  })
} else {
  record("missing-module-hooks", `no module hooks in this runtime (${process.execPath})`)
}

if (typeof Bun !== "undefined") {
  const build = Bun.build
  Bun.build = async (config) => {
    const result = await build({ ...config, metafile: true })
    if (result.metafile?.inputs === undefined) record("missing-metafile", "Bun.build")
    else for (const input of Object.keys(result.metafile.inputs)) record("bundle", input)
    return result
  }
}
