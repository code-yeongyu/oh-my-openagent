import { describe, expect, test } from "bun:test"
import { z } from "zod"
import { tool } from "@opencode-ai/plugin"
import { toV2ToolDefinition, v1ResultToV2, zodShapeToJsonSchema } from "./tool-bridge"

function makeV1Tool(
  args: z.ZodRawShape,
  execute: (argsInput: unknown) => Promise<string | { title?: string; output: string; metadata?: Record<string, unknown> }>,
) {
  return tool({
    description: "test tool",
    args,
    execute: execute as never,
  })
}

describe("zodShapeToJsonSchema", () => {
  test("#given a zod raw shape #when converted #then it produces a JSON Schema object with required fields", () => {
    // given
    const v1Tool = makeV1Tool({ name: z.string().describe("the name") }, async () => "ok")
    // when
    const schema = zodShapeToJsonSchema(v1Tool)
    // then
    expect(schema.type).toBe("object")
    expect(schema.properties?.["name"]).toEqual({ type: "string", description: "the name" })
    expect(schema.required).toEqual(["name"])
  })

  test("#given a shape with optional properties #when converted #then optional fields are not required", () => {
    // given
    const v1Tool = makeV1Tool(
      { name: z.string(), limit: z.number().optional() },
      async () => "ok",
    )
    // when
    const schema = zodShapeToJsonSchema(v1Tool)
    // then
    expect(schema.required).toEqual(["name"])
    expect(schema.properties?.["limit"]).toBeDefined()
  })

  test("#given a tool with no convertible args #when converted #then it falls back to a permissive object schema", () => {
    // given
    const v1Tool = { description: "broken", args: undefined } as unknown as ReturnType<typeof tool>
    // when
    const schema = zodShapeToJsonSchema(v1Tool)
    // then
    expect(schema.type).toBe("object")
    expect(schema.additionalProperties).toBe(true)
  })
})

describe("v1ResultToV2", () => {
  test("#given a plain string result #when mapped #then it becomes text content", () => {
    // given
    const result = "hello world"
    // when
    const v2Result = v1ResultToV2(result)
    // then
    expect(v2Result.content).toBe("hello world")
  })

  test("#given a structured result with title/output/metadata #when mapped #then title lands in metadata and output in content", () => {
    // given
    const result = { title: "Search", output: "found 3 files", metadata: { truncated: false } }
    // when
    const v2Result = v1ResultToV2(result)
    // then
    expect(v2Result.content).toEqual([{ type: "text", text: "found 3 files" }])
    expect(v2Result.metadata).toEqual({ truncated: false, title: "Search" })
  })

  test("#given a result with file attachments #when mapped #then attachments become file content parts", () => {
    // given
    const result = {
      output: "see image",
      attachments: [{ type: "file" as const, mime: "image/png", url: "file:///tmp/a.png", filename: "a.png" }],
    }
    // when
    const v2Result = v1ResultToV2(result)
    // then
    const content = v2Result.content as Array<{ type: string; text?: string; uri?: string }>
    expect(content).toHaveLength(2)
    expect(content[1]).toMatchObject({ type: "file", uri: "file:///tmp/a.png", mime: "image/png", name: "a.png" })
  })
})

describe("toV2ToolDefinition", () => {
  test("#given a V1 tool #when bridged #then execute maps context and result shapes", async () => {
    // given
    const v1Tool = makeV1Tool({ ping: z.string() }, async (input) => `pong:${(input as { ping: string }).ping}`)
    const progressCalls: Array<Record<string, unknown>> = []
    const v2Context = {
      sessionID: "ses_1",
      agent: "sisyphus",
      messageID: "msg_1",
      id: "call_1",
      progress: async (update: Record<string, unknown>) => {
        progressCalls.push(update)
      },
    }
    // when
    const definition = toV2ToolDefinition({
      name: "ping_tool",
      tool: v1Tool,
      directory: "/project",
      worktree: "/project",
    })
    const v2Result = await definition.execute({ ping: "x" }, v2Context)
    // then
    expect(definition.name).toBe("ping_tool")
    expect(definition.input.type).toBe("object")
    expect(v2Result.content).toBe("pong:x")
    expect(progressCalls).toHaveLength(0)
  })

  test("#given a V1 tool that calls metadata() #when executed #then progress is forwarded", async () => {
    // given
    const v1Tool = tool({
      description: "reports progress",
      args: {},
      execute: async (_args, context) => {
        context.metadata({ title: "working" })
        return "done"
      },
    })
    const progressCalls: Array<Record<string, unknown>> = []
    const v2Context = {
      sessionID: "ses_2",
      agent: "sisyphus",
      messageID: "msg_2",
      id: "call_2",
      progress: async (update: Record<string, unknown>) => {
        progressCalls.push(update)
      },
    }
    // when
    const definition = toV2ToolDefinition({
      name: "progress_tool",
      tool: v1Tool,
      directory: "/project",
      worktree: "/project",
    })
    await definition.execute({}, v2Context)
    // then
    expect(progressCalls).toEqual([{ title: "working" }])
  })
})
