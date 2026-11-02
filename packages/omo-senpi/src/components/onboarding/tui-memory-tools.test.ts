import { describe, expect, test } from "bun:test"

import { createOnboardingMemoryTools } from "./tui-memory-tools"

describe("TUI onboarding memory tools: lazy runtime", () => {
  test("#given no consent #when onboarding_understand runs #then it refuses without loading the onboarding sidecar", async () => {
    let loads = 0
    const tools = createOnboardingMemoryTools({
      scan: async () => undefined,
      loadRuntime: async () => {
        loads += 1
        throw new Error("sidecar missing")
      },
    })

    const refused = await tools.understand.execute("u0", {}, undefined, undefined, {} as never)

    expect(refused.isError).toBe(true)
    expect(loads).toBe(0)
  })

  test("#given consent and a sidecar that cannot load #when onboarding_understand runs #then it answers unavailable with the load reason", async () => {
    const tools = createOnboardingMemoryTools({
      scan: async () => undefined,
      loadRuntime: async () => {
        throw new Error("sidecar missing")
      },
    })

    const unavailable = await tools.understand.execute("u1", { consent: true }, undefined, undefined, {} as never)

    expect(unavailable.isError).toBe(true)
    expect(unavailable.content[0]).toMatchObject({ type: "text", text: expect.stringContaining("sidecar missing") })
  })
})
