/**
 * The agent toolkit's layer-2 namespaces (kernel side). The SDK imports this module only when the
 * engine published the dori switch; omo implements no namespace function itself. `toolkit.<ns>.<fn>`
 * calls the session tool the dori host's store extension declared (`ext_dori_<ns>_<fn>`) through the
 * kernel's tool bridge, so the engine stamps the caller and journals the call under its replay key.
 * Each call carries the eval cell it came from and its index in that cell, taken synchronously in
 * program order; the engine maps the cell to the turn it started in. A replay the engine stopped is
 * thrown as `ToolkitReplayStopError`. The built plugin ships this module as `runtime/dori/layer2.js`.
 */
import { DORI_REPLAY_CONTEXT_ARG as REPLAY_CONTEXT_ARG, DORI_STORE_EXTENSION, DORI_TOOLKIT_NAMESPACES, doriLayer2Path, type DoriToolkitNamespace } from "../dori-gate"
import { renderSignature } from "./signature"

export { inboundReplayKey, TOOLKIT_REPLAY_RETENTION_MS, toolkitReplayKey } from "./replay-key"

export type DoriCallResult = { readonly kind: string } & Readonly<Record<string, unknown>>

export interface DoriFunction {
  (args?: Readonly<Record<string, unknown>>): Promise<DoriCallResult>
  readonly [name: string]: DoriFunction
}

export type DoriNamespace = { readonly [name: string]: DoriFunction }

export type DoriLayer2 = { readonly [Namespace in DoriToolkitNamespace]: DoriNamespace }

export type DoriLayer2Function = {
  readonly namespace: DoriToolkitNamespace
  readonly name: string
  readonly tool: string
  readonly description: string
  readonly signature: string
}

export type DoriLayer2Help = {
  readonly namespaces: readonly DoriToolkitNamespace[]
  readonly functions: readonly DoriLayer2Function[]
  readonly error?: string
}

/** The kernel's tool surface: `globalThis.tool` and `globalThis.tool_schema` in an eval cell. */
export interface KernelToolHost {
  call(name: string, args: unknown): Promise<unknown>
  list(): Promise<readonly string[]>
  schema(name: string): Promise<{ readonly name: string; readonly description?: string; readonly parameters?: unknown }>
}

export type ToolkitReplayStopCode = "toolkit_replay_divergence" | "toolkit_replay_pending" | "toolkit_replay_expired" | "toolkit_replay_turn_unknown"

export class ToolkitReplayStopError extends Error {
  override readonly name = "ToolkitReplayStopError"
  readonly code: ToolkitReplayStopCode
  readonly key: string | undefined
  readonly differs: readonly ("op" | "args")[] | undefined
  readonly recordedOp: string | undefined
  readonly attemptedOp: string | undefined

  constructor(stop: { readonly code: ToolkitReplayStopCode; readonly message: string; readonly key?: string; readonly differs?: readonly ("op" | "args")[]; readonly recorded_op?: string; readonly attempted_op?: string }) {
    super(stop.message)
    this.code = stop.code
    this.key = stop.key
    this.differs = stop.differs
    this.recordedOp = stop.recorded_op
    this.attemptedOp = stop.attempted_op
  }
}

const TOOL_PREFIX = `ext_${DORI_STORE_EXTENSION}_`
/** A stack location that is not a file: the kernel evaluates each cell under its tool call id as the sourceURL. */
const CELL_FRAME = /\(([^()\s/\\:]+):\d+:\d+\)\s*$/

/** The eval cell this call was made from, read from the stack while the cell's code is still on it; undefined outside a cell. */
function callingCell(): string | undefined {
  for (const line of (new Error().stack ?? "").split("\n")) {
    const cell = CELL_FRAME.exec(line)?.[1]
    if (cell !== undefined && cell !== "native" && !cell.startsWith("<")) return cell
  }
  return undefined
}

type KernelGlobals = {
  readonly tool?: Readonly<Record<string, (args: unknown) => Promise<unknown>>>
  readonly tool_schema?: (name?: string) => Promise<unknown>
}

