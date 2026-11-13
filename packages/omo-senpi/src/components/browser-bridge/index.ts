import type { ComponentContext, OmoSenpiComponent, SenpiExtensionAPI } from "../../extension/types"

export const BROWSER_BRIDGE_TOOL_NAME = "omo_browser_bridge"
export const BROWSER_STATE_EVENT = "omo.browser.state"
export const BROWSER_STOP_RPC = "omo.browser.stop"

const PARAMETERS = {
  type: "object",
  properties: {
    op: { type: "string", enum: ["state", "status", "stopped"] },
    data: { type: "object", additionalProperties: true },
  },
  required: ["op"],
  additionalProperties: false,
} as const

interface BridgeInput {
  readonly op?: unknown
  readonly data?: unknown
}

function isStatePayload(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false
  const { engine, status } = value as Record<string, unknown>
  return typeof engine === "string" && typeof status === "string"
}

function reply(details: Record<string, unknown>) {
  return { content: [{ type: "text", text: JSON.stringify(details) }], details }
}

/**
 * The browser skill's channel to the app, one instance per session. The skill runs in an eval cell
 * and cannot publish a session event or hear the app's Stop itself, so it calls this eval-only tool:
 * `state` republishes a browser state as `omo.browser.state`, `stopped` records that the user
 * stopped browser use, and `status` reports whether they did. The app's Stop arrives as the
 * `omo.browser.stop` request and holds until the user sends their next message.
 */
export function createBrowserBridgeComponent(): OmoSenpiComponent {
  return {
    name: "browser-bridge",
    register(pi: SenpiExtensionAPI, _ctx: ComponentContext): void {
      let stopped = false

      pi.registerTool({
        name: BROWSER_BRIDGE_TOOL_NAME,
        label: "Browser bridge",
        description:
          "Internal channel for the browser skill: publish browser state to the app and read whether the user stopped browser use. Not for direct use.",
        parameters: PARAMETERS,
        exposure: "eval",
        permissionParser: () => [],
        executionMode: "parallel",
        async execute(_toolCallId: string, params: BridgeInput) {
          if (params.op === "state") {
            if (!isStatePayload(params.data)) return reply({ ok: false, stopped, reason: "invalid_state" })
            pi.rpc?.emit(BROWSER_STATE_EVENT, params.data)
            return reply({ ok: true, stopped })
          }
          if (params.op === "stopped") {
            stopped = true
            return reply({ ok: true, stopped })
          }
          return reply({ ok: true, stopped })
        },
      })

      pi.rpc?.handle?.(BROWSER_STOP_RPC, () => {
        stopped = true
        return { stopped }
      })

      pi.on("input", (payload: unknown) => {
        const source = (payload as { source?: unknown } | null)?.source
        if (source !== "extension") stopped = false
        return undefined
      })
    },
  }
}
