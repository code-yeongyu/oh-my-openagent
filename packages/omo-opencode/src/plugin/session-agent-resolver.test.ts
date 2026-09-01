import { describe, expect, test } from "bun:test"
import { resolveSessionAgent } from "./session-agent-resolver"

describe("resolveSessionAgent", () => {
  test("returns agent from first message with agent field", async () => {
    //#given
    const client = {
      session: {
        messages: async () => ({
          data: [
            { info: { role: "user" } },
            { info: { role: "assistant", agent: "explore" } },
            { info: { role: "assistant", agent: "oracle" } },
          ],
        }),
      },
    }

    //#when
    const agent = await resolveSessionAgent(client, "ses_test")

    //#then
    expect(agent).toBe("explore")
  })

  test("skips messages without agent field", async () => {
    //#given
    const client = {
      session: {
        messages: async () => ({
          data: [
            { info: { role: "user" } },
            { info: { role: "system" } },
            { info: { role: "assistant", agent: "plan" } },
          ],
        }),
      },
    }

    //#when
    const agent = await resolveSessionAgent(client, "ses_test")

    //#then
    expect(agent).toBe("plan")
  })

  test("returns undefined when no messages have agent", async () => {
    //#given
    const client = {
      session: {
        messages: async () => ({
          data: [
            { info: { role: "user" } },
            { info: { role: "assistant" } },
          ],
        }),
      },
    }

    //#when
    const agent = await resolveSessionAgent(client, "ses_test")

    //#then
    expect(agent).toBeUndefined()
  })

  test("returns undefined when session has no messages", async () => {
    //#given
    const client = {
      session: {
        messages: async () => ({ data: [] }),
      },
    }

    //#when
    const agent = await resolveSessionAgent(client, "ses_test")

    //#then
    expect(agent).toBeUndefined()
  })

  test("returns undefined when API call fails", async () => {
    //#given
    const client = {
      session: {
        messages: async () => { throw new Error("API error") },
      },
    }

    //#when
    const agent = await resolveSessionAgent(client, "ses_test")

    //#then
    expect(agent).toBeUndefined()
  })
})
