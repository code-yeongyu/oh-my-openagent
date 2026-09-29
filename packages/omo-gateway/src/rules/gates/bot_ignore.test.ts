import { describe, expect, it } from "bun:test"
import { gate } from "./bot_ignore"
import { eventOf } from "./testing"

const params = { agent_accounts: ["slack:U000OTHERBOT"], honor_gateway_marker: true }

describe("bot_ignore gate", () => {
  it("#given a human message #when run #then it passes", async () => {
    expect(await gate.run(eventOf(), params, {})).toEqual({ ok: true })
  })

  it("#given a bot, a gateway marker or a listed agent account #when run #then each is refused with a reason", async () => {
    const bot = eventOf({ author: { platform_user_id: "B1", display: "ci", is_bot: true } })
    const marked = eventOf({ gateway_marker: true })
    const agent = eventOf({ author: { platform_user_id: "U000OTHERBOT", display: "other", is_bot: false } })
    const configured = eventOf({ author: { platform_user_id: "U000CFG", display: "cfg", is_bot: false } })
    expect(await gate.run(bot, params, {})).toEqual({ refuse: "ignored: ci is a bot" })
    expect(await gate.run(marked, params, {})).toHaveProperty("refuse")
    expect(await gate.run(agent, params, {})).toHaveProperty("refuse")
    expect(await gate.run(configured, params, { agent_accounts: ["slack:U000CFG"] })).toHaveProperty("refuse")
  })

  it("#given honor_gateway_marker false #when a marked human message arrives #then it passes", async () => {
    expect(await gate.run(eventOf({ gateway_marker: true }), { honor_gateway_marker: false }, {})).toEqual({ ok: true })
  })
})
