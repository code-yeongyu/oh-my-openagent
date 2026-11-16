import { afterEach, describe, expect, test } from "bun:test"
import { canonicalizeThreadHandle } from "./seams"
import { clientOn, closeClients, failureOf, fakeClock, startOwner } from "./testing/fake-service"

// The account's alias registry is reached with the CLI sign-in (an origin and a refreshing bearer token), which this
// client is not given; every alias member says so as data instead of guessing.

afterEach(closeClients)

describe("aliases", () => {
  test("#given a client without account access #when resolve, set or clear is called #then each answers unsupported{aliases} naming the missing service access", async () => {
    const owner = await startOwner()
    const client = clientOn(owner.stateDir, fakeClock())
    const parsed = canonicalizeThreadHandle("dev-self/s-1", {})
    if (parsed.kind !== "ok") throw new Error("a device/session address parses")
    const thread = parsed.value.handle

    const answers = [
      await client.aliases.resolve("build"),
      await client.aliases.set(thread, "build"),
      await client.aliases.clear(thread),
    ]

    for (const answer of answers)
      expect(failureOf(answer)).toMatchObject({
        code: "unsupported",
        details: { feature: "aliases", missing: "service_access" },
      })
  })
})
