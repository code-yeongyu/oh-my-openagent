import { existsSync, readFileSync, realpathSync } from "node:fs"
import { createRequire } from "node:module"
import { isAbsolute, join, relative, sep } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { canonicalAgentDir, runtimeHome } from "./agent-dir.js"
import { parseJsonc } from "./jsonc.js"
import { packageRoot } from "./package-paths.js"

/**
 * omo ships no gateway code. `omo gateway` and the `omo doctor` gateway rows import a separately
 * installed package's host entry by name from omo's own install, lazily: only for `omo gateway`, or
 * for doctor when the user config has a `gateway` section. Without one, doctor output is unchanged.
 */

export const GATEWAY_PACKAGE = "@oh-my-opencode/omo-gateway"
export const GATEWAY_HOST_ENTRY = `${GATEWAY_PACKAGE}/host`
export const GATEWAY_HOST_CONTRACT_VERSION = 1
export const GATEWAY_NOT_INSTALLED = `the omo gateway is not installed: install the ${GATEWAY_PACKAGE} package where omo is installed (for a global omo, \`bun add -g <package>\`), then run \`omo doctor\``

// Where the gateway finds omo's plugin payload and the thread SDK in it. The SDK file ships with the thread
// SDK itself; the URL is handed over either way and nothing here checks that the file exists.
const PLUGIN_ROOT = join(packageRoot, "plugin")
const PLUGIN_PATHS = {
  pluginRoot: PLUGIN_ROOT,
  threadSdkUrl: pathToFileURL(join(PLUGIN_ROOT, "runtime", "thread-sdk", "sdk.js")).href,
}

const GATEWAY_KEY = "gateway"
const NATIVE_BLOCK_KEYS = ["[native]", "[senpi]"]

export async function loadGatewayHost(importHost) {
  let load = importHost
  if (load === undefined) {
    const verified = verifyGatewayPackage()
    if (verified.status !== "verified") return verified
    load = () => import(verified.entryUrl)
  }
  let host
  try {
    host = await load()
  } catch (error) {
    if (isMissingPackage(error)) return { status: "missing" }
    return { status: "broken", reason: `cannot load ${GATEWAY_HOST_ENTRY}: ${error instanceof Error ? error.message : String(error)}` }
  }
  if (host?.HOST_CONTRACT_VERSION !== GATEWAY_HOST_CONTRACT_VERSION) {
    return {
      status: "broken",
      reason: `the installed gateway speaks host contract ${String(host?.HOST_CONTRACT_VERSION)}, this omo speaks ${GATEWAY_HOST_CONTRACT_VERSION}`,
    }
  }
  return { status: "installed", host }
}

function gatewaySearchPaths() {
  return createRequire(import.meta.url).resolve.paths(GATEWAY_PACKAGE) ?? []
}

/**
 * Before anything of the package runs: the nearest installed package on omo's own resolver search
 * paths must be the one this omo expects, declare the host contract in its manifest, and export a
 * host entry that stays inside its own directory once symlinks are resolved on both sides.
 */
export function verifyGatewayPackage(resolveHostEntry = (specifier) => import.meta.resolve(specifier)) {
  const root = gatewaySearchPaths().map((path) => join(path, GATEWAY_PACKAGE)).find((dir) => existsSync(dir))
  if (root === undefined) return { status: "missing" }
  const refuse = (why) => ({ status: "broken", reason: `refusing the installed gateway at ${root}: ${why}` })
  let manifest
  try {
    manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"))
  } catch (error) {
    return refuse(`cannot read its package.json: ${error instanceof Error ? error.message : String(error)}`)
  }
  if (!isRecord(manifest)) return refuse("its package.json is not an object")
  if (manifest.name !== GATEWAY_PACKAGE) return refuse(`its package.json names ${JSON.stringify(manifest.name)}, not "${GATEWAY_PACKAGE}"`)
  const declared = isRecord(manifest.omoGateway) ? manifest.omoGateway.hostContract : undefined
  if (declared === undefined) return refuse("its package.json does not declare omoGateway.hostContract")
  if (declared !== GATEWAY_HOST_CONTRACT_VERSION) {
    return refuse(`its package.json declares host contract ${JSON.stringify(declared)}, this omo speaks ${GATEWAY_HOST_CONTRACT_VERSION}`)
  }
  let entry
  let realRoot
  try {
    entry = realpathSync.native(fileURLToPath(resolveHostEntry(GATEWAY_HOST_ENTRY)))
    realRoot = realpathSync.native(root)
  } catch (error) {
    return { status: "broken", reason: `cannot load ${GATEWAY_HOST_ENTRY}: ${error instanceof Error ? error.message : String(error)}` }
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
  if (!error.message.includes(`'${GATEWAY_PACKAGE}`) && !error.message.includes(`"${GATEWAY_PACKAGE}`)) return false
  // Bun also names the package when its exported host file is absent. Check the
  // package directory without resolving an entry that exports may hide or break.
  return !gatewaySearchPaths().some((path) => existsSync(join(path, GATEWAY_PACKAGE)))
}

/** `omo gateway <args>`: the installed package runs it; without the package, one stderr line and exit 1. */
export async function runGatewayCommand(args, options = {}) {
  const { stdout = process.stdout, stderr = process.stderr, env = process.env, cwd = process.cwd() } = options
  const loaded = await loadGatewayHost(options.importHost)
  if (loaded.status === "missing") {
    stderr.write(`omo gateway: ${GATEWAY_NOT_INSTALLED}\n`)
    return 1
  }
  if (loaded.status === "broken") {
    stderr.write(`omo gateway: ${loaded.reason}\n`)
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
    launch: options.launch ?? [process.execPath, process.argv[1], "gateway", "connect"],
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

export function hasGatewaySection(env = process.env) {
  const path = userConfigPath(env)
  if (path === null) return false
  let document
  try {
    document = parseJsonc(readFileSync(path, "utf8"))
  } catch {
    return false
  }
  if (!isRecord(document)) return false
  if (Object.hasOwn(document, GATEWAY_KEY)) return true
  return NATIVE_BLOCK_KEYS.some((key) => isRecord(document[key]) && Object.hasOwn(document[key], GATEWAY_KEY))
}

/** No `gateway` section: no rows. Otherwise one installed/not-installed row; an installed package adds its own rows. */
export async function gatewayDoctorLines(options = {}) {
  const { env = process.env, cwd = process.cwd() } = options
  if (!hasGatewaySection(env)) return []
  const loaded = await loadGatewayHost(options.importHost)
  if (loaded.status === "missing") return [`WARN gateway: ${GATEWAY_NOT_INSTALLED}`]
  if (loaded.status === "broken") return [`FAIL gateway: ${loaded.reason}`]
  try {
    return ["PASS gateway: installed", ...(await loaded.host.gatewayDoctorLines({ env, cwd, ...PLUGIN_PATHS }))]
  } catch (error) {
    return ["PASS gateway: installed", `WARN gateway: the gateway's doctor rows failed: ${error instanceof Error ? error.message : String(error)}`]
  }
}
