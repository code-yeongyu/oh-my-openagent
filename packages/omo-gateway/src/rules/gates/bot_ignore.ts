import type { InboundEvent } from "../../adapter/contract"
import { booleanParam, OK, stringListParam, type InboundGate } from "./types"

function isAgentAccount(event: InboundEvent, accounts: readonly string[]): boolean {
  const id = event.author.platform_user_id
  return accounts.some((entry) => entry === `${event.key.platform}:${id}` || (!entry.includes(":") && entry === id))
}

// Loop guard before admission: bots, posts carrying another gateway's marker and configured agent
// accounts never start or steer work. A refusal here is a logged drop, never a silent one.
export const gate: InboundGate = {
  id: "bot_ignore",
  phase: "inbound",
  run(event, params, ctx) {
    const accounts = [...stringListParam(params, "agent_accounts", []), ...(ctx.agent_accounts ?? [])]
    if (event.author.is_bot) return { refuse: `ignored: ${event.author.display} is a bot` }
    if (event.gateway_marker && booleanParam(params, "honor_gateway_marker", true)) {
      return { refuse: "ignored: the message carries another gateway's marker" }
    }
    if (isAgentAccount(event, accounts)) return { refuse: `ignored: ${event.author.display} is a listed agent account` }
    return OK
  },
}
