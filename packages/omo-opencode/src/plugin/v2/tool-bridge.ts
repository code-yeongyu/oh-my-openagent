import { z } from "zod"
import { log } from "../../shared/logger"
import { sanitizeJsonSchema } from "../normalize-tool-arg-schemas"
import type { ToolDefinition } from "@opencode-ai/plugin"
import type {
  V2JsonSchema,
  V2ToolContent,
  V2ToolDefinition,
  V2ToolExecuteContext,
  V2ToolResult,
} from "./types"

/**
 * Tool bridge: convert a V1 `ToolDefinition` (zod raw-shape args, string-ish
 * results) into a V2 tool registration (JSON Schema input, Tool.Result).
 *
 * Input schema: V1 tools define zod raw shapes (`tool({ args: {...} })`).
 * `normalizeToolArgSchemas` (which the tool registry runs on every tool)
 * attaches a per-schema `_zod.toJSONSchema()` override backed by the plugin
 * package's own zod instance, and `sanitizeJsonSchema` strips keywords the
 * host rejects. That is the sanctioned conversion path; the local `z.toJSONSchema`
 * is only a fallback for definitions that skipped registry normalization.
 *
 * Code Mode: V2 sessions expose only tools registered with
 * `options.codemode: true` (verified live: builtin `read`/`shell`/`subagent`
 * and MCP-sourced tools carry codemode signatures). Without the flag our
 * tools load but never reach the model request.
 */

const JSON_SCHEMA_FALLBACK: V2JsonSchema = { type: "object", additionalProperties: true }

function isZodSchemaLike(value: unknown): value is z.ZodType {
  return value instanceof z.ZodType
}

/** A property is required when it rejects `undefined` (optional/default accept it). */
function isRequiredProperty(schema: unknown): boolean {
  if (!isZodSchemaLike(schema)) return false
  return !schema.safeParse(undefined).success
}

function convertPropertySchema(key: string, schema: unknown): unknown {
  if (isZodSchemaLike(schema)) {
    const override = (schema as unknown as { _zod?: { toJSONSchema?: () => unknown } })._zod?.toJSONSchema
    if (typeof override === "function") {
      try {
        return sanitizeJsonSchema(override.call((schema as unknown as { _zod: Record<string, unknown> })._zod))
      } catch {
        // fall through to the shared instance conversion
      }
    }
    try {
      return sanitizeJsonSchema(z.toJSONSchema(schema, { target: "draft-7" }))
    } catch {
      log("[v2-tool-bridge] property schema conversion failed; using permissive schema", {
        property: key,
      })
    }
  }
  return { type: "string" }
}

export function zodShapeToJsonSchema(tool: ToolDefinition): V2JsonSchema {
  const args = (tool as { args?: unknown }).args
  const shape = args as Record<string, unknown> | undefined
  if (!shape || typeof shape !== "object") {
    return JSON_SCHEMA_FALLBACK
  }
  const properties: Record<string, unknown> = {}
  const required: string[] = []
  for (const [key, schema] of Object.entries(shape)) {
    properties[key] = convertPropertySchema(key, schema)
    if (isRequiredProperty(schema)) required.push(key)
  }
  const schemaOut: Record<string, unknown> = {
    type: "object",
    properties,
    additionalProperties: false,
  }
  if (required.length > 0) schemaOut["required"] = required
  return schemaOut as V2JsonSchema
}

export function v1ResultToV2(
  result: string | { title?: string; output: string; metadata?: Record<string, unknown>; attachments?: Array<{ type: "file"; mime: string; url: string; filename?: string }> },
): V2ToolResult {
  if (typeof result === "string") return { content: result }
  const metadata: Record<string, unknown> = { ...(result.metadata ?? {}) }
  if (result.title) metadata["title"] = result.title
  const content: Array<V2ToolContent> = [{ type: "text", text: result.output }]
  for (const attachment of result.attachments ?? []) {
    content.push({
      type: "file",
      uri: attachment.url,
      mime: attachment.mime,
      ...(attachment.filename ? { name: attachment.filename } : {}),
    })
  }
  return { content, ...(Object.keys(metadata).length > 0 ? { metadata } : {}) }
}

export function toV2ToolDefinition(args: {
  readonly name: string
  readonly tool: ToolDefinition
  readonly directory: string
  readonly worktree: string
}): V2ToolDefinition {
  const { name, tool, directory, worktree } = args
  let abortController = new AbortController()
  const options: V2ToolDefinition["options"] = { codemode: true }
  return {
    name,
    description: tool.description,
    input: zodShapeToJsonSchema(tool),
    options,
    execute: async (input, v2Context: V2ToolExecuteContext) => {
      abortController = new AbortController()
      const v1Context = {
        sessionID: v2Context.sessionID,
        messageID: v2Context.messageID,
        agent: v2Context.agent,
        directory,
        worktree,
        abort: abortController.signal,
        metadata: (update: { title?: string; metadata?: Record<string, unknown> }): void => {
          void v2Context.progress(update).catch(() => {})
        },
        ask: async (): Promise<void> => {
          log("[v2-tool-bridge] ToolContext.ask() has no V2 equivalent; ignoring permission request", {
            tool: name,
          })
        },
      }
      const result = await tool.execute(input as never, v1Context as never)
      return v1ResultToV2(result)
    },
  }
}