function kernelToolHost(): KernelToolHost {
  const globals = globalThis as KernelGlobals
  const schemaOf = (name?: string): Promise<unknown> => {
    if (typeof globals.tool_schema !== "function") throw new Error("tool_schema() is not available: the dori toolkit namespaces run inside an eval cell.")
    return globals.tool_schema(name)
  }
  return {
    call: (name, args) => {
      const invoke = globals.tool?.[name]
      if (typeof invoke !== "function") throw new Error(`The kernel has no tool ${name}: the dori toolkit namespaces run inside an eval cell.`)
      return invoke(args)
    },
    list: async () => {
      const listed = (await schemaOf()) as { readonly tools?: unknown }
      return Array.isArray(listed.tools) ? listed.tools.filter((name): name is string => typeof name === "string") : []
    },
    schema: async (name) => (await schemaOf(name)) as { readonly name: string; readonly description?: string; readonly parameters?: unknown },
  }
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

async function callLayer2(host: KernelToolHost, tool: string, args: Readonly<Record<string, unknown>>): Promise<DoriCallResult> {
  const output = await host.call(tool, args)
  const details = isRecord(output) && isRecord(output.details) ? output.details : undefined
  const result = details?.result
  if (!isRecord(result) || typeof result.kind !== "string") {
    const text = isRecord(output) && typeof output.text === "string" ? output.text : JSON.stringify(output)
    throw new Error(`${tool} returned no store result: ${text}`)
  }
  if (result.kind === "replay_stopped") throw new ToolkitReplayStopError(result as unknown as ConstructorParameters<typeof ToolkitReplayStopError>[0])
  return result as DoriCallResult
}

/** Kernel-wide, so every wrapper in one kernel shares a cell's counter: re-importing the layer or a second toolkit view never restarts a cell's indexes. */
const CELL_COUNTERS = Symbol.for("omo.doriToolkitCellCounters")

/** Index and cell are taken synchronously at the call, before any await, so concurrent calls keep program order. */
function layerFunction(host: KernelToolHost, counters: Map<string, number>, path: readonly string[]): DoriFunction {
  const invoke = (args: Readonly<Record<string, unknown>> = {}) => {
    const cell = callingCell()
    if (cell === undefined) return callLayer2(host, `${TOOL_PREFIX}${path.join("_")}`, args)
    const index = counters.get(cell) ?? 0
    counters.set(cell, index + 1)
    return callLayer2(host, `${TOOL_PREFIX}${path.join("_")}`, { ...args, [REPLAY_CONTEXT_ARG]: { cell, index } })
  }
  return new Proxy(invoke, {
    get(target, property) {
      if (typeof property !== "string" || property === "then") return Reflect.get(target, property)
      return layerFunction(host, counters, [...path, property])
    },
  }) as unknown as DoriFunction
}

function namespaceObject(host: KernelToolHost, counters: Map<string, number>, namespace: DoriToolkitNamespace): DoriNamespace {
  return new Proxy(Object.freeze({}), {
    get(target, property) {
      if (typeof property !== "string" || property === "then") return Reflect.get(target, property)
      return layerFunction(host, counters, [namespace, property])
    },
  }) as DoriNamespace
}

/** The tool schema as the caller writes it: the SDK sets the replay context itself, so help() never shows it. */
function withoutReplayContext(parameters: unknown): unknown {
  if (!isRecord(parameters) || !isRecord(parameters.properties) || !Object.hasOwn(parameters.properties, REPLAY_CONTEXT_ARG)) return parameters
  const { [REPLAY_CONTEXT_ARG]: _context, ...properties } = parameters.properties
  return { ...parameters, properties }
}

async function describeLayer2(host: KernelToolHost): Promise<DoriLayer2Help> {
  const namespaces = [...DORI_TOOLKIT_NAMESPACES]
  try {
    const functions: DoriLayer2Function[] = []
    for (const tool of await host.list()) {
      if (!tool.startsWith(TOOL_PREFIX)) continue
      const path = doriLayer2Path(DORI_STORE_EXTENSION, tool.slice(TOOL_PREFIX.length))
      if (path === undefined) continue
      const schema = await host.schema(tool)
      functions.push({ namespace: path.namespace, name: path.op, tool, description: schema.description ?? "", signature: renderSignature(path.op, withoutReplayContext(schema.parameters)) })
    }
    const rank = (fn: DoriLayer2Function) => namespaces.indexOf(fn.namespace)
    functions.sort((left, right) => rank(left) - rank(right) || left.name.localeCompare(right.name))
    return { namespaces, functions }
  } catch (error) {
    return { namespaces, functions: [], error: error instanceof Error ? error.message : String(error) }
  }
}

/** The toolkit with the eleven namespaces added and `help()` listing the registered functions with their signatures. */
export function withDoriLayer2<Base extends { readonly help: () => Promise<{ readonly ok: boolean }> }>(base: Base, host: KernelToolHost = kernelToolHost()): Base & DoriLayer2 {
  const counters = ((globalThis as { [key: symbol]: unknown })[CELL_COUNTERS] as Map<string, number> | undefined) ?? new Map<string, number>()
  ;(globalThis as { [key: symbol]: unknown })[CELL_COUNTERS] = counters
  const namespaces = Object.fromEntries(DORI_TOOLKIT_NAMESPACES.map((namespace) => [namespace, namespaceObject(host, counters, namespace)])) as DoriLayer2
  const help = async () => {
    const response = await base.help()
    if (!response.ok || !("result" in response) || !isRecord(response.result)) return response
    return { ...response, result: { ...response.result, layer2: await describeLayer2(host) } }
  }
  return { ...base, ...namespaces, help } as Base & DoriLayer2
}
