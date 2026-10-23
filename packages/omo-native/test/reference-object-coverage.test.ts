import { afterEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { planOpencodeAssets } from "../bin/lib/setup-opencode-assets.js"
import { planOpencodeProviders } from "../bin/lib/setup-opencode-providers.js"
import { teardownRoots } from "./teardown.test-support"

const roots: string[] = []

afterEach(() => teardownRoots(roots))

const SECRET = "{file:~/secret}"
const REFERENCE = { $file: "~/secret" }

function opencodeConfig(config: unknown): { home: string, env: Record<string, string> } {
  const root = mkdtempSync(join(tmpdir(), "omo-reference-coverage-"))
  roots.push(root)
  const home = join(root, "home")
  const configDir = join(root, "config", "opencode")
  mkdirSync(home, { recursive: true })
  mkdirSync(configDir, { recursive: true })
  writeFileSync(join(configDir, "opencode.json"), JSON.stringify(config, null, 2))
  return { home, env: { XDG_CONFIG_HOME: join(root, "config") } }
}

function mcpPlan(server: unknown) {
  const { home, env } = opencodeConfig({ mcp: { one: server } })
  return planOpencodeAssets({ home, env, referenceObjects: true })
}

function providerPlan(models: unknown) {
  const { home, env } = opencodeConfig({
    provider: {
      acme: { npm: "@ai-sdk/openai-compatible", options: { baseURL: "https://acme.test/v1" }, models },
    },
  })
  const plan = planOpencodeProviders({ home, env, referenceObjects: true })
  const provider = plan.providers.find((item: { id: string }) => item.id === "acme")
  return { models: provider?.config.models, notices: plan.notices.join("\n") }
}

// Every field that can hold a placeholder, and what the engine's own schema can hold it in.
//
// The rule is the same everywhere: a field the engine reads as a reference gets one, and a field
// it cannot refuses the value by name. Nothing is ever written out as literal placeholder text.
describe("every config field that can hold a placeholder", () => {
  describe("#given an mcp server whose remote env holds a {file:...}", () => {
    describe("#when the engine supports reference objects", () => {
      test("#then the env lands as a $file reference object, not the file's bytes", () => {
        const plan = mcpPlan({ type: "remote", url: "https://f.test/mcp", env: { TOKEN: SECRET } })

        expect(plan.mcpServers).toEqual([
          { name: "one", config: { type: "http", url: "https://f.test/mcp", env: { TOKEN: REFERENCE } } },
        ])
      })
    })
  })

  describe("#given an mcp server whose oauth scope holds a {file:...}", () => {
    describe("#when the engine supports reference objects", () => {
      test("#then the server is refused, because a scope list cannot hold a reference object", () => {
        const plan = mcpPlan({ type: "remote", url: "https://f.test/mcp", oauth: { scope: `read ${SECRET}` } })

        expect(plan.mcpServers).toEqual([])
        expect(plan.refusedServers.map((server: { name: string }) => server.name)).toEqual(["one"])
        expect(plan.notices.join("\n")).toContain("scope")
      })
    })
  })

  describe("#given a provider model whose apiKey holds a {file:...}", () => {
    describe("#when the engine supports reference objects", () => {
      test("#then the value is reported and not carried, because the engine's model entry has no apiKey field", () => {
        const plan = providerPlan({ m1: { options: { apiKey: SECRET } }, m2: { name: "Good" } })

        expect(JSON.stringify(plan.models)).not.toContain("secret")
        expect(plan.notices).toContain("m1")
        expect(plan.notices).toContain("apiKey")
      })
    })
  })

  describe("#given a provider model whose headers hold a {file:...}", () => {
    describe("#when the engine supports reference objects", () => {
      test("#then the value is reported and not carried, because the engine's model entry has no headers field", () => {
        const plan = providerPlan({ m1: { options: { headers: { "X-Model-Key": SECRET } } }, m2: { name: "Good" } })

        expect(JSON.stringify(plan.models)).not.toContain("secret")
        expect(plan.notices).toContain("m1")
        expect(plan.notices).toContain("headers")
      })
    })
  })

  describe("#given a provider model whose own baseUrl holds a {file:...}", () => {
    describe("#when the engine supports reference objects", () => {
      test("#then the model is refused, because a url field cannot hold a reference object", () => {
        const plan = providerPlan({ m1: { provider: { api: `https://acme.test/${SECRET}` } }, m2: { name: "Good" } })

        expect(plan.models).toEqual([{ id: "m2", name: "Good" }])
        expect(plan.notices).toContain("m1")
      })
    })
  })

  describe("#given a provider model whose name holds a {file:...}", () => {
    describe("#when the engine supports reference objects", () => {
      test("#then the model is refused, because a display name cannot hold a reference object", () => {
        const plan = providerPlan({ m1: { name: SECRET }, m2: { name: "Good" } })

        expect(plan.models).toEqual([{ id: "m2", name: "Good" }])
        expect(plan.notices).toContain("m1")
      })
    })
  })
})
