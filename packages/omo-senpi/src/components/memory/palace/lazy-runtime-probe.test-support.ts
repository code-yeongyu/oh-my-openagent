// Fresh-process probe for the lazy palace sidecar (`#omo-memory-palace-runtime`).
//
// `bun test` shares one module registry across every test file, so "first use" can only be
// observed in a process that has never imported the sidecar. lazy-runtime.test.ts spawns this
// script once per scenario; a Bun runtime plugin counts every evaluation of the sidecar entry, and
// the probe prints one JSON line the test asserts on.
//
//   palace  - first /palace through the registered command vs a direct runtime call
//   people  - first /people through the registered command vs a direct runtime call
//   startup - full memory wiring: session start + a settled turn, then /palace, /palace, /people

import { readFileSync } from "node:fs"
import { readFile } from "node:fs/promises"

const RUNTIME_ENTRY = /[\\/]memory[\\/]palace[\\/]runtime\.ts$/
const runtimeLoads: string[] = []

Bun.plugin({
  name: "palace-runtime-load-counter",
  setup(build) {
    build.onLoad({ filter: RUNTIME_ENTRY }, (args) => {
      runtimeLoads.push(args.path)
      return { contents: readFileSync(args.path, "utf8"), loader: "ts" }
    })
  },
})

interface Surface {
  readonly notifications: Array<{ message: string; level: string | undefined }>
  readonly outputs: string[]
  readonly execCalls: Array<{ command: string; args: string[] }>
  readonly ctx: Record<string, unknown>
}

function surface(options: { readonly env?: Record<string, string>; readonly sessionId?: string } = {}): Surface {
  const notifications: Surface["notifications"] = []
  const outputs: string[] = []
  const execCalls: Surface["execCalls"] = []
  const sessionId = options.sessionId ?? "session-1"
  return {
    notifications,
    outputs,
    execCalls,
    ctx: {
      hasUI: true,
      mode: "tui",
      platform: "darwin",
      env: options.env ?? {},
      ui: { notify: (message: string, level?: string) => notifications.push({ message, level }) },
      output: (text: string) => outputs.push(text),
      exec: async (command: string, args: string[]) => {
        execCalls.push({ command, args })
        return { code: 0, stdout: "", stderr: "" }
      },
      sessionManager: { getSessionId: () => sessionId },
    },
  }
}

const TIMESTAMP = /palace-[0-9TZ-]+\.html/g
const RECOMPILED_AT = /"recompiledAt":"[^"]*"/g

async function observed(view: Surface, result: unknown): Promise<unknown> {
  const opened = view.execCalls[0]?.args.at(-1)
  return {
    result: typeof result === "string" ? result : null,
    notifications: view.notifications.map((entry) => ({ ...entry, message: entry.message.replace(TIMESTAMP, "palace-<ts>.html") })),
    outputs: view.outputs.map((entry) => entry.replace(TIMESTAMP, "palace-<ts>.html")),
    execCalls: view.execCalls.map((call) => ({ command: call.command, args: call.args.map((arg) => arg.replace(TIMESTAMP, "palace-<ts>.html")) })),
    html: opened === undefined ? null : (await readFile(opened, "utf8")).replace(RECOMPILED_AT, '"recompiledAt":"<t>"'),
  }
}

async function invokeCommand(pi: { commands: Array<{ name: string; options: { handler?: unknown } }> }, name: string, args: string, ctx: unknown): Promise<unknown> {
  const registration = pi.commands.find((entry) => entry.name === name)
  const handler = registration?.options.handler
  if (typeof handler !== "function") throw new Error(`${name} command was not registered`)
  return Reflect.apply(handler, registration?.options, [args, ctx])
}

async function palaceScenario(): Promise<unknown> {
  const { MemoryFakeExtensionAPI } = await import("../memory.test-support")
  const { cleanupPalaceFixtures, createPalaceFixture, seedPalacePeople } = await import("./palace.test-support")
  const { registerPalaceCommand } = await import("./command")
  try {
    const fixture = await createPalaceFixture()
    await seedPalacePeople(fixture)
    const pi = new MemoryFakeExtensionAPI()
    registerPalaceCommand(pi, () => fixture.context)
    const loadsAfterRegistration = runtimeLoads.length

    const lazyOpen = surface()
    const lazyRemote = surface({ env: { TMUX: "/tmp/tmux-1000/default,1,0" } })
    const lazy = [
      await observed(lazyOpen, await invokeCommand(pi, "palace", "", lazyOpen.ctx)),
      await observed(lazyRemote, await invokeCommand(pi, "palace", "", lazyRemote.ctx)),
    ]
    const loadsAfterFirstUse = runtimeLoads.length

    const { runPalaceCommand } = await import("./runtime")
    const eagerOpen = surface()
    const eagerRemote = surface({ env: { TMUX: "/tmp/tmux-1000/default,1,0" } })
    const eager = [
      await observed(eagerOpen, await runPalaceCommand(() => fixture.context, eagerOpen.ctx)),
      await observed(eagerRemote, await runPalaceCommand(() => fixture.context, eagerRemote.ctx)),
    ]

    const unboundPi = new MemoryFakeExtensionAPI()
    registerPalaceCommand(unboundPi, () => undefined)
    const lazyUnbound = surface()
    const eagerUnbound = surface()
    lazy.push(await observed(lazyUnbound, await invokeCommand(unboundPi, "palace", "", lazyUnbound.ctx)))
    eager.push(await observed(eagerUnbound, await runPalaceCommand(() => undefined, eagerUnbound.ctx)))

    return { loadsAfterRegistration, loadsAfterFirstUse, loadsTotal: runtimeLoads.length, lazy, eager }
  } finally {
    await cleanupPalaceFixtures()
  }
}

