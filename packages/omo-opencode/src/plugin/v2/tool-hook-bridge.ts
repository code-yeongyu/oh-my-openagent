import type { Hooks } from "@opencode-ai/plugin"
import { log } from "../../shared/logger"
import type { V2PluginContext, V2ToolHookAfter, V2ToolHookBefore } from "./types"

/**
 * Tool-hook bridge: wire V2 `tool.hook("execute.before"/"execute.after")`
 * into the V1 `"tool.execute.before"` / `"tool.execute.after"` handlers.
 *
 * Shape mapping:
 * - before: V2 `{ tool, sessionID, callID: id, input }` -> V1
 *   `{ tool, sessionID, callID, args }`; the V1 handler mutates
 *   `output.args`, and V2 event input is mutable, so we assign back.
 * - after: V1 mutates `output.{title,output,metadata}`; V2 exposes
 *   `result.{content,metadata}`. Text content is rebuilt from the V1 output
 *   string; the title lands in result metadata.
 */

type AnyHookFn = (input: unknown, output: unknown) => Promise<void>

type V1Hooks = {
  "tool.execute.before"?: AnyHookFn
  "tool.execute.after"?: AnyHookFn
}

function pickV1Hooks(hooks: Hooks, names: ReadonlyArray<keyof V1Hooks>): V1Hooks {
  const picked: V1Hooks = {}
  for (const name of names) {
    const handler = (hooks as Record<string, unknown>)[name]
    if (typeof handler === "function") {
      ;(picked as Record<string, unknown>)[name] = handler
    }
  }
  return picked
}

export async function registerV2ToolHooks(args: {
  readonly ctx: V2PluginContext
  readonly hooks: Hooks
}): Promise<Array<{ dispose: () => Promise<void> }>> {
  const hooks = pickV1Hooks(args.hooks, ["tool.execute.before", "tool.execute.after"])
  const { ctx } = args
  const registrations: Array<{ dispose: () => Promise<void> }> = []

  if (hooks["tool.execute.before"]) {
    const before = hooks["tool.execute.before"]
    registrations.push(
      await ctx.tool.hook("execute.before", async (event: V2ToolHookBefore) => {
        const v1Input = { tool: event.tool, sessionID: event.sessionID, callID: event.id }
        const v1Output = { args: (event.input ?? {}) as Record<string, unknown> }
        try {
          await before(v1Input, v1Output)
        } catch (error) {
          log("[v2-tool-bridge] execute.before bridge failed", {
            tool: event.tool,
            error: error instanceof Error ? error.message : String(error),
          })
          return
        }
        event.input = v1Output.args
      }),
    )
  }

  if (hooks["tool.execute.after"]) {
    const after = hooks["tool.execute.after"]
    registrations.push(
      await ctx.tool.hook("execute.after", async (event: V2ToolHookAfter) => {
        if (event.status !== "completed" || !event.result) return
        const v1Input = {
          tool: event.tool,
          sessionID: event.sessionID,
          callID: event.id,
          args: (event.input ?? {}) as Record<string, unknown>,
        }
        const result = event.result
        const previousContent =
          typeof result.content === "string"
            ? result.content
            : Array.isArray(result.content)
              ? result.content
                  .filter((part) => part.type === "text" && typeof part.text === "string")
                  .map((part) => part.text as string)
                  .join("\n")
              : ""
        const v1Output = {
          title: "",
          output: previousContent,
          metadata: { ...(result.metadata ?? {}) },
        }
        try {
          await after(v1Input, v1Output)
        } catch (error) {
          log("[v2-tool-bridge] execute.after bridge failed", {
            tool: event.tool,
            error: error instanceof Error ? error.message : String(error),
          })
          return
        }
        const nextResult: { content?: string | ReadonlyArray<{ type: "text"; text: string }>; metadata?: Record<string, unknown> } = {}
        if (v1Output.output !== previousContent) {
          nextResult.content = v1Output.output
        }
        if (Object.keys(v1Output.metadata).length > 0) {
          nextResult.metadata = v1Output.metadata
        }
        if (nextResult.content !== undefined || nextResult.metadata !== undefined) {
          event.result = { ...result, ...nextResult }
        }
      }),
    )
  }

  return registrations
}
