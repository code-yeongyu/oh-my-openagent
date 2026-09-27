import type { Plugin } from "@opencode/plugin"

import { log } from "../shared/logger"
import { setVersionCache } from "../shared/opencode-version"
import { createAdapterState } from "./adapter-state"
import { createV1PluginInput } from "./context-facade"
import { registerV1Hooks, type V1HookMap } from "./hook-bridge"
import { projectV1Surface } from "./project-config"

type V1Server = (input: never, options: unknown) => Promise<V1HookMap>

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

export async function setupOpenCodeV2(
  ctx: Plugin.Context,
  deps: {
    server: V1Server
    agentDirectory?: string
  },
): Promise<(() => Promise<void> | void) | void> {
  if (typeof ctx.app.version === "string" && ctx.app.version.length > 0) setVersionCache(ctx.app.version)
  const state = createAdapterState(`${ctx.location.directory}/.omo/v2-state`)
  const v1Input = createV1PluginInput(ctx, { state })
  let hooks: V1HookMap
  try {
    hooks = await deps.server(v1Input as never, ctx.options)
  } catch (error) {
    log("[oh-my-openagent] plugin startup failed", {
      error: error instanceof Error ? error.message : String(error),
    })
    throw error
  }

  if (!isRecord(hooks) || Object.keys(hooks).length === 0) {
    log("[oh-my-openagent] plugin startup returned no hooks")
    return
  }

  const stopEvents = await registerV1Hooks(ctx, hooks, state)
  const scratch: Record<string, unknown> = {}
  if (typeof hooks.config === "function") {
    try {
      await hooks.config(scratch)
    } catch (error) {
      log("[oh-my-openagent] config projection failed", {
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  try {
    await projectV1Surface({
      ctx,
      directory: v1Input.directory,
      config: scratch,
      tools: hooks.tool,
      defineTool: hooks["tool.definition"],
      commandBefore: typeof hooks["command.execute.before"] === "function"
        ? hooks["command.execute.before"] as (commandInput: { command: string; sessionID: string; arguments: string }, output: { parts: Array<{ type: string; text?: string }> }) => Promise<void>
        : undefined,
      ...(deps.agentDirectory ? { agentDirectory: deps.agentDirectory } : {}),
      recordTodos: { read: state.todos, write: state.recordTodos },
    })
  } catch (error) {
    log("[oh-my-openagent] domain projection failed", {
      error: error instanceof Error ? error.message : String(error),
    })
  }

  const dispose = hooks.dispose
  return async () => {
    stopEvents()
    if (typeof dispose === "function") await dispose()
  }
}
