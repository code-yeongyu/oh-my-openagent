import { describe, expect, test } from "bun:test"
import { join } from "node:path"
import type { DesktopSyncEngineWire } from "../desktop-sync/desktopSyncAccount"
import { DesktopSyncRefused } from "../desktop-sync/desktopSyncProtocol"
import type { MemorySyncSelection } from "../desktop-sync/hostSelection"
import type { DesktopSyncAccount, DeviceAccountSource } from "./account-source"
import { createDeviceSessionResolver } from "./resolver"
import { accountSourceFromSelection } from "./selected-account-source"

// Security contract (account-transport-api v9 section 7): a desktop host never constructs the CLI credential source,
// in the main thread or in any session Worker; only a CLI selection does, and only the main thread selects.

const cliCanary = (): DeviceAccountSource => { throw new Error("the CLI credential source was constructed on a desktop host") }
const wire = (): DesktopSyncEngineWire & { readonly lifetime: AbortController } => {
  const lifetime = new AbortController()
  return { lifetime, signal: lifetime.signal, close: () => lifetime.abort(), onEvent: () => () => {}, request: async () => { throw new Error("unused") } }
}
const desktopAccount = (generation: string, current: () => boolean) => ({ kind: "desktop", descriptor: { generation }, isCurrent: async () => current() }) as unknown as DesktopSyncAccount
const desktop = (channel: DesktopSyncEngineWire) => async (): Promise<MemorySyncSelection> => ({ kind: "desktop", channel })

describe("the account source built from the engine's one selection", () => {
  test("a CLI selection builds the CLI source once", async () => {
    let built = 0
    const source = accountSourceFromSelection({ selection: async () => ({ kind: "cli" }), cli: () => { built += 1; return async () => null } })
    expect(await source()).toBeNull()
    expect(await source()).toBeNull()
    expect(built).toBe(1)
  })

  test("an unavailable selection passes its reason through and never builds the CLI source", async () => {
    for (const reason of ["private_channel_unavailable", "platform_not_supported"] as const) {
      const source = accountSourceFromSelection({ selection: async () => ({ kind: "unavailable", reason }), cli: cliCanary })
      expect(await source()).toEqual({ kind: "unavailable", reason })
    }
  })

  test("a desktop selection opens the account and reopens it only when it stops being current", async () => {
    const channel = wire()
    let opened = 0
    let current = true
    const source = accountSourceFromSelection({
      selection: desktop(channel), cli: cliCanary,
      openAccount: async () => { opened += 1; return desktopAccount(`generation-${opened}`, () => current) },
    })
    const first = await source()
    expect(await source()).toBe(first)
    current = false
    expect(await source()).not.toBe(first)
    expect(opened).toBe(2)
  })

  test("main with no account to describe is signed out, then the next resolve opens the account", async () => {
    let signedIn = false
    const source = accountSourceFromSelection({
      selection: desktop(wire()), cli: cliCanary,
      openAccount: async () => { if (!signedIn) throw new DesktopSyncRefused(); return desktopAccount("generation-1", () => true) },
    })
    expect(await source()).toBeNull()
    signedIn = true
    expect((await source())?.kind).toBe("desktop")
  })

  test("a closed channel stays unavailable and the resolver reports why without loading the sync runtime", async () => {
    const channel = wire()
    const source = accountSourceFromSelection({
      selection: desktop(channel), cli: cliCanary,
      openAccount: async () => desktopAccount("generation-1", () => !channel.signal.aborted),
    })
    expect((await source())?.kind).toBe("desktop")
    channel.lifetime.abort()
    expect(await source()).toEqual({ kind: "unavailable", reason: "private_channel_unavailable" })
    const resolve = createDeviceSessionResolver({ source, pinDir: "/unused", loadRuntime: async () => { throw new Error("an unavailable source loaded the sync runtime") } })
    expect(await resolve({ paths: { repo: "/unused" }, space: { profile: "default", projectDir: "/unused" } } as never)).toEqual({ idle: "private_channel_unavailable" })
  })
})

