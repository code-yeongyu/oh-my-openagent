import { afterEach, expect, test } from "bun:test"
import type { PluginInput } from "@opencode-ai/plugin"
import { createPluginInterface } from "../plugin-interface"
import { createSisyphusAgent } from "../agents/sisyphus"
import { createOracleAgent } from "../agents/oracle"
import { clearSisyphusRuntimePromptContext, setSisyphusRuntimePromptContext } from "../agents/sisyphus-runtime-prompt-reconciler"
import { createGrepTools } from "../tools/grep/tools"
import { createGlobTools } from "../tools/glob/tools"
import { interactive_bash } from "../tools/interactive-bash/tools"
import { toolPromptSnippet } from "../agents/native-tool-snippet"

afterEach(clearSisyphusRuntimePromptContext)

function defined<T>(value: T | null | undefined, name: string): T {
  if (value === null || value === undefined) throw new Error(`${name} is missing`)
  return value
}

function createHarness(sessionRead: "ok" | "throw" | "malformed" = "ok") {
  const sessionPermissions = new Map<string, Array<{ permission: string; pattern: string; action: "allow" | "ask" | "deny" }>>()
  const sessionReads: string[] = []
  const ctx = {
    directory: "/workspace",
    client: { session: { get: async ({ path }: { path: { id: string } }) => {
      sessionReads.push(path.id)
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
    firstMessageVariantGate: {
      shouldOverride: () => false,
      markApplied: () => {},
      markSessionCreated: () => {},
      clear: () => {},
    },
  } as Parameters<typeof createPluginInterface>[0])
  return { api, tools, sessionPermissions, sessionReads }
}

test("production registration includes the real registered names and descriptions", async () => {
  const { api, tools } = createHarness()
  const config: Parameters<NonNullable<typeof api.config>>[0] = {}
  await defined(api.config, "config hook")(config)
  for (const agent of Object.values(config.agent ?? {})) {
    expect(agent.prompt).toContain("- interactive_bash: " + toolPromptSnippet(tools.interactive_bash.description))
    expect(agent.prompt).not.toContain("## Available Tools\n\n(none)")
  }
  expect(defined(config.agent?.oracle?.prompt, "oracle prompt")).toContain("- grep: " + toolPromptSnippet(tools.grep.description))
  expect(defined(config.agent?.oracle?.prompt, "oracle prompt")).toContain("- glob: " + toolPromptSnippet(tools.glob.description))
  expect(defined(config.agent?.sisyphus?.prompt, "sisyphus prompt")).not.toContain("- grep: " + toolPromptSnippet(tools.grep.description))
  expect(defined(config.agent?.sisyphus?.prompt, "sisyphus prompt")).not.toContain("- glob: " + toolPromptSnippet(tools.glob.description))
})

test("the system prompt sent to the model carries no frame metadata and one-line tool snippets", async () => {
  const { api, tools } = createHarness()
  const config: Parameters<NonNullable<typeof api.config>>[0] = {}
  await defined(api.config, "config hook")(config)
  const transform = defined(api["experimental.chat.system.transform"], "system transform hook")
  for (const name of ["sisyphus", "oracle"] as const) {
    const output = { system: [defined(config.agent?.[name]?.prompt, name + " prompt")] }
    await transform(
      { sessionID: "ses_" + name, model: { providerID: "openai", id: "gpt-5.5" } } as Parameters<typeof transform>[0],
      output,
    )
    const sent = output.system.join("\n")
    const headers = sent.split("\n").filter((line) => line.startsWith("<omo-model-core"))
    expect(headers.length).toBeGreaterThan(0)
    for (const header of headers) expect(header).toMatch(/^<omo-model-core ref="[0-9a-f]{16}">$/)
    expect(sent).not.toContain(tools.interactive_bash.description)
    expect(sent).toContain("- interactive_bash: " + toolPromptSnippet(tools.interactive_bash.description))
  }
})

test("a registered Sisyphus follows a runtime model switch after the config hook rewrites its frame", async () => {
  const configured = "openai/gpt-5.5"
  const runtime = "anthropic/claude-opus-5-5"
  const role = (prompt: string) => prompt.slice(prompt.indexOf("\n</omo-model-core>"))
  const runtimeRole = role(createSisyphusAgent(runtime).prompt ?? "")
  expect(role(createSisyphusAgent(configured).prompt ?? "")).not.toBe(runtimeRole)
  const ctx = { directory: "/workspace", client: {} } as unknown as PluginInput
  const api = createPluginInterface({
    ctx,
    pluginConfig: {},
    hooks: {},
    managers: {
      configHandler: async (config: Record<string, unknown>) => {
        const sisyphus = createSisyphusAgent(configured)
        setSisyphusRuntimePromptContext({
          configuredModel: configured,
          bakedPrompt: sisyphus.prompt ?? "",
          rebuildPromptForModel: (model) => createSisyphusAgent(model).prompt ?? "",
        })
        config.agent = { sisyphus }
      },
    },
    tools: { ...createGrepTools(ctx), ...createGlobTools(ctx) },
    firstMessageVariantGate: { shouldOverride: () => false, markApplied: () => {}, markSessionCreated: () => {}, clear: () => {} },
  } as Parameters<typeof createPluginInterface>[0])
  const config: Parameters<NonNullable<typeof api.config>>[0] = {}
  await defined(api.config, "config hook")(config)
  const output = { system: [defined(config.agent?.sisyphus?.prompt, "sisyphus prompt")] }
  const [providerID, id] = runtime.split("/")
  await defined(api["experimental.chat.system.transform"], "system transform hook")(
    { model: { providerID, id } } as Parameters<NonNullable<typeof api["experimental.chat.system.transform"]>>[0],
    output,
  )
  expect(role(output.system[0])).toBe(runtimeRole)
})

test("host definitions refresh the core without a model switch and retain agent restrictions", async () => {
  const { api } = createHarness()
  const config: Parameters<NonNullable<typeof api.config>>[0] = {}
  await defined(api.config, "config hook")(config)
  await defined(api["tool.definition"], "tool.definition hook")({ toolID: "read" }, { description: "HOST_READ_DESCRIPTION", parameters: {} })
  await defined(api["tool.definition"], "tool.definition hook")({ toolID: "write" }, { description: "HOST_WRITE_DESCRIPTION", parameters: {} })
  await defined(api["tool.definition"], "tool.definition hook")({ toolID: "invalid" }, { description: "HOST_INVALID_HANDLER", parameters: {} })
  const original = defined(config.agent?.oracle?.prompt, "oracle prompt")
  const output = { system: [original] }
  await defined(api["experimental.chat.system.transform"], "system transform hook")(
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
  await defined(api.config, "config hook")(config)
  await defined(api["tool.definition"], "tool.definition hook")({ toolID: "question" }, { description: "HOST_QUESTION_DESCRIPTION", parameters: {} })
  sessionPermissions.set("cli", [{ permission: "question", pattern: "*", action: "deny" }])
  const output = { system: [defined(config.agent?.oracle?.prompt, "oracle prompt")] }
  const transform = defined(api["experimental.chat.system.transform"], "system transform hook")
  const input = (sessionID: string) => ({
    sessionID, model: { providerID: "anthropic", id: "claude-opus-5-5" },
  } as Parameters<typeof transform>[0])
  await transform(input("cli"), output)
  expect(output.system[0]).not.toContain("- question: HOST_QUESTION_DESCRIPTION")
  await transform(input("interactive"), output)
  expect(output.system[0]).toContain("- question: HOST_QUESTION_DESCRIPTION")
  await defined(api.event, "event hook")({
    event: { type: "session.updated", properties: { info: { id: "cli", permission: [] } } },
  } as Parameters<NonNullable<typeof api.event>>[0])
  await transform(input("cli"), output)
  expect(output.system[0]).toContain("- question: HOST_QUESTION_DESCRIPTION")
})

test("a session's tool permissions are read once, then follow its update events", async () => {
  const { api, sessionPermissions, sessionReads } = createHarness()
  const config: Parameters<NonNullable<typeof api.config>>[0] = {}
  await defined(api.config, "config hook")(config)
  await defined(api["tool.definition"], "tool.definition hook")({ toolID: "question" }, { description: "HOST_QUESTION_DESCRIPTION", parameters: {} })
  sessionPermissions.set("cli", [{ permission: "question", pattern: "*", action: "deny" }])
  const transform = defined(api["experimental.chat.system.transform"], "system transform hook")
  const event = defined(api.event, "event hook")
  const input = { sessionID: "cli", model: { providerID: "anthropic", id: "claude-opus-5-5" } } as Parameters<typeof transform>[0]
  const output = { system: [defined(config.agent?.oracle?.prompt, "oracle prompt")] }
  await transform(input, output)
  await transform(input, output)
  expect(sessionReads).toEqual(["cli"])
  expect(output.system[0]).not.toContain("- question: HOST_QUESTION_DESCRIPTION")
  await event({
    event: { type: "session.updated", properties: { info: { id: "cli", permission: [] } } },
  } as Parameters<typeof event>[0])
  await transform(input, output)
  expect(sessionReads).toEqual(["cli"])
  expect(output.system[0]).toContain("- question: HOST_QUESTION_DESCRIPTION")
})

test("a scoped session exception keeps the tool visible as OpenCode does", async () => {
  const { api, sessionPermissions } = createHarness()
  const config: Parameters<NonNullable<typeof api.config>>[0] = {}
  await defined(api.config, "config hook")(config)
  await defined(api["tool.definition"], "tool.definition hook")({ toolID: "read" }, { description: "HOST_SCOPED_READ", parameters: {} })
  sessionPermissions.set("scoped", [
    { permission: "read", pattern: "*", action: "deny" },
    { permission: "read", pattern: "/workspace/docs/*", action: "allow" },
  ])
  const output = { system: [defined(config.agent?.oracle?.prompt, "oracle prompt")] }
  await defined(api["experimental.chat.system.transform"], "system transform hook")(
    { sessionID: "scoped", model: { providerID: "anthropic", id: "claude-opus-5-5" } } as Parameters<NonNullable<typeof api["experimental.chat.system.transform"]>>[0],
    output,
  )
  expect(output.system[0]).toContain("- read: HOST_SCOPED_READ")
})

test.each(["throw", "malformed"] as const)("session metadata %s retains the last tool context without failing the turn", async (mode) => {
  const { api } = createHarness(mode)
  const config: Parameters<NonNullable<typeof api.config>>[0] = {}
  await defined(api.config, "config hook")(config)
  const previous = defined(config.agent?.oracle?.prompt, "oracle prompt")
  const output = { system: [previous] }
  await defined(api["experimental.chat.system.transform"], "system transform hook")(
    { sessionID: "unavailable", model: { providerID: "anthropic", id: "claude-opus-5-5" } } as Parameters<NonNullable<typeof api["experimental.chat.system.transform"]>>[0],
    output,
  )
  expect(output.system).toEqual([previous])
})
