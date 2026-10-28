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

// The provider entry omo writes to models.json, plus the key omo writes to auth.json.
function providerPlan(provider: Record<string, unknown>, models: Record<string, unknown> = {}) {
  const { home, env } = opencodeConfig({
    provider: {
      acme: { npm: "@ai-sdk/openai-compatible", options: { baseURL: "https://acme.test/v1", ...provider }, models },
    },
  })
  const plan = planOpencodeProviders({ home, env, referenceObjects: true })
  const entry = plan.providers.find((item: { id: string }) => item.id === "acme")
  return { entry, models: entry?.config.models, notices: plan.notices.join("\n") }
}

// The engine's reference shape, read off `packages/ai/src/utils/config-reference.ts` in the
// engine repository: `{$file: string}` (minLength 1), `{$env: string}` (an identifier), or
// `{$concat: Array<string | file | env>}`. Every object has exactly one key.
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/

function isEngineReference(value: unknown): boolean {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false
  const keys = Object.keys(value)
  if (keys.length !== 1) return false
  const [key] = keys
  const record = value as Record<string, unknown>
  if (key === "$file") return typeof record.$file === "string" && record.$file.length >= 1
  if (key === "$env") return typeof record.$env === "string" && ENV_NAME.test(record.$env)
  if (key === "$concat") {
    return (
      Array.isArray(record.$concat) &&
      record.$concat.every(
        (part) => typeof part === "string" || (typeof part === "object" && part !== null && !Array.isArray(part) && ("$file" in part || "$env" in part)),
      )
    )
  }
  return false
}

function collectReferences(value: unknown, found: unknown[] = []): unknown[] {
  if (typeof value === "object" && value !== null) {
    if (isEngineReference(value)) {
      found.push(value)
      return found
    }
    for (const item of Object.values(value)) collectReferences(item, found)
  }
  if (Array.isArray(value)) for (const item of value) collectReferences(item, found)
  return found
}

