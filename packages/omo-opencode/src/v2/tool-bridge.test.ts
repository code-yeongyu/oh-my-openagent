import { describe, expect, it, mock } from "bun:test"
import { tool, type ToolContext } from "@opencode-ai/plugin/tool"
import { normalizeToolArgSchemas } from "../plugin/normalize-tool-arg-schemas"
import type { V2ToolExecuteContext, V2ToolInfo } from "./context-types"
import { toPlainJsonSchema, toV2Tool, type ToolBridgeDeps } from "./tool-bridge"

const deps: ToolBridgeDeps = {
  directory: "/work/app/packages/web",
  worktree: "/work/app",
  warn: () => {},
}

function createExecuteContext(overrides: Partial<V2ToolExecuteContext> = {}): V2ToolExecuteContext {
  return {
    sessionID: "ses_1",
    agent: "sisyphus",
    messageID: "msg_1",
    id: "call_1",
    signal: new AbortController().signal,
    progress: async () => {},
    ...overrides,
  }
}

function greetTool(execute: (args: { name: string }, context: ToolContext) => Promise<string | { output: string; title?: string; metadata?: Record<string, unknown> }>) {
  return tool({
    description: "Greets someone",
    args: { name: tool.schema.string().describe("who to greet") },
    execute,
  })
}

type JsonSchemaObject = {
  type?: string
  properties?: Record<string, { type?: string; description?: string }>
  required?: string[]
}

function inputSchema(info: V2ToolInfo): JsonSchemaObject {
  return info.input as JsonSchemaObject
}

describe("toPlainJsonSchema", () => {
  it("#given generated JSON Schema with a hidden ~standard member #when made plain #then only JSON data remains", () => {
    // given
    const generated = { type: "object", properties: { name: { type: "string" } }, required: ["name"] }
    Object.defineProperty(generated, "~standard", { value: { vendor: "zod" }, enumerable: false })
    expect("~standard" in generated).toBe(true)

    // when
    const plain = toPlainJsonSchema(generated)

    // then
    expect("~standard" in plain).toBe(false)
    expect(plain).toEqual({ type: "object", properties: { name: { type: "string" } }, required: ["name"] })
  })
})

