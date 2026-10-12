import { afterEach, expect, test } from "bun:test"
import type { PluginInput } from "@opencode-ai/plugin"
import { createPluginInterface } from "../plugin-interface"
import { createSisyphusAgent } from "../agents/sisyphus"
import { createOracleAgent } from "../agents/oracle"
import { clearSisyphusRuntimePromptContext } from "../agents/sisyphus-runtime-prompt-reconciler"
import { createGrepTools } from "../tools/grep/tools"
import { createGlobTools } from "../tools/glob/tools"
import { interactive_bash } from "../tools/interactive-bash/tools"

afterEach(clearSisyphusRuntimePromptContext)

function createHarness(sessionRead: "ok" | "throw" | "malformed" = "ok") {
  const sessionPermissions = new Map<string, Array<{ permission: string; pattern: string; action: "allow" | "ask" | "deny" }>>()
  const ctx = {
    directory: "/workspace",
    client: { session: { get: async ({ path }: { path: { id: string } }) => {
      if (sessionRead === "throw") throw new Error("Session metadata unavailable")
      if (sessionRead === "malformed") return { data: { permission: "invalid" } }
      return { data: { permission: sessionPermissions.get(path.id) ?? [] } }
    } } },
  } as unknown as PluginInput
  const tools = { ...createGrepTools(ctx), ...createGlobTools(ctx), interactive_bash }
  const api = createPluginInterface({
    ctx,
    pluginConfig: {},
    hooks: {},
    managers: {
      configHandler: async (config: Record<string, unknown>) => {
        config.agent = {
          sisyphus: createSisyphusAgent("anthropic/claude-opus-5-5"),
          oracle: createOracleAgent("anthropic/claude-opus-5-5"),
        }
      },
    },
    tools,
    firstMessageVariantGate: {},
  } as Parameters<typeof createPluginInterface>[0])
  return { api, tools, sessionPermissions }
}

test("production registration includes the real registered names and descriptions", async () => {
  const { api, tools } = createHarness()
  const config: Parameters<NonNullable<typeof api.config>>[0] = {}
  await api.config!(config)
  for (const agent of Object.values(config.agent ?? {})) {
    expect(agent.prompt).toContain("- interactive_bash: " + tools.interactive_bash.description)
    expect(agent.prompt).not.toContain("## Available Tools\n\n(none)")
  }
  expect(config.agent!.oracle!.prompt).toContain("- grep: " + tools.grep.description)
  expect(config.agent!.oracle!.prompt).toContain("- glob: " + tools.glob.description)
  expect(config.agent!.sisyphus!.prompt).not.toContain("- grep: " + tools.grep.description)
  expect(config.agent!.sisyphus!.prompt).not.toContain("- glob: " + tools.glob.description)
})

test("host definitions refresh the core without a model switch and retain agent restrictions", async () => {
  const { api } = createHarness()
  const config: Parameters<NonNullable<typeof api.config>>[0] = {}
  await api.config!(config)
  await api["tool.definition"]!({ toolID: "read" }, { description: "HOST_READ_DESCRIPTION", parameters: {} })
  await api["tool.definition"]!({ toolID: "write" }, { description: "HOST_WRITE_DESCRIPTION", parameters: {} })
  await api["tool.definition"]!({ toolID: "invalid" }, { description: "HOST_INVALID_HANDLER", parameters: {} })
  const original = config.agent!.oracle!.prompt!
  const output = { system: [original] }
  await api["experimental.chat.system.transform"]!(
    { model: { providerID: "anthropic", id: "claude-opus-5-5" } } as Parameters<NonNullable<typeof api["experimental.chat.system.transform"]>>[0],
    output,
  )
  expect(output.system[0]).toContain("- read: HOST_READ_DESCRIPTION")
  expect(output.system[0]).not.toContain("- write: HOST_WRITE_DESCRIPTION")
  expect(output.system[0]).not.toContain("HOST_INVALID_HANDLER")
  const roleMarker = "\n</omo-model-core>\n\n"
  expect(output.system[0].slice(output.system[0].indexOf(roleMarker)))
    .toBe(original.slice(original.indexOf(roleMarker)))
})

test("session-level CLI restrictions do not leak into another session or later turns", async () => {
  const { api, sessionPermissions } = createHarness()
  const config: Parameters<NonNullable<typeof api.config>>[0] = {}
  await api.config!(config)
  await api["tool.definition"]!({ toolID: "question" }, { description: "HOST_QUESTION_DESCRIPTION", parameters: {} })
  sessionPermissions.set("cli", [{ permission: "question", pattern: "*", action: "deny" }])
  const output = { system: [config.agent!.oracle!.prompt!] }
  const transform = api["experimental.chat.system.transform"]!
  const input = (sessionID: string) => ({
    sessionID, model: { providerID: "anthropic", id: "claude-opus-5-5" },
  } as Parameters<typeof transform>[0])
  await transform(input("cli"), output)
  expect(output.system[0]).not.toContain("- question: HOST_QUESTION_DESCRIPTION")
  await transform(input("interactive"), output)
  expect(output.system[0]).toContain("- question: HOST_QUESTION_DESCRIPTION")
  sessionPermissions.set("cli", [])
  await transform(input("cli"), output)
  expect(output.system[0]).toContain("- question: HOST_QUESTION_DESCRIPTION")
})

test("a scoped session exception keeps the tool visible as OpenCode does", async () => {
  const { api, sessionPermissions } = createHarness()
  const config: Parameters<NonNullable<typeof api.config>>[0] = {}
  await api.config!(config)
  await api["tool.definition"]!({ toolID: "read" }, { description: "HOST_SCOPED_READ", parameters: {} })
  sessionPermissions.set("scoped", [
    { permission: "read", pattern: "*", action: "deny" },
    { permission: "read", pattern: "/workspace/docs/*", action: "allow" },
  ])
  const output = { system: [config.agent!.oracle!.prompt!] }
  await api["experimental.chat.system.transform"]!(
    { sessionID: "scoped", model: { providerID: "anthropic", id: "claude-opus-5-5" } } as Parameters<NonNullable<typeof api["experimental.chat.system.transform"]>>[0],
    output,
  )
  expect(output.system[0]).toContain("- read: HOST_SCOPED_READ")
})

test.each(["throw", "malformed"] as const)("session metadata %s retains the last tool context without failing the turn", async (mode) => {
  const { api } = createHarness(mode)
  const config: Parameters<NonNullable<typeof api.config>>[0] = {}
  await api.config!(config)
  const previous = config.agent!.oracle!.prompt!
  const output = { system: [previous] }
  await api["experimental.chat.system.transform"]!(
    { sessionID: "unavailable", model: { providerID: "anthropic", id: "claude-opus-5-5" } } as Parameters<NonNullable<typeof api["experimental.chat.system.transform"]>>[0],
    output,
  )
  expect(output.system).toEqual([previous])
})
