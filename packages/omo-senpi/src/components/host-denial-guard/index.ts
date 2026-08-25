import type { ComponentContext, OmoSenpiComponent, SenpiExtensionAPI } from "../../extension/types"
import { isRecord, sanitizeAgentMessage } from "./sanitize"

/**
 * Guards the conversation against the senpi claude-sdk-oauth host-tool denial leak (#7115): the
 * lane's PreToolUse hook denies captured tools with an internal handoff instruction that surfaces
 * in assistant replies and persists into later turns. On message_end we swap the exact literal
 * for a neutral marker so no following tool turn ever sees it. Disable via the compose-registered
 * omo-senpi-host-denial-guard-disabled flag.
 */
export function createHostDenialGuardComponent(): OmoSenpiComponent {
  return {
    name: "host-denial-guard",
    register(pi: SenpiExtensionAPI, _ctx: ComponentContext): void {
      pi.on("message_end", (payload) => {
        if (!isRecord(payload)) {
          return undefined
        }
        return sanitizeAgentMessage(payload.message)
      })
    },
  }
}