type EngineReport = { readonly source: string; readonly cliBuilt: boolean; readonly handle?: string; readonly foreignEnd?: string; readonly events?: readonly string[] }
async function engine(scenario: string): Promise<{ readonly claims: number; readonly ends: number; readonly reports: readonly EngineReport[]; readonly open?: readonly string[] }> {
  const child = Bun.spawn([process.execPath, join(import.meta.dirname, "../desktop-sync/hostSelection.fixture.ts"), scenario], { stdout: "pipe", stderr: "pipe" })
  const deadline = new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`the ${scenario} engine fixture did not exit within 20s`)), 20_000))
  const code = await Promise.race([child.exited, deadline])
  const out = await new Response(child.stdout).text()
  if (code !== 0) throw new Error(`engine fixture ${scenario} exited ${code}: ${await new Response(child.stderr).text()}`)
  return JSON.parse(out)
}

describe("session Workers in a shared-worker engine", () => {
  for (const scenario of ["desktop", "late"] as const) {
    test(`a ${scenario} desktop launch: each Worker owns only its handles and events on its own port, with one claim`, async () => {
      const result = await engine(scenario)
      expect(result.claims).toBe(1)
      expect(result.ends).toBe(2)
      // The engine exits by lifecycle: every port, channel and proxy handle is closed, nothing keeps it alive.
      expect(result.open).toEqual([])
      const [a, b] = result.reports
      if (a === undefined || b === undefined) throw new Error("missing Worker report")
      expect(new Set([a.handle, b.handle]).size).toBe(2)
      for (const report of result.reports) {
        expect(report.source).toBe("desktop")
        expect(report.cliBuilt).toBe(false)
        expect(report.foreignEnd).toBe("refused")
        expect(report.events?.length).toBeGreaterThan(0)
        expect(new Set(report.events)).toEqual(new Set([report.handle ?? ""]))
      }
    }, 30_000)
  }

  for (const scenario of ["declared-null", "unparseable"] as const) {
    test(`a ${scenario} launch: every Worker gets the unavailable desktop source, never the CLI`, async () => {
      const result = await engine(scenario)
      expect(result.claims).toBe(1)
      for (const report of result.reports) expect(report).toEqual({ source: "unavailable:private_channel_unavailable", cliBuilt: false })
    }, 30_000)
  }

  test("an in-process host: the main-thread registration reads the one selection and gets the desktop source", async () => {
    const result = await engine("in-process")
    expect(result.claims).toBe(1)
    expect(result.reports).toEqual([{ source: "desktop", cliBuilt: false }])
  }, 30_000)

  test("an attachment that connects after the deadline is closed, and the unavailable answer stands", async () => {
    const result = await engine("late-connected") as unknown as { claims: number; answer: string; closed: string; opened: boolean; source: string }
    expect(result.claims).toBe(1)
    expect(result.answer).toBe("unavailable:private_channel_unavailable")
    expect(result.closed).toBe("closed")
    expect(result.opened).toBe(false)
    expect(result.source).toBe("unavailable:private_channel_unavailable")
  }, 30_000)

  test("the selection is memoized per process: a second call returns the first and claims nothing again", async () => {
    const result = await engine("memoized") as unknown as { claims: number; same: boolean; first: string; second: string }
    expect(result.same).toBe(true)
    expect(result.claims).toBe(1)
    expect(result.second).toBe(result.first)
    expect(result.first).toBe("desktop")
  }, 30_000)

  test("an undeclared launch: Workers get the CLI selection and nothing is claimed", async () => {
    const result = await engine("cli")
    expect(result.claims).toBe(0)
    for (const report of result.reports) expect(report).toEqual({ source: "null", cliBuilt: true })
  }, 30_000)

  const failClosed: readonly [string, string][] = [
    ["no-port", "unavailable:host_bootstrap_absent"],
    ["throwing", "unavailable:selection_failed"],
    ["malformed", "unavailable:selection_failed"],
    ["hang", "unavailable:private_channel_unavailable"],
  ]
  for (const [scenario, expected] of failClosed) {
    test(`a ${scenario} launch: Workers are unavailable (${expected}), never the CLI`, async () => {
      const result = await engine(scenario)
      for (const report of result.reports) expect(report).toEqual({ source: expected, cliBuilt: false })
    }, 30_000)
  }
})
