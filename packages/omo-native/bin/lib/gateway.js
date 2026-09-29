import { existsSync } from "node:fs"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import { canonicalAgentDir, runtimeHome } from "./agent-dir.js"
import { packageRoot } from "./package-paths.js"

export const GATEWAY_SCHEMA_RUNTIME = join("plugin", "runtime", "gateway-schema", "index.js")

/**
 * The connector entry (`runConnectCommand`), imported lazily and only for `omo gateway connect` with
 * a configured section. It is TypeScript source in the monorepo, so it loads under bun from a source
 * checkout; an install without it reports that instead of failing obscurely.
 */
export const GATEWAY_CONNECTOR_SOURCE = join("..", "omo-gateway", "src", "connector", "cli.ts")

/**
 * `omo gateway` - the operator's handle on the chat-surface gateway. With no `gateway` key in the
 * user config (~/.omo/omo.jsonc or ~/.omo/omo.json) the feature is off: every subcommand prints
 * `not configured` and exits 0, and the gateway package never loads. The section is resolved and validated by
 * the staged gateway-schema runtime (omo-config-core's user-config lookup, JSONC parse and native
 * view), so this wrapper owns only the per-scope status rendering and the exit code the caller can
 * branch on. The connector host, admission and rules land in `@oh-my-opencode/omo-gateway` (loaded
 * lazily from here, never on the startup path).
 */

const SUBCOMMANDS = new Set(["status", "connect", "lead", "rules", "link", "service"])

const USAGE = [
  "usage: omo gateway <status|connect|lead|rules|link|service> [options]",
  "",
  "  status   report the configured scopes and their connectors",
  "  connect  run or attach the connector for a scope's surface",
  "  lead     claim or start a scope's lead session (not built yet)",
  "  rules    list, show, edit or sync conversation rules (not built yet)",
  "  link     link a chat account to an omo identity (not built yet)",
  "  service  install or remove the opt-in always-on unit (not built yet)",
  "",
  "  --json   print machine-readable output where the subcommand supports it",
  "",
  "  With no `gateway` section in ~/.omo/omo.jsonc (or ~/.omo/omo.json) every subcommand prints",
  "  `not configured` and exits 0. Project .omo layers and profiles cannot set it.",
].join("\n")

const GATEWAY_EXIT = { ok: 0, unreadable: 1, usage: 2 }

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function scopeSummaries(gateway) {
  const scopes = Array.isArray(gateway.scopes) ? gateway.scopes : []
  return scopes
    .filter((scope) => isPlainObject(scope) && typeof scope.id === "string" && scope.id !== "")
    .map((scope) => ({ id: scope.id, connectors: [] }))
}

function ignoredLines(resolution) {
  return resolution.ignored.map(
    (entry) => `${entry.path}: ${entry.placements.join(", ")} (gateway is read only from ~/.omo/omo.jsonc or ~/.omo/omo.json)`,
  )
}

/**
 * @param args argv after `omo gateway`
 * @param options.cwd / options.env where the user config and project layers are looked up
 * @param options.loadRuntime injected so tests never need the staged payload
 * @returns the process exit code the launcher should use
 */
export async function runGatewayCommand(args, options = {}) {
  const { stdout = process.stdout, stderr = process.stderr } = options
  const subcommand = args[0]

  if (subcommand === "--help" || subcommand === "-h") {
    stdout.write(`${USAGE}\n`)
    return GATEWAY_EXIT.ok
  }
  if (subcommand === undefined) {
    stderr.write(`${USAGE}\n`)
    return GATEWAY_EXIT.usage
  }
  if (!SUBCOMMANDS.has(subcommand)) {
    stderr.write(`omo gateway: unknown subcommand '${subcommand}'\n${USAGE}\n`)
    return GATEWAY_EXIT.usage
  }

  let resolution
  try {
    resolution = await resolveGateway(options)
  } catch (error) {
    stderr.write(`omo gateway: cannot resolve the gateway config: ${error instanceof Error ? error.message : String(error)}\n`)
    return GATEWAY_EXIT.unreadable
  }
  for (const line of ignoredLines(resolution)) stderr.write(`omo gateway: ignored ${line}\n`)
  const section = resolution.section
  if (!section.present) {
    stdout.write("not configured\n")
    return GATEWAY_EXIT.ok
  }
  if (!isPlainObject(section.value)) {
    stderr.write("omo gateway: the gateway section must be an object\n")
    return GATEWAY_EXIT.usage
  }

  if (subcommand === "status") {
    const scopes = scopeSummaries(section.value)
    if (args.includes("--json")) {
      stdout.write(`${JSON.stringify({ scopes })}\n`)
    } else if (scopes.length === 0) {
      stdout.write("gateway: no scopes configured\n")
    } else {
      for (const scope of scopes) stdout.write(`gateway scope ${scope.id}: 0 connectors\n`)
    }
    return GATEWAY_EXIT.ok
  }

  if (subcommand === "connect") return runConnect(args.slice(1), resolution, options)

  stderr.write(`omo gateway ${subcommand}: not implemented yet\n`)
  return GATEWAY_EXIT.usage
}

