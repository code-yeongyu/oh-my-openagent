import type {
  KernelToolLanguage,
  KernelToolDescriptor,
  KernelToolInvokeOptions,
  KernelToolInvokeRequest,
  KernelToolInvokeScope,
  KernelToolsCapability,
} from "../../../kernel-tools/contract"

/**
 * The nested host call a parent closure makes while it runs. The fake enforces the call's scope
 * exactly as the producer does (deny wins, an allow list refuses every name it does not carry,
 * a malformed list fails closed), so a test asserting the refusal is asserting real semantics.
 */
export type FakeHostCall = (toolName: string) => Promise<unknown>

export type FakeKernelToolDefinition = {
  readonly name: string
  readonly description?: string
  readonly input_schema?: Record<string, unknown>
  readonly language?: KernelToolLanguage
  readonly run?: (args: unknown, host: FakeHostCall) => unknown
}

/** One `invoke` exactly as the consumer made it, including how many arguments it passed. */
export type FakeInvokeCall = {
  readonly request: KernelToolInvokeRequest
  readonly options: AbortSignal | KernelToolInvokeOptions | undefined
  readonly argCount: number
}

export type FakeKernelToolsCapability = KernelToolsCapability & {
  readonly invocations: readonly KernelToolInvokeRequest[]
  readonly invokeCalls: readonly FakeInvokeCall[]
  readonly describeCalls: readonly (readonly string[])[]
  readonly hostCalls: readonly string[]
  define(definition: FakeKernelToolDefinition): KernelToolDescriptor
  redefine(name: string, run: (args: unknown) => unknown): KernelToolDescriptor
  reset(): void
  kill(message?: string): void
  descriptor(name: string): KernelToolDescriptor
}

export type FakeKernelToolsOptions = {
  /** Advertise the producer's `capabilities.invokeScope` marker (senpi#1731 / PR #1765). */
  readonly invokeScope?: boolean
}

type Entry = {
  readonly descriptor: KernelToolDescriptor
  readonly run: (args: unknown, host: FakeHostCall) => unknown
}

function error(code: string, message: string, details?: Record<string, unknown>): Error {
  return Object.assign(new Error(message), details === undefined ? { code } : { code, details })
}

function nameList(value: unknown): readonly string[] | null {
  if (!Array.isArray(value)) return null
  return value.every((name) => typeof name === "string") ? (value as readonly string[]) : null
}

/** The producer's `hostToolRefusal` rule, reproduced so a scoped fake refuses what senpi refuses. */
function hostToolRefusal(scope: KernelToolInvokeScope | undefined, toolName: string): "allow" | "deny" | null {
  const tools = scope?.tools
  if (tools === null || typeof tools !== "object" || tools === undefined) return null
  if (tools.deny !== undefined) {
    const deny = nameList(tools.deny)
    if (deny === null || deny.includes(toolName)) return "deny"
  }
  if (tools.allow !== undefined) {
    const allow = nameList(tools.allow)
    if (allow === null || !allow.includes(toolName)) return "allow"
  }
  return null
}

/**
 * Structural stand-in for the live parent JS kernel capability: fenced descriptors, generation
 * bumps on reset, revision bumps on same-name redefinition, and the producer's typed error codes.
 * Only the exported contract shape is reproduced - no senpi-codemode code is imported.
 */
export function fakeKernelTools(options: FakeKernelToolsOptions = {}): FakeKernelToolsCapability {
  const entries = new Map<string, Entry>()
  const invocations: KernelToolInvokeRequest[] = []
  const invokeCalls: FakeInvokeCall[] = []
  const describeCalls: (readonly string[])[] = []
  const hostCalls: string[] = []
  let generation = 1
  let dead: string | undefined

  function define(definition: FakeKernelToolDefinition): KernelToolDescriptor {
    const previous = entries.get(definition.name)
    const descriptor: KernelToolDescriptor = {
      name: definition.name,
      description: definition.description ?? `fake kernel tool ${definition.name}`,
      input_schema: definition.input_schema ?? {
        type: "object",
        properties: { value: { type: "string" } },
        additionalProperties: false,
      },
      language: definition.language ?? "js",
      kernel_generation: generation,
      definition_revision: (previous?.descriptor.definition_revision ?? 0) + 1,
    }
    entries.set(definition.name, { descriptor, run: definition.run ?? ((args) => ({ echoed: args })) })
    return descriptor
  }

  return {
    ...(options.invokeScope === true ? { capabilities: { invokeScope: true as const } } : {}),
    invocations,
    invokeCalls,
    describeCalls,
    hostCalls,
    define,
    redefine: (name, run) => define({ name, run }),
    reset: () => {
      generation += 1
      entries.clear()
    },
    kill: (message = "JavaScript worker is not available") => {
      dead = message
      entries.clear()
    },
    descriptor: (name) => {
      const entry = entries.get(name)
      if (entry === undefined) throw new Error(`fixture has no kernel tool ${name}`)
      return entry.descriptor
    },
    describe: async (names) => {
      describeCalls.push([...names])
      if (dead !== undefined) throw error("tools_unavailable", dead)
      return {
        results: names.map((name) => {
          const entry = entries.get(name)
          return entry === undefined
            ? { name, ok: false, error: { code: "kernel_tool_missing", message: `Kernel tool is not defined: ${name}` } }
            : { name, ok: true, descriptor: entry.descriptor }
        }),
      }
    },
    invoke: async (...args: [KernelToolInvokeRequest, (AbortSignal | KernelToolInvokeOptions)?]) => {
      const [request, invokeOptions] = args
      invocations.push(request)
      invokeCalls.push({ request, options: invokeOptions, argCount: args.length })
      if (dead !== undefined) throw error("tools_unavailable", dead)
      if (request.kernel_generation !== generation) {
        throw error("kernel_tool_stale", "Kernel tool descriptor generation is stale")
      }
      const entry = entries.get(request.name)
      if (entry === undefined) throw error("kernel_tool_missing", `Kernel tool is not defined: ${request.name}`)
      if (entry.descriptor.definition_revision !== request.definition_revision) {
        throw error("kernel_tool_stale", "Kernel tool descriptor revision is stale")
      }
      const scope = invokeOptions instanceof AbortSignal || invokeOptions === undefined ? undefined : invokeOptions.scope
      const host: FakeHostCall = async (toolName) => {
        const refusal = hostToolRefusal(scope, toolName)
        if (refusal !== null) {
          throw error(
            "kernel_tool_host_denied",
            `Host tool is outside this kernel tool call's scope: ${toolName} (${refusal})`,
            { tool: toolName, call_id: request.call_id, reason: refusal },
          )
        }
        hostCalls.push(toolName)
        return `host:${toolName}`
      }
      return await entry.run(request.args, host)
    },
  }
}