async function peopleScenario(): Promise<unknown> {
  const { MemoryFakeExtensionAPI } = await import("../memory.test-support")
  const { cleanupPalaceFixtures, createPalaceFixture, seedPalacePeople } = await import("./palace.test-support")
  const { fakeDeps } = await import("../commands/commands.test-support")
  const { registerPeopleCommand } = await import("../commands/people")
  try {
    const fixture = await createPalaceFixture()
    await seedPalacePeople(fixture)
    const deps = fakeDeps(fixture.context)
    const pi = new MemoryFakeExtensionAPI()
    registerPeopleCommand(pi, deps)
    const loadsAfterRegistration = runtimeLoads.length

    const queries = ["", "jane", "jd", "jane doh", "--all sam-rivers"]
    const lazy: unknown[] = []
    for (const query of queries) {
      const view = surface()
      lazy.push(await observed(view, await invokeCommand(pi, "people", query, view.ctx)))
    }
    const loadsAfterFirstUse = runtimeLoads.length

    const { runPeopleCommand } = await import("./runtime")
    const eager: unknown[] = []
    for (const query of queries) {
      const view = surface()
      eager.push(await observed(view, await runPeopleCommand(deps, query, view.ctx)))
    }
    return { loadsAfterRegistration, loadsAfterFirstUse, loadsTotal: runtimeLoads.length, lazy, eager }
  } finally {
    await cleanupPalaceFixtures()
  }
}

async function startupScenario(): Promise<unknown> {
  const { MemoryFakeExtensionAPI, componentContext, loadedMemoryConfig, memorySettings } = await import("../memory.test-support")
  const { dispatchRunEnd } = await import("../../../../test-support/fake-extension-api")
  const { IdleInjectionCoordinator } = await import("../../../extension/idle-injection-coordinator")
  const { cleanupPalaceFixtures, createPalaceFixture, seedPalacePeople } = await import("./palace.test-support")
  const { createMemoryWiring } = await import("../wiring")
  try {
    const fixture = await createPalaceFixture()
    await seedPalacePeople(fixture)
    const sessionId = "palace-lazy-session"
    const memory = memorySettings()
    const pi = new MemoryFakeExtensionAPI()
    const wiring = createMemoryWiring({
      sessions: new Map([[sessionId, { context: fixture.context }]]),
      loadConfig: () => ({ ...loadedMemoryConfig(memory), config: { memory, categories: { quick: { model: "omo-mock/mock-1" } } } }),
      cwd: () => fixture.root,
      env: {},
      kibitzerChildStarter: {
        createRunner: () => ({
          start: () => new Promise(() => undefined),
        }),
      },
    })
    const branch = [{ type: "message", message: { role: "user", content: "hello" } }]
    const eventCtx = {
      sessionManager: { getSessionId: () => sessionId, getEntries: () => branch, getBranch: () => branch },
      hasPendingMessages: () => false,
      isIdle: () => true,
      cwd: fixture.root,
    }
    wiring.registerStatic(pi, { ...componentContext(), idleCoordinator: new IdleInjectionCoordinator(() => {}) })
    const loadsAfterStartup = runtimeLoads.length
    await pi.dispatch("session_start", { type: "session_start", reason: "startup" }, eventCtx)
    await pi.dispatch("input", { type: "input", source: "interactive", text: "hello" }, eventCtx)
    await pi.dispatch("before_agent_start", { type: "before_agent_start", prompt: "hello", systemPrompt: "base" }, eventCtx)
    await pi.dispatch("turn_end", { type: "turn_end" }, eventCtx)
    await dispatchRunEnd(pi, { type: "agent_end", messages: [] }, eventCtx)
    const loadsAfterTurn = runtimeLoads.length

    const first = surface({ sessionId })
    await invokeCommand(pi, "palace", "", first.ctx)
    const loadsAfterPalace = runtimeLoads.length
    const second = surface({ sessionId })
    await invokeCommand(pi, "palace", "", second.ctx)
    const third = surface({ sessionId })
    const peopleText = await invokeCommand(pi, "people", "", third.ctx)
    return {
      loadsAfterStartup,
      loadsAfterTurn,
      loadsAfterPalace,
      loadsTotal: runtimeLoads.length,
      palaceOpened: first.execCalls.map((call) => call.command),
      secondPalaceOpened: second.execCalls.map((call) => call.command),
      peopleNotified: third.notifications.length === 1 && third.notifications[0]?.message === peopleText,
    }
  } finally {
    await cleanupPalaceFixtures()
  }
}

const scenarios: Record<string, () => Promise<unknown>> = {
  palace: palaceScenario,
  people: peopleScenario,
  startup: startupScenario,
}

const scenario = scenarios[process.argv[2] ?? ""]
if (scenario === undefined) throw new Error(`unknown probe scenario: ${process.argv[2]}`)
const result = await scenario()
process.stdout.write(`PROBE_RESULT ${JSON.stringify(result)}\n`)
process.exit(0)
