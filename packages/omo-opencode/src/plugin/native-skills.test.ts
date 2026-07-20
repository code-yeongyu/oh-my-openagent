import { describe, expect, test } from "bun:test"
import { unsafeTestValue } from "../../../../test-support/unsafe-test-value"
import { createNativeSkills, getPluginInputNativeSkills } from "./native-skills"
import type { PluginContext } from "./types"

describe("native skill accessor", () => {
  test("uses PluginContext.skills when the host exposes it directly", () => {
    const directNativeSkills = {
      all() { return [] },
      get() { return undefined },
      dirs() { return [] },
    }
    const ctx = unsafeTestValue<PluginContext>({ skills: directNativeSkills })

    const result = getPluginInputNativeSkills(ctx)

    expect(result).toBe(directNativeSkills)
  })

  test("loads native skills through the v2 app.skills method on the generated client", async () => {
    const calls: unknown[] = []
    const generatedClient = {
      async get(options: unknown) {
        calls.push(options)
        return {
          data: [{
            name: "customize-opencode",
            description: "Customize OpenCode",
            location: "/opencode/customize-opencode.md",
            content: "# Customizing opencode",
          }],
          request: new Request("http://localhost/skill"),
          response: new Response(null),
        }
      },
    }
    const nativeSkills = createNativeSkills({
      client: unsafeTestValue<PluginContext["client"]>({ _client: generatedClient }),
      directory: "/repo",
    })

    const result = await nativeSkills.all()

    expect(result).toEqual([{
      name: "customize-opencode",
      description: "Customize OpenCode",
      location: "/opencode/customize-opencode.md",
      content: "# Customizing opencode",
    }])
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({ url: "/skill", query: { directory: "/repo" } })
  })
})
