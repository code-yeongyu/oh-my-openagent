import { tool, type ToolContext, type ToolDefinition, type ToolResult } from "@opencode-ai/plugin/tool"
import type { V2ToolContent, V2ToolExecuteContext, V2ToolInfo, V2ToolResult } from "./context-types"
import { toJsonRecord } from "./json-record"

export type ToolBridgeDeps = {
  readonly directory: string
  readonly worktree: string
  readonly warn: (message: string) => void
}

function toV2Result(result: ToolResult, warn: (message: string) => void): V2ToolResult {
  if (typeof result === "string") return { content: result }
  const merged =
    result.title === undefined && result.metadata === undefined
      ? undefined
      : { ...(result.title === undefined ? {} : { title: result.title }), ...result.metadata }
  const metadata = merged === undefined ? undefined : toJsonRecord(merged)
  if (merged !== undefined && metadata === undefined) warn("a tool returned result metadata that cannot be serialised; it was dropped")
  const files: V2ToolContent[] = (result.attachments ?? []).map((attachment) => ({
    type: "file",
    uri: attachment.url,
    mime: attachment.mime,
    ...(attachment.filename === undefined ? {} : { name: attachment.filename }),
  }))
  const content = files.length === 0 ? result.output : [{ type: "text" as const, text: result.output }, ...files]
  return { content, ...(metadata === undefined ? {} : { metadata }) }
}

function toV1Context(name: string, context: V2ToolExecuteContext, deps: ToolBridgeDeps): ToolContext {
  return {
    sessionID: context.sessionID,
    messageID: context.messageID,
    agent: context.agent,
    directory: deps.directory,
    worktree: deps.worktree,
    abort: context.signal,
    metadata: (input) => {
      const update = toJsonRecord({ ...(input.title === undefined ? {} : { title: input.title }), ...input.metadata })
      if (update === undefined) {
        deps.warn(`tool "${name}" reported metadata that cannot be serialised; the progress update was skipped`)
        return
      }
      void (async () => context.progress(update))().catch((error: unknown) => {
        deps.warn(`tool "${name}" progress update was rejected: ${error instanceof Error ? error.message : String(error)}`)
      })
    },
    ask: async () => {
      deps.warn("ToolContext.ask is not enforced on OpenCode 2.x: the plugin has no permission prompt API there")
    },
  }
}

type FieldSchema = ToolDefinition["args"][string]

/**
 * The registry attaches a `_zod.toJSONSchema` override to every argument schema so 1.x's host can
 * convert them with its own zod (normalize-tool-arg-schemas.ts). Those overrides re-enter
 * `toJSONSchema` per field, which breaks conversion of the whole object ("seen.ref"), so they are
 * lifted while the object schema is generated and put back afterwards.
 */
function withoutFieldOverrides<T>(fields: ReadonlyArray<FieldSchema>, run: () => T): T {
  const lifted: Array<readonly [FieldSchema, () => unknown]> = []
  for (const field of fields) {
    const override = (field._zod as { toJSONSchema?: () => unknown }).toJSONSchema
    if (override === undefined) continue
    lifted.push([field, override])
    delete (field._zod as { toJSONSchema?: () => unknown }).toJSONSchema
  }
  try {
    return run()
  } finally {
    for (const [field, override] of lifted) (field._zod as { toJSONSchema?: () => unknown }).toJSONSchema = override
  }
}

/**
 * zod 4.2 and later return generated JSON Schema with a hidden, non-enumerable `~standard` member.
 * OpenCode 2.x tests `"~standard" in input`, takes the object for a Standard Schema and converts it
 * again with its own bundled zod, which throws. A JSON round trip leaves plain data only.
 */
export function toPlainJsonSchema(schema: unknown): Record<string, unknown> {
  return JSON.parse(JSON.stringify(schema)) as Record<string, unknown>
}

function describeIssues(error: { readonly issues: ReadonlyArray<{ readonly path: ReadonlyArray<PropertyKey>; readonly message: string }> }): string {
  return error.issues.map((issue) => `${issue.path.map(String).join(".") || "root"}: ${issue.message}`).join("; ")
}

/**
 * Converts one V1 tool into a 2.x tool.
 *
 * The input is plain JSON Schema generated here, not the zod object itself. OpenCode 2.0.28 converts
 * a zod input with its own bundled zod 4.1.8, and that conversion throws on schemas built by this
 * package's newer zod ("undefined is not an object (evaluating 'seen.ref')"), which makes the host
 * drop the tool. The original zod schema still parses the arguments before `execute`, so defaults
 * and transforms behave as they did on 1.x.
 *
 * `codemode: false` keeps the tool directly callable by name, as on 1.x, instead of folding it
 * behind 2.x's CodeMode `execute` tool.
 */
export function toV2Tool(name: string, definition: ToolDefinition, deps: ToolBridgeDeps): V2ToolInfo {
  const schema = tool.schema.object(definition.args)
  return {
    name,
    description: definition.description,
    input: toPlainJsonSchema(
      withoutFieldOverrides(Object.values(definition.args), () =>
        tool.schema.toJSONSchema(schema, { io: "input", unrepresentable: "any" }),
      ),
    ),
    options: { codemode: false },
    execute: async (rawInput, context) => {
      const parsed = schema.safeParse(rawInput)
      if (!parsed.success) throw new Error(`Invalid arguments for tool "${name}": ${describeIssues(parsed.error)}`)
      return toV2Result(await definition.execute(parsed.data, toV1Context(name, context, deps)), (message) => deps.warn(`tool "${name}": ${message}`))
    },
  }
}
