import { existsSync, readFileSync, realpathSync } from "node:fs"
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { canonicalAgentDir, runtimeHome } from "./agent-dir.js"
import { parseJsonc } from "./jsonc.js"
import { packageRoot } from "./package-paths.js"

/**
 * omo ships no dori code. `omo dori` and the `omo doctor` dori rows import a separately
 * installed package's host entry by name from omo's own install, lazily: only for `omo dori`, or
 * for doctor when the user config has a `dori` section. Without one, doctor output is unchanged.
 */

export const DORI_PACKAGE = "dori-extension"
export const DORI_HOST_ENTRY = `${DORI_PACKAGE}/host`
export const DORI_HOST_CONTRACT_VERSION = 1
export const DORI_NOT_INSTALLED = `${DORI_PACKAGE} is not installed: install the ${DORI_PACKAGE} package where omo is installed (for a global omo, \`bun add -g <package>\`), then run \`omo doctor\``

// Where the dori finds omo's plugin payload and the thread SDK in it. The SDK file ships with the thread
// SDK itself; the URL is handed over either way and nothing here checks that the file exists.
const PLUGIN_ROOT = join(packageRoot, "plugin")
const PLUGIN_PATHS = {
  pluginRoot: PLUGIN_ROOT,
  threadSdkUrl: pathToFileURL(join(PLUGIN_ROOT, "runtime", "thread-sdk", "sdk.js")).href,
}

const DORI_KEY = "dori"
const NATIVE_BLOCK_KEYS = ["[native]", "[senpi]"]

export async function loadDoriHost(importHost) {
  let load = importHost
  if (load === undefined) {
    const verified = verifyDoriPackage()
    if (verified.status !== "verified") return verified
    load = () => import(verified.entryUrl)
  }
  let host
  try {
    host = await load()
  } catch (error) {
    if (isMissingPackage(error)) return { status: "missing" }
    return { status: "broken", reason: `cannot load ${DORI_HOST_ENTRY}: ${error instanceof Error ? error.message : String(error)}` }
  }
  if (host?.HOST_CONTRACT_VERSION !== DORI_HOST_CONTRACT_VERSION) {
    return {
      status: "broken",
      reason: `the installed ${DORI_PACKAGE} speaks host contract ${String(host?.HOST_CONTRACT_VERSION)}, this omo speaks ${DORI_HOST_CONTRACT_VERSION}: ${contractRemedy(host?.HOST_CONTRACT_VERSION)}`,
    }
  }
  return { status: "installed", host }
}

// Whichever side is older is the one to upgrade; an unreadable version names both.
function contractRemedy(found) {
  const older = typeof found !== "number" ? `${DORI_PACKAGE} or omo` : found > DORI_HOST_CONTRACT_VERSION ? "omo" : DORI_PACKAGE
  return `upgrade ${older} so both speak the same host contract`
}

// The node_modules directories above omo's own install, nearest first. Node's global folders
// (~/.node_modules, NODE_PATH) are left out: ESM resolution from omo never reaches them.
function doriSearchPaths() {
  const paths = []
  for (let dir = dirname(fileURLToPath(import.meta.url)); ; dir = dirname(dir)) {
    if (basename(dir) !== "node_modules") paths.push(join(dir, "node_modules"))
    if (dirname(dir) === dir) return paths
  }
}

// The `./host` target of the package's own manifest: a string, or the `import`/`default` condition.
function hostExportTarget(manifest) {
  let target = isRecord(manifest.exports) ? manifest.exports["./host"] : undefined
  while (isRecord(target)) target = target.import ?? target.default
  return typeof target === "string" ? target : undefined
}

/**
 * Before anything of the package runs: the nearest installed package above omo's own install must
 * be the one this omo expects, declare the host contract in its manifest, and export a host entry
 * that stays inside its own directory once symlinks are resolved on both sides. The entry comes
 * from that same directory's manifest, so the checked package and the loaded file are one copy.
 */
