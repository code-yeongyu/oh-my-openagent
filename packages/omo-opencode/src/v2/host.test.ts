import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type { Plugin } from "@opencode/plugin"
import { afterEach, describe, expect, test } from "bun:test"
import { z } from "zod"

import { permissionsFromV1, renderAgentMarkdown } from "./agent-markdown"
import { createV1PluginInput } from "./context-facade"
import { setupOpenCodeV2 } from "./host"
import { mcpServerFromV1 } from "./project-config"
import { toolInputSchema } from "./tool-schema"

type RegisteredHook = {
  domain: string
  name: string
  fn: (event: Record<string, unknown>) => Promise<void> | void
}

function createFakeContext(): {
  ctx: Plugin.Context
  hooks: RegisteredHook[]
  tools: Array<{ name: string; execute: (input: unknown, context: { sessionID: string; id: string; signal: AbortSignal }) => Promise<{ content: string }> }>
  commands: Array<{ name: string; execute: (input: { sessionID: string; prompt: { text: string }; delivery: "steer" }) => Promise<void> }>
  mcps: Array<[string, { type: string; url?: string; disabled?: boolean }]>
  prompts: Array<{ sessionID: string; text: string }>
  agents: Map<string, { description?: string; mode?: string; system?: string }>
} {
  const hooks: RegisteredHook[] = []
  const tools: Array<{ name: string; execute: (input: unknown, context: { sessionID: string; id: string; signal: AbortSignal }) => Promise<{ content: string }> }> = []
  const commands: Array<{ name: string; execute: (input: { sessionID: string; prompt: { text: string }; delivery: "steer" }) => Promise<void> }> = []
  const mcps: Array<[string, { type: string; url?: string; disabled?: boolean }]> = []
  const prompts: Array<{ sessionID: string; text: string }> = []
  const agents = new Map<string, { description?: string; mode?: string; system?: string }>([
    ["oh-my-openagent/sisyphus", { description: "stale" }],
  ])

  const ctx = {
    app: { name: "opencode", version: "2.0.16", channel: "stable" },
    location: {
      directory: "/tmp/project",
      project: { id: "proj", directory: "/tmp/project", canonical: "/tmp/project" },
    },
    options: {},
    session: {
      get: async (input: { sessionID: string }) => ({ id: input.sessionID, title: "demo" }),
      context: async () => [{ id: "msg" }],
      prompt: async (input: { sessionID: string; text: string }) => {
        prompts.push(input)
        return { id: "inbox" }
      },
      create: async () => ({ id: "created" }),
      interrupt: async () => undefined,
      switchAgent: async () => undefined,
      switchModel: async () => undefined,
      update: async () => undefined,
      move: async () => undefined,
      wait: async () => undefined,
      generate: async () => ({ text: "" }),
      command: async () => undefined,
      synthetic: async () => undefined,
      hook: async (name: string, fn: RegisteredHook["fn"]) => {
        hooks.push({ domain: "session", name, fn })
        return { async dispose() {} }
      },
    },
    event: {
      subscribe() {
        return (async function* empty() {})()
      },
    },
    tool: {
      transform: async (fn: (editor: {
        list: () => Array<{ id: string; name: string }>
        get: (id: string) => undefined
        namespace: () => void
        add: (tool: { name: string }) => void
        update: () => void
        remove: (id: string) => void
      }) => void) => {
        const registered: Array<{ id: string; name: string }> = []
        fn({
          list: () => registered,
          get: () => undefined,
          namespace() {},
          add(tool) {
            registered.push({ id: tool.name, name: tool.name })
            tools.push(tool as (typeof tools)[number])
          },
          update() {},
          remove(id) {
            const index = registered.findIndex((tool) => tool.id === id)
            if (index >= 0) registered.splice(index, 1)
          },
        })
      },
      hook: async (name: string, fn: RegisteredHook["fn"]) => {
        hooks.push({ domain: "tool", name, fn })
        return { async dispose() {} }
      },
      list: async () => [],
      reload: async () => undefined,
    },
    command: {
      list: async () => [],
      reload: async () => undefined,
      transform: async (fn: (editor: { add: (command: (typeof commands)[number]) => void }) => void) => {
        fn({
          add(command) {
            commands.push(command)
          },
        })
      },
    },
    mcp: {
      list: async () => [],
      reload: async () => undefined,
      transform: async (fn: (editor: {
        list: () => typeof mcps
        get: (name: string) => unknown
        set: (name: string, config: (typeof mcps)[number][1]) => void
        update: () => void
        remove: () => void
      }) => void) => {
        fn({
          list: () => mcps,
          get: (name) => mcps.find(([id]) => id === name)?.[1],
          set(name, config) {
            mcps.push([name, config])
          },
          update() {},
          remove() {},
        })
      },
    },
    skill: {
      list: async () => [],
      get: async () => undefined,
      reload: async () => undefined,
      transform: async () => ({ async dispose() {} }),
    },
    provider: {
      list: async () => [],
      get: async () => undefined,
      reload: async () => undefined,
      transform: async (fn: (editor: { add: () => void; list: () => []; get: () => undefined; update: () => void; remove: () => void; models: { set: () => void; update: () => void; remove: () => void } }) => void) => {
        fn({
          list: () => [],
          get: () => undefined,
          add() {},
          update() {},
          remove() {},
          models: { set() {}, update() {}, remove() {} },
        })
      },
    },
    model: {
      list: async () => [],
      get: async () => undefined,
      reload: async () => undefined,
      transform: async (fn: (editor: { list: () => []; get: () => undefined; update: () => void; remove: () => void; default: { get: () => undefined; set: () => void }; provider: { list: () => []; get: () => undefined } }) => void) => {
        fn({
          list: () => [],
          get: () => undefined,
          update() {},
          remove() {},
          default: { get: () => undefined, set() {} },
          provider: { list: () => [], get: () => undefined },
        })
      },
    },
    agent: {
      list: async () => [],
      get: async () => undefined,
      reload: async () => undefined,
      transform: async (fn: (editor: {
        list: () => []
        get: (id: string) => { description?: string; mode?: string; system?: string } | undefined
        default: (id: string | undefined) => void
        update: (id: string, update: (agent: { description?: string; mode?: string; system?: string }) => void) => void
        remove: (id: string) => void
      }) => void) => {
        fn({
          list: () => [],
          get: (id) => agents.get(id),
          default() {},
          update(id, update) {
            const agent = agents.get(id)
            if (agent) update(agent)
          },
          remove(id) {
            agents.delete(id)
          },
        })
      },
    },
    shell: {
      hook: async () => ({ async dispose() {} }),
    },
    permission: {
      hook: async () => ({ async dispose() {} }),
    },
  }

  return {
    ctx: ctx as unknown as Plugin.Context,
    hooks,
    tools,
    commands,
    mcps,
    prompts,
    agents,
  }
}

