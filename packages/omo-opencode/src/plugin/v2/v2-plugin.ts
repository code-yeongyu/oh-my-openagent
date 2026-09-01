import { log } from "../../shared/logger"
import { createCompatPluginInput } from "./compat-context"
import { registerV2Agents } from "./agent-bridge"
import { registerV2Commands } from "./command-bridge"
import { bridgeV2EventStream } from "./event-bridge"
import { registerV2McpServers } from "./mcp-bridge"
import { registerV2SessionHooks } from "./session-hook-bridge"
import { registerV2ToolHooks } from "./tool-hook-bridge"
import { toV2ToolDefinition } from "./tool-bridge"
import type { ToolsRecord } from "../types"
import type { Hooks } from "@opencode-ai/plugin"
import type { V2Plugin, V2PluginContext, V2Registration } from "./types"

/**
 * The V2 plugin setup. One object, exported from the same dist entry as the
 * V1 module, so a single published package serves both hosts:
 *
 * - V1 (`opencode`) loads `.server(input)`.
 * - V2 (`opencode2`) loads `.setup(ctx)`.
 *
 * Setup stages:
 * 1. Build a compat V1 `PluginInput` from the V2 context (client facade).
 * 2. Run the existing staged init pipeline (createPluginModule().server) to
 *    get the composed V1 hook handlers back.
 * 3. Replay the config handler on a synthetic config document to harvest the
 *    agent/MCP/command registrations, then register them through V2 drafts.
 * 4. Register the V1 tool record through the V2 tool draft.
 * 5. Bridge V2 session/tool hooks into the V1 handlers.
 * 6. Subscribe to the V2 event stream and feed the V1 event handler.
 * 7. Cleanup: dispose registrations, abort the event loop, call V1 dispose.
 */

type V1HooksWithDispose = Hooks & { dispose?: () => Promise<void> | void }

export type V2SetupDependencies = {
  readonly startV1ServerPlugin: (input: unknown) => Promise<Hooks>
}

export async function runV2Setup(
  v2: V2PluginContext,
  deps: V2SetupDependencies,
): Promise<() => Promise<void> | void> {
  const compatInput = createCompatPluginInput(v2)
  log("[v2-setup] starting OpenCode V2 bridge", {
    directory: compatInput.directory,
    app: v2.app.version,
  })

  const hooks = (await deps.startV1ServerPlugin(compatInput)) as V1HooksWithDispose

  const registrations: Array<V2Registration> = []
  const disposeRegistrations = async (): Promise<void> => {
    for (const registration of registrations.splice(0)) {
      try {
        await registration.dispose()
      } catch (error) {
        log("[v2-setup] registration dispose failed", {
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }
  }

  try {
    // 3a. Agents + MCP + commands: replay the config handler on a synthetic
    // config document. The V1 handler mutates the document in place.
    if (hooks.config) {
      const syntheticConfig: Record<string, unknown> = {}
      await hooks.config(syntheticConfig)
      const agentMap = (syntheticConfig["agent"] as Record<string, Record<string, unknown>>) ?? {}
      await registerV2Agents({
        ctx: v2,
        v1Agents: agentMap,
        defaultAgent:
          typeof syntheticConfig["default_agent"] === "string"
            ? (syntheticConfig["default_agent"] as string)
            : undefined,
      })
      const mcpMap = (syntheticConfig["mcp"] as Record<string, Record<string, unknown>>) ?? {}
      await registerV2McpServers({ ctx: v2, v1Mcp: mcpMap })
      const commandMap = (syntheticConfig["command"] as Record<string, Record<string, unknown>>) ?? {}
      await registerV2Commands({ ctx: v2, v1Commands: commandMap })
    }

    // 4. Tools.
    const tools = (hooks.tool ?? {}) as ToolsRecord
    await v2.tool.transform((draft) => {
      for (const [name, tool] of Object.entries(tools)) {
        draft.add(
          toV2ToolDefinition({
            name,
            tool,
            directory: compatInput.directory,
            worktree: compatInput.worktree,
          }),
        )
      }
    })

    // 5. Runtime hooks.
    registrations.push(...(await registerV2SessionHooks({ ctx: v2, hooks })))
    registrations.push(...(await registerV2ToolHooks({ ctx: v2, hooks })))

    // 6. Event stream.
    const eventController = new AbortController()
    const eventHandler = hooks.event as
      | ((input: { event: unknown }) => Promise<void>)
      | undefined
    if (eventHandler) {
      const consume = bridgeV2EventStream({
        ctx: v2,
        onEvent: (event) => eventHandler({ event }),
        signal: eventController.signal,
      })
      void consume.catch((error: unknown) => {
        if (eventController.signal.aborted) return
        log("[v2-setup] event stream ended", {
          error: error instanceof Error ? error.message : String(error),
        })
      })
    }

    return async () => {
      eventController.abort()
      await disposeRegistrations()
      try {
        await hooks.dispose?.()
      } catch (error) {
        log("[v2-setup] V1 dispose failed", {
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }
  } catch (error) {
    await disposeRegistrations()
    throw error
  }
}

export function defineV2Plugin(args: {
  readonly id: string
  readonly startV1ServerPlugin: (input: unknown) => Promise<Hooks>
}): V2Plugin {
  return {
    id: args.id,
    setup: (context: V2PluginContext) => runV2Setup(context, { startV1ServerPlugin: args.startV1ServerPlugin }),
  }
}