async function runConnect(args, resolution, options) {
  const { stdout = process.stdout, stderr = process.stderr } = options
  const section = resolution.section
  if (!section.validation.ok) {
    for (const error of section.validation.errors) stderr.write(`omo gateway connect: invalid gateway config: ${error}\n`)
    return GATEWAY_EXIT.usage
  }
  let connector
  try {
    connector = await (options.loadConnector ?? loadConnectorModule)()
  } catch (error) {
    stderr.write(`omo gateway connect: cannot load the connector: ${error instanceof Error ? error.message : String(error)}\n`)
    return GATEWAY_EXIT.unreadable
  }
  const env = options.env ?? process.env
  return connector.runConnectCommand(args, {
    gateway: section.value,
    agentDir: canonicalAgentDir(env),
    env,
    home: runtimeHome(env),
    stdout,
    stderr,
    launch: options.launch ?? [process.execPath, process.argv[1], "gateway", "connect"],
    configPath: resolution.userPath,
    reloadGateway: () => reloadGatewaySection(options),
  })
}

/** The gateway section read again after the user config changed; throws when it is gone or invalid. */
async function reloadGatewaySection(options) {
  const again = (await resolveGateway(options)).section
  if (!again.present) throw new Error("the gateway section is no longer in the user config")
  if (!again.validation.ok) throw new Error(`invalid gateway config: ${again.validation.errors.join("; ")}`)
  return again.value
}

async function loadConnectorModule() {
  const source = join(packageRoot, GATEWAY_CONNECTOR_SOURCE)
  if (!existsSync(source)) throw new Error("the gateway connector is not part of this install yet")
  return import(pathToFileURL(source).href)
}

/**
 * The gateway row of `omo doctor`: validates the user config's `gateway` section against the
 * owning schema and warns about every placement the loader ignores (project layers, profiles),
 * through the staged runtime (`plugin/runtime/gateway-schema/index.js`, bundled from
 * gateway-schema-entry.ts). Fail-open like the category-coverage row: a payload without the
 * runtime, or any error, yields no lines - and a machine without any gateway section gets none at
 * all, so doctor output stays unchanged when the feature is off.
 *
 * @param options.cwd / options.env where the user config and project layers are looked up
 * @param options.loadRuntime injected so tests never need the staged payload
 * @returns {Promise<string[]>}
 */
export async function gatewayDoctorLines(options = {}) {
  try {
    const resolution = await resolveGateway(options)
    const lines = ignoredLines(resolution).map((line) => `WARN gateway config: ignored ${line}`)
    const section = resolution.section
    if (!section.present) return lines
    if (section.validation.ok) return [...lines, `PASS gateway config: valid (${resolution.userPath})`]
    return [...lines, ...section.validation.errors.map((error) => `FAIL gateway config: ${resolution.userPath}: ${error}`)]
  } catch {
    return []
  }
}

async function resolveGateway(options) {
  const runtime = await (options.loadRuntime ?? loadSchemaRuntime)()
  return runtime.resolveGatewayConfig({ cwd: options.cwd ?? process.cwd(), env: options.env ?? process.env })
}

async function loadSchemaRuntime() {
  return import(pathToFileURL(join(packageRoot, GATEWAY_SCHEMA_RUNTIME)).href)
}