// Every field that can hold a placeholder, and what the engine's own schema can hold it in.
//
// The rule is the same everywhere: a field the engine reads as a reference gets one, and a field
// it cannot refuses the value by name. Nothing is ever written out as literal placeholder text.
//
// The slot list is the engine's, not ours. `mcp/config-references.js` names the mcp slots,
// `model-reference-origins.js` the models.json slots, `auth-credential-values.js` the auth.json
// slots; each test below names the file that declares the slot it exercises.
describe("every config field that can hold a placeholder", () => {
  describe("#given an mcp server whose args hold a {file:...}", () => {
    describe("#when the engine supports reference objects", () => {
      test("#then the arg lands as a $file reference object, because the engine's mcp slots include args[]", () => {
        const plan = mcpPlan({ type: "local", command: ["node", SECRET] })

        expect(plan.mcpServers).toEqual([
          { name: "one", config: { type: "stdio", command: "node", args: [REFERENCE] } },
        ])
      })
    })
  })

  describe("#given an mcp server whose remote env holds a {file:...}", () => {
    describe("#when the engine supports reference objects", () => {
      test("#then the env lands as a $file reference object, because the engine's mcp slots include env.*", () => {
        const plan = mcpPlan({ type: "remote", url: "https://f.test/mcp", env: { TOKEN: SECRET } })

        expect(plan.mcpServers).toEqual([
          { name: "one", config: { type: "http", url: "https://f.test/mcp", env: { TOKEN: REFERENCE } } },
        ])
      })
    })
  })

  describe("#given an mcp server whose headers hold a {file:...}", () => {
    describe("#when the engine supports reference objects", () => {
      test("#then the header lands as a $file reference object, because the engine's mcp slots include headers.*", () => {
        const plan = mcpPlan({ type: "remote", url: "https://f.test/mcp", headers: { "X-Token": SECRET } })

        expect(plan.mcpServers).toEqual([
          { name: "one", config: { type: "http", url: "https://f.test/mcp", headers: { "X-Token": REFERENCE } } },
        ])
      })
    })
  })

  describe("#given an mcp server whose url holds a {file:...}", () => {
    describe("#when the engine supports reference objects", () => {
      test("#then the server is refused, because a url field cannot hold a reference object", () => {
        const plan = mcpPlan({ type: "remote", url: `https://f.test/${SECRET}` })

        expect(plan.mcpServers).toEqual([])
        expect(plan.refusedServers.map((server: { name: string }) => server.name)).toEqual(["one"])
        expect(plan.notices.join("\n")).toContain("url")
      })
    })
  })

  describe("#given an mcp server whose executable holds a {file:...}", () => {
    describe("#when the engine supports reference objects", () => {
      test("#then the server is refused, because the command field cannot hold a reference object", () => {
        const plan = mcpPlan({ type: "local", command: [SECRET] })

        expect(plan.mcpServers).toEqual([])
        expect(plan.refusedServers.map((server: { name: string }) => server.name)).toEqual(["one"])
        expect(plan.notices.join("\n")).toContain("command")
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

  describe("#given a provider whose headers hold a {file:...}", () => {
    describe("#when the engine supports reference objects", () => {
      test("#then the header lands as a $file reference object, because the engine's provider slots include headers.*", () => {
        const plan = providerPlan({ headers: { "X-Provider-Key": SECRET } }, { m1: { name: "Good" } })

        expect(plan.entry?.config.headers).toEqual({ "X-Provider-Key": REFERENCE })
      })
    })
  })

  describe("#given a provider whose apiKey holds a {file:...}", () => {
    describe("#when the engine supports reference objects", () => {
      test("#then the key lands as a $file reference object, because the engine's auth slots include the provider key", () => {
        const plan = providerPlan({ apiKey: SECRET }, { m1: { name: "Good" } })

        expect(plan.entry?.key).toEqual({ key: REFERENCE, source: "opencode config apiKey" })
      })
    })
  })

  describe("#given a provider whose baseURL holds a {file:...}", () => {
    describe("#when the engine supports reference objects", () => {
      test("#then the provider is refused, because a url field cannot hold a reference object", () => {
        const plan = providerPlan({ baseURL: `https://acme.test/${SECRET}` }, { m1: { name: "Good" } })

        expect(plan.entry).toBeUndefined()
        expect(plan.notices).toContain("acme")
      })
    })
  })

  describe("#given a provider model whose apiKey holds a {file:...}", () => {
    describe("#when the engine supports reference objects", () => {
      test("#then the value is reported and not carried, because the engine's model entry has no apiKey field", () => {
        const plan = providerPlan({}, { m1: { options: { apiKey: SECRET } }, m2: { name: "Good" } })

        expect(JSON.stringify(plan.models)).not.toContain("secret")
        expect(plan.notices).toContain("m1")
        expect(plan.notices).toContain("apiKey")
      })
    })
  })

  describe("#given a provider model whose headers hold a {file:...}", () => {
    describe("#when the engine supports reference objects", () => {
      test("#then the header lands as a $file reference object, because the engine's model slots include headers.*", () => {
        const plan = providerPlan({}, { m1: { options: { headers: { "X-Model-Key": SECRET } } }, m2: { name: "Good" } })

        expect(plan.models).toEqual([
          { id: "m1", headers: { "X-Model-Key": REFERENCE } },
          { id: "m2", name: "Good" },
        ])
        expect(plan.notices).not.toContain("headers")
      })
    })
  })

  describe("#given a provider model whose own baseUrl holds a {file:...}", () => {
    describe("#when the engine supports reference objects", () => {
      test("#then the model is refused, because a url field cannot hold a reference object", () => {
        const plan = providerPlan({}, { m1: { provider: { api: `https://acme.test/${SECRET}` } }, m2: { name: "Good" } })

        expect(plan.models).toEqual([{ id: "m2", name: "Good" }])
        expect(plan.notices).toContain("m1")
      })
    })
  })

  describe("#given a provider model whose name holds a {file:...}", () => {
    describe("#when the engine supports reference objects", () => {
      test("#then the model is refused, because a display name cannot hold a reference object", () => {
        const plan = providerPlan({}, { m1: { name: SECRET }, m2: { name: "Good" } })

        expect(plan.models).toEqual([{ id: "m2", name: "Good" }])
        expect(plan.notices).toContain("m1")
      })
    })
  })

  describe("#given a config that produced reference objects", () => {
    describe("#when every one of them is read", () => {
      test("#then each one has the shape the engine's reference schema accepts", () => {
        const mcp = mcpPlan({ type: "local", command: ["node", SECRET], environment: { TOKEN: SECRET } })
        const provider = providerPlan({ apiKey: SECRET, headers: { "X-Provider-Key": SECRET } }, { m1: { options: { headers: { "X-Model-Key": SECRET } } } })
        const references = [
          ...collectReferences(mcp.mcpServers),
          ...collectReferences(provider.entry),
        ]

        expect(references.length).toBeGreaterThan(0)
        for (const reference of references) expect(isEngineReference(reference)).toBe(true)
      })
    })
  })
})
