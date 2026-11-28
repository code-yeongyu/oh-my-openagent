import { describe, expect, test } from "bun:test"

import { ONBOARDING_SCAN_RUNTIME_FILE } from "./scan-component"
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

  // #15352: the tool text reaches the model; the import error names an absolute path under the user's home.
  test("#given consent and a sidecar that cannot load #when onboarding_understand runs #then it answers unavailable without the load error's text", async () => {
    const tools = createOnboardingMemoryTools({
      scan: async () => undefined,
      loadRuntime: async () => {
        throw new Error("Cannot find package 'x' imported from '/home/SYNTH-USER/plugin/extensions/omo.js'")
      },
    })

    const unavailable = await tools.understand.execute("u1", { consent: true }, undefined, undefined, {} as never)

    expect(unavailable.isError).toBe(true)
    expect(unavailable.content).toEqual([
      { type: "text", text: expect.stringContaining(`extensions/${ONBOARDING_SCAN_RUNTIME_FILE}`) },
    ])
    expect(JSON.stringify(unavailable.content)).not.toContain("SYNTH-USER")
  })
})