describe("toV2Tool", () => {
  describe("#given a V1 tool definition", () => {
    it("#when converted #then name, description and direct-call options carry over", () => {
      // given
      const definition = greetTool(async () => "hi")

      // when
      const info = toV2Tool("greet", definition, deps)

      // then
      expect(info.name).toBe("greet")
      expect(info.description).toBe("Greets someone")
      expect(info.options).toEqual({ codemode: false })
    })

    it("#when converted #then the input is plain JSON Schema built with this package's zod", () => {
      // given
      const definition = greetTool(async () => "hi")

      // when
      const schema = inputSchema(toV2Tool("greet", definition, deps))

      // then
      expect(schema.type).toBe("object")
      expect(schema.properties?.name).toMatchObject({ type: "string", description: "who to greet" })
      expect(schema.required).toEqual(["name"])
      expect("~standard" in schema).toBe(false)
    })

    it("#when an arg cannot be expressed in JSON Schema #then conversion still succeeds", () => {
      // given
      const definition = tool({
        description: "Takes a date",
        args: { at: tool.schema.date() },
        execute: async () => "ok",
      })

      // when
      const convert = () => toV2Tool("when", definition, deps)

      // then
      expect(convert).not.toThrow()
    })
  })

  describe("#given a tool the registry already normalized for 1.x", () => {
    function searchTool() {
      return normalizeToolArgSchemas(
        tool({
          description: "Searches",
          args: {
            pattern: tool.schema.string().describe("regex to search for"),
            path: tool.schema.string().optional().describe("directory to search"),
            mode: tool.schema.enum(["content", "count"]).optional().describe("output mode"),
          },
          execute: async () => "ok",
        }),
      )
    }

    it("#when converted #then the schema is generated without consulting the per-field 1.x overrides", () => {
      // given
      const definition = searchTool()
      const consulted = mock(() => {
        throw new Error("per-field override consulted during whole-object conversion")
      })
      for (const field of Object.values(definition.args)) {
        ;(field._zod as { toJSONSchema?: () => unknown }).toJSONSchema = consulted
      }

      // when
      const schema = inputSchema(toV2Tool("search", definition, deps))

      // then
      expect(consulted).not.toHaveBeenCalled()
      expect(Object.keys(schema.properties ?? {})).toEqual(["pattern", "path", "mode"])
      expect(schema.required).toEqual(["pattern"])
      expect(schema.properties?.path).toMatchObject({ type: "string", description: "directory to search" })
    })

    it("#when converted #then the 1.x overrides are put back on every field", () => {
      // given
      const definition = searchTool()
      const overrideBefore = Object.values(definition.args).map((field) => field._zod.toJSONSchema)

      // when
      toV2Tool("search", definition, deps)

      // then
      const overrideAfter = Object.values(definition.args).map((field) => field._zod.toJSONSchema)
      expect(overrideAfter).toEqual(overrideBefore)
      expect(overrideAfter.every((override) => typeof override === "function")).toBe(true)
    })
  })

  describe("#given zod semantics the V1 host applied before execute", () => {
    it("#when input is missing a default #then the zod default reaches execute", async () => {
      // given
      let received: unknown
      const definition = tool({
        description: "Has a default",
        args: { mode: tool.schema.string().default("fast") },
        execute: async (args) => {
          received = args
          return "ok"
        },
      })
      const info = toV2Tool("modal", definition, deps)

      // when
      await info.execute({}, createExecuteContext())

      // then
      expect(received).toEqual({ mode: "fast" })
    })

    it("#when input violates the zod schema #then execute is not called and the error names the field", async () => {
      // given
      const execute = mock(async () => "hi")
      const info = toV2Tool("greet", greetTool(execute), deps)

      // when
      const result = info.execute({ name: 7 }, createExecuteContext())

      // then
      await expect(result).rejects.toThrow(/name/)
      expect(execute).not.toHaveBeenCalled()
    })
  })

  describe("#given the V1 execute result", () => {
    it("#when it returns a string #then the V2 result is that text as content", async () => {
      // given
      const info = toV2Tool("greet", greetTool(async (args) => `hello ${args.name}`), deps)

      // when
      const result = await info.execute({ name: "Ada" }, createExecuteContext())

      // then
      expect(result).toEqual({ content: "hello Ada" })
    })

    it("#when it returns an object #then output becomes content and title merges into metadata", async () => {
      // given
      const info = toV2Tool(
        "greet",
        greetTool(async () => ({ output: "done", title: "Greeting", metadata: { count: 2 } })),
        deps,
      )

      // when
      const result = await info.execute({ name: "Ada" }, createExecuteContext())

      // then
      expect(result).toEqual({ content: "done", metadata: { title: "Greeting", count: 2 } })
    })

    it("#when the result metadata holds undefined values #then they are dropped so the host can encode it", async () => {
      // given
      const info = toV2Tool(
        "greet",
        greetTool(async () => ({ output: "done", title: "Greeting", metadata: { sessionId: "ses_child", model: undefined } })),
        deps,
      )

      // when
      const result = await info.execute({ name: "Ada" }, createExecuteContext())

      // then
      expect(result).toEqual({ content: "done", metadata: { title: "Greeting", sessionId: "ses_child" } })
      expect(Object.hasOwn(result.metadata ?? {}, "model")).toBe(false)
    })

    it("#when it returns attachments #then they become file content after the text", async () => {
      // given
      const definition = tool({
        description: "Shows an image",
        args: {},
        execute: async () => ({
          output: "see image",
          attachments: [{ type: "file" as const, mime: "image/png", url: "data:image/png;base64,AAAA", filename: "a.png" }],
        }),
      })
      const info = toV2Tool("show", definition, deps)

      // when
      const result = await info.execute({}, createExecuteContext())

      // then
      expect(result.content).toEqual([
        { type: "text", text: "see image" },
        { type: "file", uri: "data:image/png;base64,AAAA", mime: "image/png", name: "a.png" },
      ])
    })

    it("#when execute throws #then the error propagates so the host reports a tool error", async () => {
      // given
      const failure = new Error("boom")
      const info = toV2Tool("greet", greetTool(async () => { throw failure }), deps)

      // when
      const result = info.execute({ name: "Ada" }, createExecuteContext())

      // then
      await expect(result).rejects.toBe(failure)
    })
  })

  describe("#given the V1 tool context", () => {
    it("#when execute runs #then identity, directory, worktree and abort come from the V2 context", async () => {
      // given
      let seen: ToolContext | undefined
      const controller = new AbortController()
      const info = toV2Tool("greet", greetTool(async (_args, context) => { seen = context; return "ok" }), deps)

      // when
      await info.execute({ name: "Ada" }, createExecuteContext({ signal: controller.signal }))

      // then
      expect(seen?.sessionID).toBe("ses_1")
      expect(seen?.messageID).toBe("msg_1")
      expect(seen?.agent).toBe("sisyphus")
      expect(seen?.directory).toBe("/work/app/packages/web")
      expect(seen?.worktree).toBe("/work/app")
      expect(seen?.abort).toBe(controller.signal)
    })

    it("#when the tool reports metadata #then it is forwarded as V2 progress", async () => {
      // given
      const progress = mock(async (_update: Record<string, unknown>) => {})
      const info = toV2Tool(
        "greet",
        greetTool(async (_args, context) => {
          context.metadata({ title: "Working", metadata: { step: 1 } })
          return "ok"
        }),
        deps,
      )

      // when
      await info.execute({ name: "Ada" }, createExecuteContext({ progress }))

      // then
      expect(progress).toHaveBeenCalledWith({ title: "Working", step: 1 })
    })

    it("#when the metadata holds values JSON cannot carry #then only JSON values reach V2 progress", async () => {
      // given
      const progress = mock(async (_update: Record<string, unknown>) => {})
      const info = toV2Tool(
        "greet",
        greetTool(async (_args, context) => {
          context.metadata({
            title: "Working",
            metadata: { sessionId: "ses_child", model: undefined, nested: { keep: 1, drop: undefined }, at: new Date(0), list: [1, undefined] },
          })
          return "ok"
        }),
        deps,
      )

      // when
      await info.execute({ name: "Ada" }, createExecuteContext({ progress }))

      // then
      expect(progress).toHaveBeenCalledWith({
        title: "Working",
        sessionId: "ses_child",
        nested: { keep: 1 },
        at: "1970-01-01T00:00:00.000Z",
        list: [1, null],
      })
    })

    it("#when the metadata cannot be serialised at all #then the update is skipped with a warning and the tool goes on", async () => {
      // given
      const progress = mock(async (_update: Record<string, unknown>) => {})
      const warn = mock((_message: string) => {})
      const cyclic: Record<string, unknown> = {}
      cyclic.self = cyclic
      const info = toV2Tool(
        "greet",
        greetTool(async (_args, context) => {
          context.metadata({ title: "Working", metadata: cyclic })
          return "ok"
        }),
        { ...deps, warn },
      )

      // when
      const result = await info.execute({ name: "Ada" }, createExecuteContext({ progress }))

      // then
      expect(result).toEqual({ content: "ok" })
      expect(progress).not.toHaveBeenCalled()
      expect(warn.mock.calls[0]?.[0]).toContain("greet")
    })

    it("#when the host rejects a progress update #then the tool is not interrupted and the failure is reported", async () => {
      // given
      const warn = mock((_message: string) => {})
      const info = toV2Tool(
        "greet",
        greetTool(async (_args, context) => {
          context.metadata({ title: "Working" })
          return "ok"
        }),
        { ...deps, warn },
      )

      // when
      const result = await info.execute({ name: "Ada" }, createExecuteContext({ progress: async () => Promise.reject(new Error("stream closed")) }))
      await new Promise((resolve) => setTimeout(resolve, 0))

      // then
      expect(result).toEqual({ content: "ok" })
      expect(warn.mock.calls.some((call) => call[0].includes("stream closed"))).toBe(true)
    })

    it("#when the tool asks for permission #then it resolves and warns that 2.x does not enforce it", async () => {
      // given
      const warn = mock((_message: string) => {})
      const info = toV2Tool(
        "greet",
        greetTool(async (_args, context) => {
          await context.ask({ permission: "skill", patterns: ["x"], always: ["x"], metadata: {} })
          return "ok"
        }),
        { ...deps, warn },
      )

      // when
      const result = await info.execute({ name: "Ada" }, createExecuteContext())

      // then
      expect(result).toEqual({ content: "ok" })
      expect(warn).toHaveBeenCalledTimes(1)
    })
  })
})
