import { describe, expect, it, mock } from "bun:test"
import { unsafeTestValue } from "../../../../../test-support/unsafe-test-value"
import { loadAgentProfileColors } from "./agent-profile-colors"

describe("loadAgentProfileColors", () => {
  it("returns an empty color map when agent profile loading fails with an Error", async () => {
    // given
    const client = unsafeTestValue<Parameters<typeof loadAgentProfileColors>[0]>({
      app: {
        agents: mock(async () => {
          throw new Error("agent profiles unavailable")
        }),
      },
    })

    // when
    const colors = await loadAgentProfileColors(client)

    // then
    expect(colors).toEqual({})
  })

  it("rethrows non-Error agent profile failures", async () => {
    // given
    const thrown = Object.freeze({ reason: "agent profiles unavailable" })
    const client = unsafeTestValue<Parameters<typeof loadAgentProfileColors>[0]>({
      app: {
        agents: mock(async () => {
          throw thrown
        }),
      },
    })

    // when & then
    await expect(loadAgentProfileColors(client)).rejects.toBe(thrown)
  })
})
