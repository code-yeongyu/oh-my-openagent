import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type { Plugin } from "@opencode/plugin"
import { afterEach, describe, expect, test } from "bun:test"
import { z } from "zod"

import { createAdapterState } from "./adapter-state"
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

type FakeSessions = Record<string, { directory: string; parentID?: string }>

function createFakeContext(opts: { directory?: string; sessions?: FakeSessions; getThrows?: boolean } = {}): {
  ctx: Plugin.Context
  gets: string[]
  hooks: RegisteredHook[]
  tools: Array<{ name: string; execute: (input: unknown, context: { sessionID: string; id: string; signal: AbortSignal }) => Promise<{ content: string }> }>
  commands: Array<{ name: string; execute: (input: { sessionID: string; prompt: { text: string }; delivery: "steer" }) => Promise<void> }>
  mcps: Array<[string, { type: string; url?: string; disabled?: boolean }]>
  prompts: Array<{ sessionID: string; text: string }>
  agents: Map<string, { description?: string; mode?: string; system?: string }>
  pushEvent: (event: unknown) => void
  calls: { agent: string[]; model: unknown[]; synthetic: string[]; create: unknown[]; move: unknown[] }
} {
  const hooks: RegisteredHook[] = []
  const tools: Array<{ name: string; execute: (input: unknown, context: { sessionID: string; id: string; signal: AbortSignal }) => Promise<{ content: string }> }> = []
  const commands: Array<{ name: string; execute: (input: { sessionID: string; prompt: { text: string }; delivery: "steer" }) => Promise<void> }> = []
  const mcps: Array<[string, { type: string; url?: string; disabled?: boolean }]> = []
  const prompts: Array<{ sessionID: string; text: string }> = []
  const calls = { agent: [] as string[], model: [] as unknown[], synthetic: [] as string[], create: [] as unknown[], move: [] as unknown[] }
  const gets: string[] = []
  const directory = opts.directory ?? "/tmp/project"
  const pendingEvents: unknown[] = []
  let notifyEvent: (() => void) | undefined
  const agents = new Map<string, { description?: string; mode?: string; system?: string }>([
    // Flat id: fix 21 registers agents under their bare names (agents/sisyphus.md).
    ["sisyphus", { description: "stale" }],
  ])

  const ctx = {
    app: { name: "opencode", version: "2.0.16", channel: "stable" },
    location: {
      directory,
      project: { id: "proj", directory, canonical: directory },
    },
    options: {},
    session: {
      get: async (input: { sessionID: string }) => {
        gets.push(input.sessionID)
        if (opts.getThrows) throw new Error("host unavailable")
        const known = opts.sessions?.[input.sessionID]
        // Unknown sessions keep the old shape (no location), as before fix 50.
        if (!known) return { id: input.sessionID, title: "demo" }
        return { id: input.sessionID, title: "demo", location: { directory: known.directory }, ...(known.parentID ? { parentID: known.parentID } : {}) }
      },
      context: async () => [{ type: "user", id: "msg", text: "hi" }],
      prompt: async (input: { sessionID: string; text: string }) => {
        prompts.push(input)
        return { id: "inbox" }
      },
      create: async (input: unknown) => {
        calls.create.push(input)
        const body = typeof input === "object" && input !== null ? input as { parentID?: string; location?: unknown; metadata?: { omoParentID?: string } } : {}
        // Like the native host, a child lands at its parent's location (the project here), not the requested one.
        return { id: "created", metadata: body.metadata, location: body.parentID ? { directory: ctx.location.directory } : body.location }
      },
      interrupt: async () => undefined,
      switchAgent: async (input: { agent: string }) => {
        calls.agent.push(input.agent)
      },
      switchModel: async (input: { model: unknown }) => {
        calls.model.push(input.model)
      },
      update: async () => undefined,
      move: async (input: unknown) => {
        calls.move.push(input)
      },
      wait: async () => undefined,
      generate: async () => ({ text: "" }),
      command: async () => undefined,
      synthetic: async (input: { text: string }) => {
        calls.synthetic.push(input.text)
      },
      hook: async (name: string, fn: RegisteredHook["fn"]) => {
        hooks.push({ domain: "session", name, fn })
        return { async dispose() {} }
      },
    },
    event: {
      subscribe(options?: { signal?: AbortSignal }) {
        return (async function* events() {
          while (!options?.signal?.aborted) {
            if (pendingEvents.length === 0) {
              await new Promise<void>((resolve) => {
                notifyEvent = resolve
                options?.signal?.addEventListener("abort", () => resolve(), { once: true })
              })
            }
            if (options?.signal?.aborted) return
            const next = pendingEvents.shift()
            if (next) yield next
          }
        })()
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
    gets,
    ctx: ctx as unknown as Plugin.Context,
    hooks,
    tools,
    commands,
    mcps,
    prompts,
    agents,
    calls,
    pushEvent(event: unknown) {
      pendingEvents.push(event)
      notifyEvent?.()
      notifyEvent = undefined
    },
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
    const messages = await (v1.client.session.messages as (input: unknown) => Promise<{ data: Array<{ info: { role: string } }> }>)({ path: { id: "ses_1" } })
    const stateDirectory = mkdtempSync(join(tmpdir(), "omo-v2-toast-"))
    directories.push(stateDirectory)
    const state = createAdapterState(stateDirectory)
    const toasted = createV1PluginInput(fake.ctx, { state })
    await toasted.client.tui.showToast({ body: { title: "Hi", message: "there", variant: "info", duration: 100 } })
    await toasted.client.tui.showToast({ body: { title: "Hi", message: "there", variant: "info", duration: 3000 } })

    expect(v1.directory).toBe("/tmp/project")
    expect(got.data.id).toBe("ses_1")
    expect(messages.data[0]?.info.role).toBe("user")
    expect(state.readToasts()).toEqual([{ title: "Hi", message: "there", variant: "info" }])
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
    expect(fake.agents.get("sisyphus")?.description).toBe("Orchestrates work")
    expect(fake.tools.map((tool) => tool.name)).toEqual(["greeting", "todowrite", "todoread"])
    const result = await fake.tools[0]?.execute({ name: "Ada" }, { sessionID: "ses_1", id: "call_1", signal: new AbortController().signal })
    expect(result?.content).toBe("Hello Ada")

    await fake.commands[0]?.execute({ sessionID: "ses_1", prompt: { text: "ship it" }, delivery: "steer" })
    expect(fake.prompts[0]?.text).toContain("Goal: ship it")
    expect(fake.mcps[0]).toEqual(["context7", { type: "remote", url: "https://mcp.context7.com/mcp", oauth: false }])

    await cleanup?.()
    expect(disposed).toBe(true)
  })

  test("context messages expose info and write text edits back", async () => {
    const fake = createFakeContext()
    let seen: { sessionID?: string; role?: string } | undefined
    await setupOpenCodeV2(fake.ctx, {
      server: async () => ({
        "experimental.chat.messages.transform": async (_input: unknown, output: unknown) => {
          const messages = output as { messages: Array<{ info: { sessionID?: string; role?: string }; parts: Array<{ type?: string; text?: string }> }> }
          seen = messages.messages.at(-1)?.info
          const text = messages.messages[0]?.parts.find((part) => part.type === "text")
          if (text) text.text = "edited"
        },
      }),
    })
    const hook = fake.hooks.find((entry) => entry.name === "context")
    const message = { role: "user", content: [{ type: "text", text: "original" }] }
    await hook?.fn({
      sessionID: "ses_ctx",
      messages: [message],
      system: [],
      model: { id: "m", providerID: "p" },
      agent: "sisyphus",
      options: {},
    })
    expect(seen).toMatchObject({ sessionID: "ses_ctx", role: "user" })
    expect(message.content[0]?.text).toBe("edited")
  })

  test("idle events reach the V1 handler with properties.sessionID", async () => {
    const fake = createFakeContext()
    const seen: Array<{ type?: string; properties?: { sessionID?: string } }> = []
    const cleanup = await setupOpenCodeV2(fake.ctx, {
      server: async () => ({
        event: async (input: { event: { type?: string; properties?: { sessionID?: string } } }) => {
          seen.push(input.event)
        },
      }),
    })
    fake.pushEvent({ type: "session.idle", data: { sessionID: "ses_idle" } })
    await waitFor(() => seen.length > 0)
    expect(seen[0]?.properties?.sessionID).toBe("ses_idle")
    await cleanup?.()
  })

  test("deduplicates V2 scheduled retries when a matching status event also arrives", async () => {
    const fake = createFakeContext()
    const seen: Array<{ type?: string; properties?: Record<string, unknown> }> = []
    const cleanup = await setupOpenCodeV2(fake.ctx, {
      server: async () => ({
        event: async (input: { event: { type?: string; properties?: Record<string, unknown> } }) => {
          seen.push(input.event)
        },
      }),
    })

    const retry = {
      sessionID: "ses_retry",
      attempt: 2,
      error: { type: "ProviderError", message: "overloaded", status: 503 },
    }
    fake.pushEvent({ type: "session.retry.scheduled", data: retry })
    fake.pushEvent({
      type: "session.status",
      data: { sessionID: "ses_retry", status: { type: "retry", message: "overloaded", attempt: 2 } },
    })
    await waitFor(() => seen.length >= 1)

    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(seen.filter((event) => event.type === "session.status")).toHaveLength(1)
    await cleanup?.()
  })

  test("forwards a matching retry again after a non-retry event", async () => {
    const fake = createFakeContext()
    const seen: Array<{ type?: string }> = []
    const cleanup = await setupOpenCodeV2(fake.ctx, {
      server: async () => ({
        event: async (input: { event: { type?: string } }) => {
          seen.push(input.event)
        },
      }),
    })

    const retry = {
      sessionID: "ses_retry_again",
      attempt: 2,
      error: { type: "ProviderError", message: "overloaded", status: 503 },
    }
    fake.pushEvent({ type: "session.retry.scheduled", data: retry })
    fake.pushEvent({ type: "session.execution.succeeded", data: { sessionID: "ses_retry_again" } })
    fake.pushEvent({ type: "session.retry.scheduled", data: retry })
    await waitFor(() => seen.filter((event) => event.type === "session.status").length >= 2)

    expect(seen.filter((event) => event.type === "session.status")).toHaveLength(2)
    await cleanup?.()
  })

  test("agents, providers, and models use the V1 data shape", async () => {
    const fake = createFakeContext()
    const catalog = fake.ctx as unknown as {
      agent: { list: () => Promise<unknown> }
      provider: { list: () => Promise<unknown> }
      model: { list: () => Promise<unknown> }
    }
    // A native built-in keeps its id ("general") and only decorates the display name ("General");
    // V1 callers pass the listed name back as `agent`, which the native host resolves by id.
    catalog.agent.list = async () => ({
      data: [
        { name: "oh-my-openagent/oracle", mode: "subagent", hidden: false },
        { id: "general", name: "General", mode: "subagent", hidden: false },
      ],
    })
    catalog.provider.list = async () => ({ data: [{ id: "openai", activation: "enabled" }] })
    catalog.model.list = async () => ({ data: [{ providerID: "openai", modelID: "gpt" }] })
    const v1 = createV1PluginInput(fake.ctx)
    const agents = await v1.client.app.agents()
    const providers = await v1.client.provider.list()
    const models = await v1.client.model.list()
    expect(agents.data).toEqual([
      { name: "oh-my-openagent/oracle", mode: "subagent", hidden: false },
      { name: "general", mode: "subagent", hidden: false },
    ])
    expect(providers.data).toEqual({ connected: ["openai"], all: [{ id: "openai", models: { gpt: { id: "gpt" } } }] })
    expect(models.data).toEqual([{ provider: "openai", id: "gpt" }])
  })

  test("session status prefers the active list and falls back when HTTP fails", async () => {
    const directory = mkdtempSync(join(tmpdir(), "omo-v2-status-"))
    directories.push(directory)
    const state = createAdapterState(directory)
    const fake = createFakeContext()
    const requested: string[] = []
    const v1 = createV1PluginInput(fake.ctx, {
      state,
      argv: ["opencode", "serve", "--hostname", "127.0.0.1", "--port", "9"],
      fetchImpl: async (url) => {
        requested.push(String(url))
        if (String(url).endsWith("/active")) return jsonResponse({ data: { ses_busy: { type: "running" } } })
        return jsonResponse({ data: [{ id: "ses_busy" }, { id: "ses_old" }], cursor: {} })
      },
    })
    const status = await (v1.client.session.status as () => Promise<{ data: Record<string, { type: string }> }>)()
    expect(status.data.ses_busy).toEqual({ type: "busy" })
    expect(status.data.ses_old).toEqual({ type: "idle" })

    const failed = createV1PluginInput(fake.ctx, {
      state,
      argv: ["opencode", "serve", "--port", "9"],
      fetchImpl: async () => {
        throw new Error("offline")
      },
    })
    state.noteStatus("ses_retry", "retry")
    const fallback = await (failed.client.session.status as () => Promise<{ data: Record<string, { type: string }> }>)()
    expect(fallback.data.ses_retry).toEqual({ type: "retry" })
    expect(requested.some((url) => url.includes(":9/"))).toBe(true)

    const unauthorized = createV1PluginInput(fake.ctx, {
      state,
      argv: ["opencode", "serve", "--port", "9"],
      fetchImpl: async () => new Response("no", { status: 401 }),
    })
    await expect((unauthorized.client.session.status as () => Promise<unknown>)()).rejects.toThrow("unauthorized")
  })

  test("create links the native parent and prompt applies agent, model, and system", async () => {
    const directory = mkdtempSync(join(tmpdir(), "omo-v2-parent-"))
    directories.push(directory)
    const fake = createFakeContext()
    Object.assign(fake.ctx.location, { directory })
    const v1 = createV1PluginInput(fake.ctx, {
      state: createAdapterState(`${directory}/.omo/v2-state`),
      fetchImpl: async () => jsonResponse({ data: [], cursor: {} }),
      argv: ["opencode", "serve", "--port", "9"],
    })
    await (v1.client.session.create as (input: unknown) => Promise<unknown>)({
      body: { title: "child", parentID: "ses_parent", permission: [{ permission: "question", action: "deny", pattern: "*" }] },
    })
    const created = fake.calls.create[0] as { parentID?: string; metadata?: { omoParentID?: string }; permissions?: unknown[] }
    expect(created.parentID).toBe("ses_parent")
    expect(created.metadata?.omoParentID).toBe("ses_parent")
    expect(fake.calls.move).toEqual([])
    expect(created.permissions).toEqual([{ action: "question", resource: "*", effect: "deny" }])
    const children = await (v1.client.session.children as (input: unknown) => Promise<{ data: Array<{ id: string; parentID?: string }> }>)({ path: { id: "ses_parent" } })
    expect(children.data[0]?.parentID).toBe("ses_parent")
    await (v1.client.session.promptAsync as (input: unknown) => Promise<unknown>)({
      path: { id: "created" },
      body: { agent: "oracle", model: { providerID: "openai", modelID: "gpt" }, system: "be brief", parts: [{ type: "text", text: "go" }] },
    })
    expect(fake.calls.agent).toEqual(["oracle"])
    expect(fake.calls.model).toEqual([{ id: "gpt", providerID: "openai" }])
    expect(fake.calls.synthetic).toEqual(["be brief"])
    expect(fake.prompts[0]?.text).toBe("go")
  })

  test("a child requested in another directory is moved there after native parent linking", async () => {
    // given
    const directory = mkdtempSync(join(tmpdir(), "omo-v2-parent-"))
    const worktree = mkdtempSync(join(tmpdir(), "omo-v2-member-"))
    directories.push(directory, worktree)
    const fake = createFakeContext()
    Object.assign(fake.ctx.location, { directory })
    const v1 = createV1PluginInput(fake.ctx, {
      state: createAdapterState(`${directory}/.omo/v2-state`),
      fetchImpl: async () => jsonResponse({ data: [], cursor: {} }),
      argv: ["opencode", "serve", "--port", "9"],
    })

    // when
    const result = await (v1.client.session.create as (input: unknown) => Promise<{ data?: { directory?: string; parentID?: string } }>)({
      body: { title: "member", parentID: "ses_parent" },
      query: { directory: worktree },
    })

    // then
    expect((fake.calls.create[0] as { parentID?: string }).parentID).toBe("ses_parent")
    expect(fake.calls.move).toEqual([{ sessionID: "created", directory: worktree }])
    expect(result.data?.directory).toBe(worktree)
    expect(result.data?.parentID).toBe("ses_parent")
  })

  test("stored tool, synthetic, and idle messages keep the V1 roles", async () => {
    const fake = createFakeContext()
    const session = fake.ctx.session as unknown as { context: () => Promise<unknown> }
    session.context = async () => [
      { type: "synthetic", id: "syn", text: "marker" },
      { type: "assistant", id: "asst", agent: "oracle", model: { id: "gpt", providerID: "openai" }, finish: "stop", content: [{ type: "tool", id: "call_1", name: "edit", state: { status: "completed" } }] },
      { type: "idle", id: "idle", outcome: "succeeded" },
    ]
    const v1 = createV1PluginInput(fake.ctx)
    const messages = await (v1.client.session.messages as (input: unknown) => Promise<{ data: Array<{ info: { role: string }; parts: Array<{ type?: string; id?: string; state?: { status?: string } }> }> }>)({ path: { id: "ses_1" } })
    expect(messages.data.map((message) => message.info.role)).toEqual(["user", "assistant"])
    expect(messages.data[1]?.parts[0]).toMatchObject({ type: "tool", id: "call_1", name: "edit", state: { status: "completed" } })
  })

  test("manual compaction prompts once on the following idle and auto compaction does not", async () => {
    const fake = createFakeContext()
    const restored: string[] = []
    const cleanup = await setupOpenCodeV2(fake.ctx, {
      server: async () => ({
        "experimental.compaction.autocontinue": async (input: { sessionID: string }, output: { enabled: boolean }) => {
          restored.push(input.sessionID)
          output.enabled = true
        },
      }),
    })
    fake.pushEvent({ type: "session.compaction.ended", data: { sessionID: "ses_auto", reason: "auto" } })
    fake.pushEvent({ type: "session.idle", data: { sessionID: "ses_auto" } })
    fake.pushEvent({ type: "session.compaction.ended", data: { sessionID: "ses_manual", reason: "manual" } })
    fake.pushEvent({ type: "session.idle", data: { sessionID: "ses_manual" } })
    await waitFor(() => fake.prompts.some((prompt) => prompt.sessionID === "ses_manual"))
    expect(restored).toEqual(["ses_auto", "ses_manual"])
    expect(fake.prompts.map((prompt) => prompt.sessionID)).toEqual(["ses_manual"])
    expect(fake.prompts[0]?.text).toBe("Continue.")
    await cleanup?.()
  })

  test("session list follows the cursor, fails on 401, and resolves port 0", async () => {
    const fake = createFakeContext()
    const urls: string[] = []
    const listed = createV1PluginInput(fake.ctx, {
      argv: ["opencode", "serve", "--hostname", "127.0.0.1", "--port", "0"],
      listenPort: async () => 4242,
      fetchImpl: async (url) => {
        urls.push(String(url))
        if (!String(url).includes("cursor=page-2")) return jsonResponse({ data: [{ id: "ses_page_1" }], cursor: { next: "page-2" } })
        return jsonResponse({ data: [{ id: "ses_page_2" }], cursor: {} })
      },
    })
    const sessions = await (listed.client.session.list as () => Promise<{ data: Array<{ id: string }> }>)()
    expect(sessions.data.map((session) => session.id)).toEqual(["ses_page_1", "ses_page_2"])
    expect(urls[0]).toContain("127.0.0.1:4242")

    const unauthorized = createV1PluginInput(fake.ctx, {
      argv: ["opencode", "serve", "--port", "9"],
      fetchImpl: async () => new Response("no", { status: 401 }),
    })
    await expect((unauthorized.client.session.list as () => Promise<unknown>)()).rejects.toThrow("unauthorized")
  })

  test("todowrite arguments come back from session.todo", async () => {
    const directory = mkdtempSync(join(tmpdir(), "omo-v2-todo-"))
    directories.push(directory)
    const fake = createFakeContext()
    Object.assign(fake.ctx.location, { directory })
    const cleanup = await setupOpenCodeV2(fake.ctx, {
      server: async () => ({
        "tool.execute.before": async () => {},
      }),
    })
    const before = fake.hooks.find((hook) => hook.name === "execute.before")
    await before?.fn({
      tool: "todowrite",
      sessionID: "ses_todo",
      id: "call_todo",
      input: { todos: [{ content: "ship the adapter", status: "pending", priority: "high" }] },
    })
    const v1 = createV1PluginInput(fake.ctx, { state: createAdapterState(`${directory}/.omo/v2-state`) })
    const todos = await (v1.client.session.todo as (input: unknown) => Promise<{ data: Array<{ content: string }> }>)({ path: { id: "ses_todo" } })
    expect(todos.data[0]?.content).toBe("ship the adapter")
    await cleanup?.()
  })
})

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } })
}

