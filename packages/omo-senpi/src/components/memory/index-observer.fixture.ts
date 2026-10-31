// Run in a fresh process so the import-time observer cannot satisfy registration's obligation.
import process from "node:process"

const beforeImport = new Set(process.listeners("worker"))
await import("@oh-my-opencode/team-core/team-state-store/lock-worker-lifetime")
const imported = process.listeners("worker").filter(listener => !beforeImport.has(listener))
const observer = imported[0]
if (imported.length !== 1 || observer === undefined) throw new Error("expected one team-core import-time observer")
const lifetime = globalThis.__omoTeamLockLifetimeV1
if (lifetime === undefined) throw new Error("missing team-core lifetime state")
process.off("worker", observer)
lifetime.installed = false

const { createMemoryComponent } = await import("./index")
const { MemoryFakeExtensionAPI, componentContext, loadedMemoryConfig, memorySettings } = await import("./memory.test-support")
const scenario = process.argv[2]
const register = () => createMemoryComponent({
  env: { OMO_MEMORY_HOME: process.env.TMPDIR },
  loadConfig: () => loadedMemoryConfig(memorySettings()),
  sweepTransientRuns: async () => ({ removedRuns: 0, removedIdentities: 0, promoted: 0, stranded: 0, kept: 0 }),
  ...(scenario === "observer-override"
    ? { deviceAccount: async () => ({ kind: "unavailable" as const, reason: "selection_failed" as const }) }
    : {}),
}).register(new MemoryFakeExtensionAPI(), componentContext())

const count = () => process.listeners("worker").filter(listener => listener === observer).length
const observersBefore = count()
register()
const observersAfterFirst = count()
if (scenario === "observer-twice") register()
process.stdout.write(`${JSON.stringify({ observersBefore, observersAfterFirst, observersAfterSecond: count() })}\n`)
process.exit(0)