export function verifyDoriPackage() {
  const root = doriSearchPaths().map((path) => join(path, DORI_PACKAGE)).find((dir) => existsSync(dir))
  if (root === undefined) return { status: "missing" }
  const refuse = (why) => ({ status: "broken", reason: `refusing the installed dori at ${root}: ${why}` })
  let manifest
  try {
    manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"))
  } catch (error) {
    return refuse(`cannot read its package.json: ${error instanceof Error ? error.message : String(error)}`)
  }
  if (!isRecord(manifest)) return refuse("its package.json is not an object")
  if (manifest.name !== DORI_PACKAGE) return refuse(`its package.json names ${JSON.stringify(manifest.name)}, not "${DORI_PACKAGE}"`)
  const declared = isRecord(manifest.doriExtension) ? manifest.doriExtension.hostContract : undefined
  if (declared === undefined) return refuse("its package.json does not declare doriExtension.hostContract")
  if (declared !== DORI_HOST_CONTRACT_VERSION) {
    return refuse(`its package.json declares host contract ${JSON.stringify(declared)}, this omo speaks ${DORI_HOST_CONTRACT_VERSION}: ${contractRemedy(declared)}`)
  }
  const target = hostExportTarget(manifest)
  if (target === undefined) return refuse('its package.json does not export "./host"')
  let entry
  let realRoot
  try {
    entry = realpathSync.native(resolve(root, target))
    realRoot = realpathSync.native(root)
  } catch (error) {
    return { status: "broken", reason: `cannot load ${DORI_HOST_ENTRY}: ${error instanceof Error ? error.message : String(error)}` }
  }
  const inside = relative(realRoot, entry)
  if (inside === "" || inside === ".." || inside.startsWith(`..${sep}`) || isAbsolute(inside)) return refuse(`its host entry resolves to ${entry}, outside the package`)
  return { status: "verified", entryUrl: pathToFileURL(entry).href }
}

// A missing module inside an installed package is broken, not missing.
function isMissingPackage(error) {
  if (!(error instanceof Error)) return false
  const code = "code" in error ? error.code : undefined
  if (code !== "ERR_MODULE_NOT_FOUND" && code !== "MODULE_NOT_FOUND") return false
  if (!error.message.includes(`'${DORI_PACKAGE}`) && !error.message.includes(`"${DORI_PACKAGE}`)) return false
  // Bun also names the package when its exported host file is absent. Check the
  // package directory without resolving an entry that exports may hide or break.
  return !doriSearchPaths().some((path) => existsSync(join(path, DORI_PACKAGE)))
}

/** `omo dori <args>`: the installed package runs it; without the package, one stderr line and exit 1. */
export async function runDoriCommand(args, options = {}) {
  const { stdout = process.stdout, stderr = process.stderr, env = process.env, cwd = process.cwd() } = options
  const loaded = await loadDoriHost(options.importHost)
  if (loaded.status === "missing") {
    stderr.write(`omo dori: ${DORI_NOT_INSTALLED}\n`)
    return 1
  }
  if (loaded.status === "broken") {
    stderr.write(`omo dori: ${loaded.reason}\n`)
    return 1
  }
  return loaded.host.runGatewayCommand(args, {
    stdout,
    stderr,
    env,
    cwd,
    agentDir: canonicalAgentDir(env),
    home: runtimeHome(env),
    ...PLUGIN_PATHS,
    launch: options.launch ?? [process.execPath, process.argv[1], "dori", "connect"],
  })
}

function userConfigPath(env) {
  const dir = join(runtimeHome(env), ".omo")
  const jsonc = join(dir, "omo.jsonc")
  if (existsSync(jsonc)) return jsonc
  const json = join(dir, "omo.json")
  return existsSync(json) ? json : null
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

export function hasDoriSection(env = process.env) {
  const path = userConfigPath(env)
  if (path === null) return false
  let document
  try {
    document = parseJsonc(readFileSync(path, "utf8"))
  } catch {
    return false
  }
  if (!isRecord(document)) return false
  if (Object.hasOwn(document, DORI_KEY)) return true
  return NATIVE_BLOCK_KEYS.some((key) => isRecord(document[key]) && Object.hasOwn(document[key], DORI_KEY))
}

/** No `dori` section: no rows. Otherwise one installed/not-installed row; an installed package adds its own rows. */
export async function doriDoctorLines(options = {}) {
  const { env = process.env, cwd = process.cwd() } = options
  if (!hasDoriSection(env)) return []
  const loaded = await loadDoriHost(options.importHost)
  if (loaded.status === "missing") return [`WARN dori: ${DORI_NOT_INSTALLED}`]
  if (loaded.status === "broken") return [`FAIL dori: ${loaded.reason}`]
  try {
    return ["PASS dori: installed", ...(await loaded.host.gatewayDoctorLines({ env, cwd, ...PLUGIN_PATHS }))]
  } catch (error) {
    return ["PASS dori: installed", `WARN dori: the dori's doctor rows failed: ${error instanceof Error ? error.message : String(error)}`]
  }
}
