import type { KernelToolDescriptor, KernelToolInvokeRequest, KernelToolsCapability } from "../../../kernel-tools/contract"

export type FakeKernelToolDefinition = {
  readonly name: string
  readonly description?: string
  readonly input_schema?: Record<string, unknown>
  readonly run?: (args: unknown) => unknown
}

export type FakeKernelToolsCapability = KernelToolsCapability & {
  readonly invocations: readonly KernelToolInvokeRequest[]
  readonly describeCalls: readonly (readonly string[])[]
  define(definition: FakeKernelToolDefinition): KernelToolDescriptor
  redefine(name: string, run: (args: unknown) => unknown): KernelToolDescriptor
  reset(): void
  kill(message?: string): void
  descriptor(name: string): KernelToolDescriptor
}

type Entry = {
  readonly descriptor: KernelToolDescriptor
  readonly run: (args: unknown) => unknown
}

function error(code: string, message: string): Error {
  return Object.assign(new Error(message), { code })
}

/**
 * Structural stand-in for the live parent JS kernel capability: fenced descriptors, generation
 * bumps on reset, revision bumps on same-name redefinition, and the producer's typed error codes.
 * Only the exported contract shape is reproduced - no senpi-codemode code is imported.
 */
export function fakeKernelTools(): FakeKernelToolsCapability {
  const entries = new Map<string, Entry>()
  const invocations: KernelToolInvokeRequest[] = []
  const describeCalls: (readonly string[])[] = []
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
      language: "js",
      kernel_generation: generation,
      definition_revision: (previous?.descriptor.definition_revision ?? 0) + 1,
    }
    entries.set(definition.name, { descriptor, run: definition.run ?? ((args) => ({ echoed: args })) })
    return descriptor
  }

  return {
    invocations,
    describeCalls,
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
    invoke: async (request) => {
      invocations.push(request)
      if (dead !== undefined) throw error("tools_unavailable", dead)
      if (request.kernel_generation !== generation) {
        throw error("kernel_tool_stale", "Kernel tool descriptor generation is stale")
      }
      const entry = entries.get(request.name)
      if (entry === undefined) throw error("kernel_tool_missing", `Kernel tool is not defined: ${request.name}`)
      if (entry.descriptor.definition_revision !== request.definition_revision) {
        throw error("kernel_tool_stale", "Kernel tool descriptor revision is stale")
      }
      return entry.run(request.args)
    },
  }
}