async function waitFor(ready: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (ready()) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error("timed out waiting for adapter event")
}

// fix 50 (opencode-v2): the V2 host hands every folder's plugin instance the whole process's event
// stream; V1 hooks assume it is scoped. One errored probe session got 12 runtime-fallback retries,
// one from each warm folder (2026-10-18). Only the folder that owns the session tree may react.
describe("fix 50 session ownership (opencode-v2)", () => {
  type Seen = { type?: string; properties?: { sessionID?: string } }
  const retryingServer = (seen: Seen[]) => async (input: unknown) => {
    const v1 = input as { client: { session: { promptAsync: (request: unknown) => Promise<unknown> } } }
    return {
      event: async ({ event }: { event: Seen }) => {
        seen.push(event)
        if (event.properties?.sessionID !== "ses_probe" || event.type === "session.idle") return
        // runtime-fallback's call shape: switch agent + model, then prompt the same session.
        await v1.client.session.promptAsync({
          path: { id: "ses_probe" },
          body: { agent: "sisyphus", model: { providerID: "claude-code", modelID: "claude-opus-5-5" }, variant: "xhigh", parts: [{ type: "text", text: "retry" }] },
        })
      },
    }
  }
  const failed = { type: "session.execution.failed", data: { sessionID: "ses_probe", error: { type: "provider.internal", status: 503, message: "auth_not_found" } } }
  const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

  test("two folders, one failed session: exactly one retry, and only the owner switches the model", async () => {
    const sessions: FakeSessions = { ses_probe: { directory: "/tmp/project" } }
    const owner = createFakeContext({ directory: "/tmp/project", sessions })
    const other = createFakeContext({ directory: "/tmp/other", sessions })
    const ownerSeen: Seen[] = []
    const otherSeen: Seen[] = []
    const cleanups = [
      await setupOpenCodeV2(owner.ctx, { server: retryingServer(ownerSeen) }),
      await setupOpenCodeV2(other.ctx, { server: retryingServer(otherSeen) }),
    ]
    // The V2 bus every instance shares: the same raw event reaches both folders.
    for (const fake of [owner, other]) fake.pushEvent(failed)
    await waitFor(() => owner.prompts.length > 0)
    await pause(40)
    expect(owner.prompts.length + other.prompts.length).toBe(1)
    expect(other.calls.model).toHaveLength(0)
    expect(other.calls.agent).toHaveLength(0)
    expect(otherSeen.some((event) => event.properties?.sessionID === "ses_probe")).toBe(false)
    for (const cleanup of cleanups) await cleanup?.()
  })

  test("events of a session owned by another folder never reach the V1 handler", async () => {
    const fake = createFakeContext({ sessions: { ses_foreign: { directory: "/tmp/other" }, ses_local: { directory: "/tmp/project" } } })
    const seen: Seen[] = []
    const cleanup = await setupOpenCodeV2(fake.ctx, { server: async () => ({ event: async ({ event }: { event: Seen }) => { seen.push(event) } }) })
    fake.pushEvent({ type: "session.idle", data: { sessionID: "ses_foreign" } })
    fake.pushEvent({ ...failed, data: { ...failed.data, sessionID: "ses_foreign" } })
    fake.pushEvent({ type: "session.idle", data: { sessionID: "ses_local" } })
    await waitFor(() => seen.some((event) => event.properties?.sessionID === "ses_local"))
    expect(seen.some((event) => event.properties?.sessionID === "ses_foreign")).toBe(false)
    await cleanup?.()
  })

  test("a child moved to another folder belongs to the folder that owns its root", async () => {
    const sessions: FakeSessions = { ses_root: { directory: "/tmp/project" }, ses_child: { directory: "/tmp/elsewhere", parentID: "ses_root" } }
    const root = createFakeContext({ directory: "/tmp/project", sessions })
    const elsewhere = createFakeContext({ directory: "/tmp/elsewhere", sessions })
    const rootSeen: Seen[] = []
    const elsewhereSeen: Seen[] = []
    const cleanups = [
      await setupOpenCodeV2(root.ctx, { server: async () => ({ event: async ({ event }: { event: Seen }) => { rootSeen.push(event) } }) }),
      await setupOpenCodeV2(elsewhere.ctx, { server: async () => ({ event: async ({ event }: { event: Seen }) => { elsewhereSeen.push(event) } }) }),
    ]
    for (const fake of [root, elsewhere]) fake.pushEvent({ type: "session.idle", data: { sessionID: "ses_child" } })
    await waitFor(() => rootSeen.some((event) => event.properties?.sessionID === "ses_child"))
    await pause(40)
    expect(elsewhereSeen.some((event) => event.properties?.sessionID === "ses_child")).toBe(false)
    for (const cleanup of cleanups) await cleanup?.()
  })

  test("an unresolvable session fails open (delivered) and is not cached", async () => {
    const fake = createFakeContext({ getThrows: true })
    const seen: Seen[] = []
    const cleanup = await setupOpenCodeV2(fake.ctx, { server: async () => ({ event: async ({ event }: { event: Seen }) => { seen.push(event) } }) })
    fake.pushEvent({ type: "session.idle", data: { sessionID: "ses_unknown" } })
    fake.pushEvent({ type: "session.idle", data: { sessionID: "ses_unknown" } })
    await waitFor(() => seen.filter((event) => event.properties?.sessionID === "ses_unknown").length === 2)
    expect(fake.gets.filter((id) => id === "ses_unknown").length).toBe(2)
    await cleanup?.()
  })

  test("ownership is resolved once per session", async () => {
    const fake = createFakeContext({ sessions: { ses_foreign: { directory: "/tmp/other" }, ses_local: { directory: "/tmp/project" } } })
    const seen: Seen[] = []
    const cleanup = await setupOpenCodeV2(fake.ctx, { server: async () => ({ event: async ({ event }: { event: Seen }) => { seen.push(event) } }) })
    fake.pushEvent({ type: "session.idle", data: { sessionID: "ses_foreign" } })
    fake.pushEvent({ type: "session.idle", data: { sessionID: "ses_foreign" } })
    fake.pushEvent({ type: "session.idle", data: { sessionID: "ses_local" } })
    await waitFor(() => seen.some((event) => event.properties?.sessionID === "ses_local"))
    expect(fake.gets.filter((id) => id === "ses_foreign").length).toBe(1)
    await cleanup?.()
  })

  test("events without a session still reach the V1 handler", async () => {
    const fake = createFakeContext({ sessions: { ses_foreign: { directory: "/tmp/other" } } })
    const seen: Seen[] = []
    const cleanup = await setupOpenCodeV2(fake.ctx, { server: async () => ({ event: async ({ event }: { event: Seen }) => { seen.push(event) } }) })
    fake.pushEvent({ type: "config.updated", data: {} })
    await waitFor(() => seen.some((event) => event.type === "config.updated"))
    expect(seen.some((event) => event.type === "config.updated")).toBe(true)
    await cleanup?.()
  })
})
