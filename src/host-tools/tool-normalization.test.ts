import { describe, expect, test } from "bun:test"
import { tool } from "@opencode-ai/plugin"
import type { HostSessionActions, HostSessionContext, HostToolDefinition, JsonObject } from "../host-contract"
import {
  createHostToolErrorResult,
  createOpenCodeToolParameterSchema,
  normalizeOpenCodeToolResult,
  normalizeTargetToolParameters,
  registerTargetTool,
  sanitizeJsonSchema,
} from "./index"

function createSessionContext(): HostSessionContext {
  const actions: HostSessionActions = {
    sendUserMessage: async () => {},
    sendInternalMessage: async () => {},
    appendEntry: async () => {},
    getSessionName: () => undefined,
    setSessionName: async () => {},
    getContextUsage: () => undefined,
    compact: async () => {},
    abort: () => {},
    isIdle: () => true,
    hasPendingMessages: () => false,
  }

  return {
    id: "session-1",
    cwd: "/workspace/project",
    actions,
  }
}

function getProperties(schema: JsonObject): JsonObject {
  const properties = schema.properties
  if (typeof properties !== "object" || properties === null || Array.isArray(properties)) {
    throw new Error("schema properties missing")
  }
  return properties as JsonObject
}

describe("host tool schema normalization", () => {
  test("#given OpenCode args #when normalized #then target schema preserves required and optional fields", () => {
    // given
    const args = {
      query: tool.schema.string().describe("Search query"),
      limit: tool.schema.number().optional().describe("Maximum results"),
    }

    // when
    const schema = createOpenCodeToolParameterSchema(args)
    const properties = getProperties(schema)

    // then
    expect(schema.$schema).toBeUndefined()
    expect(schema.type).toBe("object")
    expect(schema.required).toEqual(["query"])
    expect(properties.query).toMatchObject({ type: "string", description: "Search query" })
    expect(properties.limit).toMatchObject({ type: "number", description: "Maximum results" })
  })

  test("#given unsupported JSON schema keywords #when sanitized #then target schema removes only schema keywords", () => {
    // given
    const schema = {
      type: "object",
      properties: {
        contentEncoding: { type: "string" },
        data: {
          type: "string",
          contentEncoding: "base64",
          contentMediaType: "application/octet-stream",
        },
      },
      $defs: {
        Encoding: { type: "string" },
      },
      link: { $ref: "Encoding" },
    }

    // when
    const sanitized = sanitizeJsonSchema(schema)

    // then
    expect(sanitized).toEqual({
      type: "object",
      properties: {
        contentEncoding: { type: "string" },
        data: {
          type: "string",
        },
      },
      $defs: {
        Encoding: { type: "string" },
      },
      link: { $ref: "#/$defs/Encoding" },
    })
  })

  test("#given target hosts #when normalizing parameters #then OpenCode keeps args and Pi-family hosts receive JSON schema", () => {
    // given
    const args = {
      path: tool.schema.string(),
    }

    // when
    const opencode = normalizeTargetToolParameters("opencode", { kind: "opencode-args", args })
    const ohMyPi = normalizeTargetToolParameters("oh-my-pi", { kind: "opencode-args", args })
    const pi = normalizeTargetToolParameters("pi", { kind: "opencode-args", args })

    // then
    expect(opencode.parameters).toBe(args)
    expect(ohMyPi.parameters).toMatchObject({ type: "object" })
    expect(pi.parameters).toMatchObject({ type: "object" })
  })
})

describe("host tool result normalization", () => {
  test("#given OpenCode string and structured results #when normalized #then host result content is stable", () => {
    // when
    const textResult = normalizeOpenCodeToolResult("plain output")
    const structuredResult = normalizeOpenCodeToolResult({
      title: "Search",
      output: "structured output",
      metadata: { count: 2 },
      attachments: [{ type: "file" }],
    })

    // then
    expect(textResult.content).toEqual([{ type: "text", text: "plain output" }])
    expect(structuredResult.content).toEqual([{ type: "text", text: "structured output" }])
    expect(structuredResult.details).toEqual({
      title: "Search",
      metadata: { count: 2 },
      attachments: [{ type: "file" }],
    })
  })

  test("#given thrown value #when creating error result #then target error flag is set", () => {
    // when
    const result = createHostToolErrorResult(new Error("boom"))

    // then
    expect(result).toEqual({
      content: [{ type: "text", text: "boom" }],
      isError: true,
    })
  })
})

describe("host target tool registration", () => {
  test("#given host tool #when registered for Pi #then target wrapper preserves execution and errors", async () => {
    // given
    const registered: Array<{ name: string; execute: (toolCallId: string, params: Record<string, unknown>) => Promise<unknown> }> = []
    const hostTool: HostToolDefinition<JsonObject> = {
      name: "echo_tool",
      label: "Echo",
      description: "Echoes the input",
      parameters: {},
      execute: async (request) => ({
        content: [{ type: "text", text: String(request.input.message) }],
      }),
    }

    // when
    const targetTool = registerTargetTool(
      {
        registerTool: (toolDefinition) => {
          registered.push({ name: toolDefinition.name, execute: toolDefinition.execute })
        },
      },
      hostTool,
      {
        host: "pi",
        parameters: { kind: "json-schema", schema: { type: "object", properties: { message: { type: "string" } } } },
        createSessionContext,
      },
    )

    // then
    expect(registered.map((item) => item.name)).toEqual(["echo_tool"])
    expect(targetTool.parameters).toMatchObject({ type: "object" })
    await expect(targetTool.execute("call-1", { message: "hello" })).resolves.toEqual({
      content: [{ type: "text", text: "hello" }],
      details: undefined,
      isError: undefined,
    })
  })

  test("#given host tool throws #when target wrapper executes #then harness receives a rejected execution", async () => {
    // given
    const hostTool: HostToolDefinition<JsonObject> = {
      name: "throw_tool",
      label: "Throw",
      description: "Throws",
      parameters: {},
      execute: async () => {
        throw new Error("target failure")
      },
    }

    // when
    const targetTool = registerTargetTool(
      { registerTool: () => {} },
      hostTool,
      {
        host: "oh-my-pi",
        parameters: { kind: "json-schema", schema: { type: "object", properties: {} } },
        createSessionContext,
      },
    )

    // then
    await expect(targetTool.execute("call-1", {})).rejects.toThrow("target failure")
  })

  test("#given host tool returns an error result #when target wrapper executes #then harness receives a rejected execution", async () => {
    // given
    const hostTool: HostToolDefinition<JsonObject> = {
      name: "error_result_tool",
      label: "Error Result",
      description: "Returns an error result",
      parameters: {},
      execute: async () => ({
        content: [{ type: "text", text: "invalid input" }],
        isError: true,
      }),
    }

    // when
    const targetTool = registerTargetTool(
      { registerTool: () => {} },
      hostTool,
      {
        host: "pi",
        parameters: { kind: "json-schema", schema: { type: "object", properties: {} } },
        createSessionContext,
      },
    )

    // then
    await expect(targetTool.execute("call-1", {})).rejects.toThrow("invalid input")
  })
})
