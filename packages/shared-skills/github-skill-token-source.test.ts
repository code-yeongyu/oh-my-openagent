import { describe, expect, test } from "bun:test"
import { createClient } from "./skills/github/scripts/sdk.ts"

const userResponse = () =>
  new Response(JSON.stringify({ login: "octo", name: "Octo Cat" }), {
    status: 200,
    headers: { "content-type": "application/json" },
  })

describe("github skill auth.status", () => {
  test("#given a token provider passed to createClient #when auth.status runs #then the token source is injected, whatever the environment holds", async () => {
    // given
    const client = createClient({
      token: () => Promise.resolve("ghp_injected_test_token"),
      fetch: () => Promise.resolve(userResponse()),
    })

    // when
    const status = await client.auth.status({})

    // then
    expect(status.tokenSource).toBe("injected")
    expect(JSON.stringify(status)).not.toContain("ghp_injected_test_token")
  })
})
