/**
 * The agent toolkit's layer-2 namespaces (kernel side). The SDK imports this module only when the
 * engine published the dori switch; omo implements no namespace function itself. `toolkit.<ns>.<fn>`
 * calls the session tool the dori host's store extension declared (`ext_dori_<ns>_<fn>`) through the
 * kernel's tool bridge, so the engine stamps the caller and journals the call under its replay key;
 * a replay the engine stopped is thrown as `ToolkitReplayStopError`.
 */
import { DORI_STORE_EXTENSION, DORI_TOOLKIT_NAMESPACES, doriLayer2Path, type DoriToolkitNamespace } from "../dori-gate"
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

export type ToolkitReplayStopCode = "toolkit_replay_divergence" | "toolkit_replay_pending" | "turn_context_missing"

export class ToolkitReplayStopError extends Error {
  override readonly name = "ToolkitReplayStopError"
  readonly code: ToolkitReplayStopCode
  readonly key: string | undefined
  readonly recordedOp: string | undefined
  readonly attemptedOp: string | undefined

  constructor(stop: { readonly code: ToolkitReplayStopCode; readonly message: string; readonly key?: string; readonly recorded_op?: string; readonly attempted_op?: string }) {
    super(stop.message)
    this.code = stop.code
    this.key = stop.key
    this.recordedOp = stop.recorded_op
    this.attemptedOp = stop.attempted_op
  }
}

const TOOL_PREFIX = `ext_${DORI_STORE_EXTENSION}_`
const PASSTHROUGH = new Set(["then", "call", "apply", "bind", "toString", "name", "length", "prototype", "constructor"])

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

function layerFunction(host: KernelToolHost, path: readonly string[]): DoriFunction {
  const invoke = (args: Readonly<Record<string, unknown>> = {}) => callLayer2(host, `${TOOL_PREFIX}${path.join("_")}`, args)
  return new Proxy(invoke, {
    get(target, property) {
      if (typeof property !== "string" || PASSTHROUGH.has(property)) return Reflect.get(target, property)
      return layerFunction(host, [...path, property])
    },
  }) as unknown as DoriFunction
}

function namespaceObject(host: KernelToolHost, namespace: DoriToolkitNamespace): DoriNamespace {
  return new Proxy(Object.freeze({}), {
    get(target, property) {
      if (typeof property !== "string" || property === "then") return Reflect.get(target, property)
      return layerFunction(host, [namespace, property])
    },
  }) as DoriNamespace
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
      functions.push({ namespace: path.namespace, name: path.op, tool, description: schema.description ?? "", signature: renderSignature(path.op, schema.parameters) })
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
  const namespaces = Object.fromEntries(DORI_TOOLKIT_NAMESPACES.map((namespace) => [namespace, namespaceObject(host, namespace)])) as DoriLayer2
  const help = async () => {
    const response = await base.help()
    if (!response.ok || !("result" in response) || !isRecord(response.result)) return response
    return { ...response, result: { ...response.result, layer2: await describeLayer2(host) } }
  }
  return { ...base, ...namespaces, help } as Base & DoriLayer2
}
