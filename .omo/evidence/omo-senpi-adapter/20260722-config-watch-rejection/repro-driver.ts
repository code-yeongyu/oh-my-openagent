/// <reference types="bun-types" />
// Repro: senpi's config-reload host deterministically rejects any registration
// whose watch target covers ~/.senpi/agent (auth.json/sessions/logs). The bare
// $HOME ancestor target always qualifies when cwd is under $HOME, so the host
// emits config-watch:rejected synchronously on every config-watch:register.
import { createConfigWatchComponent } from "/Users/yeongyu/local-workspaces/omo-wt/fix-config-watch-rejection/packages/omo-senpi/src/components/config-watch/index"

type Handler = (payload: unknown) => void

const sequence: string[] = []
let registerCount = 0

const listeners = new Map<string, Set<Handler>>()
const events = {
  emit(name: string, payload: unknown) {
    for (const handler of listeners.get(name) ?? []) handler(payload)
  },
  on(name: string, handler: Handler) {
    const handlers = listeners.get(name) ?? new Set<Handler>()
    handlers.add(handler)
    listeners.set(name, handlers)
    return () => handlers.delete(handler)
  },
}

// senpi host stub: restricted-target rejection is synchronous and deterministic.
events.on("config-watch:register", () => {
  registerCount += 1
  sequence.push(`REGISTER#${registerCount}`)
  events.emit("config-watch:rejected", {
    registrationId: "omo",
    paths: ["/Users/fakehome"],
    errors: ["watch target covers protected senpi agent paths"],
  })
})

const pi = {
  events,
  on() {},
  registerTool() {},
  registerCommand() {},
  registerFlag() {},
  getFlag() {
    return undefined
  },
  sendMessage() {},
  sendUserMessage() {},
}

const ctx = {
  config: { getFlag: () => undefined },
  logger: { info() {}, warn() {}, error() {} },
}

const component = createConfigWatchComponent({
  resolveCwd: () => "/Users/fakehome/work/project",
  resolveTargets: () => [
    { path: "/Users/fakehome/work/project", kind: "dir" as const, filterGlobs: [".omo"] },
    { path: "/Users/fakehome/work", kind: "dir" as const, filterGlobs: [".omo"] },
    { path: "/Users/fakehome", kind: "dir" as const, filterGlobs: [".omo"] },
  ],
  createValidator: () => ({ validate: () => ({ ok: true as const }) }),
})

let outcome: Record<string, unknown>
try {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  component.register(pi as any, ctx as any)
  await new Promise((resolve) => setTimeout(resolve, 300))
  outcome = { result: "survived", registerCount, sequence: sequence.slice(0, 12), totalEvents: sequence.length }
} catch (error) {
  outcome = {
    result: "crashed",
    error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
    registerCount,
    totalEvents: sequence.length,
  }
}
console.log(JSON.stringify(outcome, null, 2))