describe("OpenCode V2 adapter", () => {
  const directories: string[] = []

  afterEach(() => {
    for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
  })

  test("renders agent markdown and maps V1 permissions", () => {
    const markdown = renderAgentMarkdown("sisyphus", {
      description: "Orchestrates work",
      mode: "primary",
      model: "openai/gpt-5.4",
      prompt: "Do the work.",
      permission: { edit: "allow", bash: { "*": "ask", "git push": "deny" } },
    })

    expect(markdown).toContain('description: "Orchestrates work"')
    expect(markdown).toContain("mode: primary")
    expect(markdown).toContain("Do the work.")
    expect(permissionsFromV1({ edit: "allow", bash: { "*": "ask" } })).toEqual([
      { action: "edit", resource: "*", effect: "allow" },
      { action: "shell", resource: "*", effect: "ask" },
    ])
  })

  test("maps V1 MCP entries onto V2 server config", () => {
    expect(mcpServerFromV1({ type: "remote", url: "https://mcp.example.com", enabled: false, oauth: false })).toEqual({
      type: "remote",
      url: "https://mcp.example.com",
      disabled: true,
      oauth: false,
    })
    expect(mcpServerFromV1({ type: "local", command: ["bun", "mcp"], cwd: "/tmp" })).toEqual({
      type: "local",
      command: ["bun", "mcp"],
      cwd: "/tmp",
    })
  })

  test("converts a zod tool schema to JSON schema", () => {
    const schema = toolInputSchema({
      args: z.object({ name: z.string() }),
    })
    expect(schema.type).toBe("object")
    expect(schema.properties).toBeDefined()
  })

  test("facade maps session reads and logs toasts", async () => {
    const fake = createFakeContext()
    const v1 = createV1PluginInput(fake.ctx)
    const got = await (v1.client.session.get as (input: unknown) => Promise<{ data: { id: string } }>)({ path: { id: "ses_1" } })
    const messages = await (v1.client.session.messages as (input: unknown) => Promise<{ data: unknown[] }>)({ path: { id: "ses_1" } })
    await v1.client.tui.showToast({ body: { title: "Hi", message: "there", variant: "info" } })

    expect(v1.directory).toBe("/tmp/project")
    expect(got.data.id).toBe("ses_1")
    expect(messages.data).toHaveLength(1)
  })

  test("setup registers V2 hooks and projects agents, tools, commands, and MCP", async () => {
    const directory = mkdtempSync(join(tmpdir(), "omo-v2-"))
    directories.push(directory)
    const fake = createFakeContext()
    let disposed = false

    const cleanup = await setupOpenCodeV2(fake.ctx, {
      agentDirectory: directory,
      server: async () => ({
        "chat.message": async (_input: unknown, output: unknown) => {
          const message = output as { parts: Array<{ type: string; text?: string }> }
          const text = message.parts[0]
          if (text) text.text = `${text.text ?? ""}!`
        },
        "experimental.compaction.autocontinue": async () => {},
        config: async (config: Record<string, unknown>) => {
          config.agent = { sisyphus: { description: "Orchestrates work", mode: "primary", prompt: "Do the work." } }
          config.default_agent = "sisyphus"
          config.command = { goal: { description: "Set a goal", template: "Goal: $ARGUMENTS", agent: "sisyphus" } }
          config.mcp = { context7: { type: "remote", url: "https://mcp.context7.com/mcp", enabled: true, oauth: false } }
          config.tools = { todowrite: false }
        },
        tool: {
          greeting: {
            description: "Say hello",
            args: z.object({ name: z.string() }),
            execute: async (args: { name: string }) => `Hello ${args.name}`,
          },
        },
        "tool.definition": async () => {},
        dispose: async () => {
          disposed = true
        },
      }),
    })

    const promptHook = fake.hooks.find((hook) => hook.domain === "session" && hook.name === "prompt")
    const event = { sessionID: "ses_1", prompt: { text: "ulw build" } }
    await promptHook?.fn(event as never)
    expect(event.prompt.text).toBe("ulw build!")

    expect(readFileSync(join(directory, "sisyphus.md"), "utf8")).toContain("Do the work.")
    expect(fake.agents.get("oh-my-openagent/sisyphus")?.description).toBe("Orchestrates work")
    expect(fake.tools.map((tool) => tool.name)).toEqual(["greeting"])
    const result = await fake.tools[0]?.execute({ name: "Ada" }, { sessionID: "ses_1", id: "call_1", signal: new AbortController().signal })
    expect(result?.content).toBe("Hello Ada")

    await fake.commands[0]?.execute({ sessionID: "ses_1", prompt: { text: "ship it" }, delivery: "steer" })
    expect(fake.prompts[0]?.text).toContain("Goal: ship it")
    expect(fake.mcps[0]).toEqual(["context7", { type: "remote", url: "https://mcp.context7.com/mcp", oauth: false }])

    await cleanup?.()
    expect(disposed).toBe(true)
  })
})
