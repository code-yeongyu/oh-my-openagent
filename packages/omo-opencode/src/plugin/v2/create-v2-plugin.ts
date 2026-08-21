import { appendFileSync } from "node:fs"
import { isRecord } from "@oh-my-opencode/utils"
import { log } from "../../shared/logger"
import type { V2BusEvent, V2Plugin, V2PluginContext, V2Registration } from "./types"

const PLUGIN_ID = "oh-my-openagent"

/**
 * QA affordance: when OMO_V2_SETUP_LOG points at a writable file, every v2
 * setup appends one JSON line there. Gives real-surface proof that the host
 * loaded and ran this plugin even when other logging channels are unclear.
 */
function writeSetupMarker(app: V2PluginContext["app"]): void {
  const markerPath = process.env.OMO_V2_SETUP_LOG
  if (!markerPath) return
  try {
    appendFileSync(markerPath, `${JSON.stringify({ event: "v2-setup", id: PLUGIN_ID, app })}\n`)
  } catch {
    // diagnostics only; never fail setup over the marker
  }
}

/**
 * Strips the mcp_ prefix the model may emit for registry tools
 * (mirrors the v1 tool-execute-before normalization, fixes #2697).
 */
function stripMcpPrefix(tool: string): string {
  return /^mcp_/i.test(tool) ? tool.replace(/^mcp_/i, "") : tool
}

function sanitizeBeforeEvent(event: { tool: string; input: unknown }): void {
  event.tool = stripMcpPrefix(event.tool)

  if (event.tool !== "bash" || !isRecord(event.input)) return

  const command = event.input.command
  if (typeof command === "string" && command.includes("\x00")) {
    event.input = { ...event.input, command: command.replace(/\x00/g, "") }
    log("[v2-tool-before] Stripped null bytes from bash command")
  }
}

async function pumpEvents(stream: AsyncIterable<V2BusEvent>): Promise<void> {
  try {
    for await (const event of stream) {
      log("[v2-event]", { type: event.type })
    }
  } catch (error) {
    log("[v2-event] stream terminated", { error: String(error) })
  }
}

async function registerDomain(domain: string, register: () => Promise<void>): Promise<boolean> {
  try {
    await register()
    return true
  } catch (error) {
    log(`[v2-setup] ${domain} registration failed; continuing without it`, { error: String(error) })
    return false
  }
}

/**
 * Builds the oh-my-openagent entry module for the OpenCode v2 beta plugin API.
 *
 * The v2 host requires a plain `{ id, setup }` object export (verified in SP1:
 * function exports and hybrid exports are silently ignored), so this factory
 * exists separately from the v1 `serverPlugin()` function module.
 */
export function createV2PluginModule(): V2Plugin {
  return {
    id: PLUGIN_ID,
    setup: async (context: V2PluginContext) => {
      writeSetupMarker(context.app)
      const disposables: Array<() => Promise<void> | void> = []
      let disposed = false

      const track = (registration: V2Registration): void => {
        disposables.push(registration.dispose)
      }

      await registerDomain("tool", async () => {
        const beforeRegistration = await context.tool.hook("execute.before", (event) => {
          sanitizeBeforeEvent(event)
        })
        track(beforeRegistration)

        const afterRegistration = await context.tool.hook("execute.after", (event) => {
          if (event.status === "error") return
        })
        track(afterRegistration)
      })

      await registerDomain("event", async () => {
        const stream = context.event.subscribe()
        void pumpEvents(stream)
      })

      log("[v2-setup] oh-my-openagent v2 plugin initialized", {
        hostVersion: context.app.version,
        channel: context.app.channel,
      })

      return async () => {
        if (disposed) return
        disposed = true
        for (const dispose of [...disposables].reverse()) {
          try {
            await dispose()
          } catch (error) {
            log("[v2-dispose] registration disposal failed", { error: String(error) })
          }
        }
      }
    },
  }
}
