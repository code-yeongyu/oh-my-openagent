import { expect, test } from "bun:test"
import { documentedCapabilities } from "../../adapter/docs-matrix"
import { DiscordAdapter } from "./adapter"

const adapter = (guild_id?: string) => new DiscordAdapter({ account_id: "100000000000000001", token: "fake-token", ...(guild_id === undefined ? {} : { guild_id }) })

test("the Discord rows of the platform matrix equal the adapter's Capabilities with and without a guild", () => {
  expect(documentedCapabilities("Discord (bot, with `guild_id`)")).toEqual(adapter("200000000000000001").capabilities())
  expect(documentedCapabilities("Discord (bot, without `guild_id`)")).toEqual(adapter().capabilities())
})
