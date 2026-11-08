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
    for (const reason of ["private_channel_unavailable", "selection_failed"] as const) {
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

  test("#given no account is current #when two resolves overlap #then they share one open and get the same account", async () => {
    // given
    let opened = 0
    let release: () => void = () => {}
    const gate = new Promise<void>((resolve) => { release = resolve })
    const source = accountSourceFromSelection({
      selection: desktop(wire()), cli: cliCanary,
      openAccount: async () => { opened += 1; await gate; return desktopAccount(`generation-${opened}`, () => true) },
    })

    // when
    const first = source()
    const second = source()
    release()

    // then
    const [a, b] = await Promise.all([first, second])
    expect(opened).toBe(1)
    expect(b).toBe(a)
  })

  test("#given a shared open that main refuses #when it settles #then both resolves are signed out and the next resolve opens again", async () => {
    // given
    let opened = 0
    const source = accountSourceFromSelection({
      selection: desktop(wire()), cli: cliCanary,
      openAccount: async () => { opened += 1; if (opened === 1) throw new DesktopSyncRefused(); return desktopAccount("generation-2", () => true) },
    })

    // when
    const both = await Promise.all([source(), source()])
    const next = await source()

    // then
    expect(both).toEqual([null, null])
    expect(next?.kind).toBe("desktop")
    expect(opened).toBe(2)
  })

  test("#given a resolve still checking an old account #when another resolve stores a fresh one first #then the late resolve returns the fresh account and nothing reopens (#12804)", async () => {
    // given: generation-1 is stored; each later isCurrent() check on it waits on its own deferred answer
    let opened = 0
    const checks: PromiseWithResolvers<boolean>[] = []
    const stale = { kind: "desktop", descriptor: { generation: "generation-1" }, isCurrent: () => { const check = Promise.withResolvers<boolean>(); checks.push(check); return check.promise } } as unknown as DesktopSyncAccount
    const source = accountSourceFromSelection({
      selection: desktop(wire()), cli: cliCanary,
      openAccount: async () => { opened += 1; return opened === 1 ? stale : desktopAccount(`generation-${opened}`, () => true) },
    })
    expect(await source()).toBe(stale)

    // when: A starts checking the old account, then B checks it too, finds it stale and stores generation-2
    const late = source()
    const early = source()
    while (checks.length < 2) await Promise.resolve()
    checks[1]?.resolve(false)
    const fresh = await early
    checks[0]?.resolve(false)

    // then
    expect((fresh as DesktopSyncAccount).descriptor.generation).toBe("generation-2")
    expect(await late).toBe(fresh)
    expect(await source()).toBe(fresh)
    expect(opened).toBe(2)
  })

  test("#given a shared open that settles #when a resolve starts at any microtask while it settles #then it gets the stored account and nothing reopens (#12804)", async () => {
    // The gap between the open settling and its waiter storing the account is a few microtasks wide, and how many
    // depends on the engine's await and finally steps, so the late resolve starts at every offset across it. Under
    // Node (the default engine runtime) `finally` reaches its waiter later than under Bun; an open whose
    // then-callbacks each run one microtask late reproduces that width here.
    class LateSettling<T> extends Promise<T> {
      override then<A = T, B = never>(onFulfilled?: ((value: T) => A | PromiseLike<A>) | null, onRejected?: ((reason: unknown) => B | PromiseLike<B>) | null): Promise<A | B> {
        const late = onFulfilled == null ? onFulfilled : (value: T) => Promise.resolve().then(() => onFulfilled(value))
        return super.then(late, onRejected)
      }
    }
    for (let offset = 0; offset <= 12; offset += 1) {
      // given: the open returns this exact promise, so a reaction the test adds to it runs right after the source's own
      let opened = 0
      const called = Promise.withResolvers<void>()
      const pending = LateSettling.withResolvers<DesktopSyncAccount>()
      const source = accountSourceFromSelection({
        selection: desktop(wire()), cli: cliCanary,
        openAccount: () => { opened += 1; called.resolve(); return opened === 1 ? pending.promise : Promise.resolve(desktopAccount(`generation-${opened}`, () => true)) },
      })
      const first = source()
      await called.promise

      // when
      let second: Promise<unknown> | undefined
      const started = pending.promise.then(async () => {
        for (let tick = 0; tick < offset; tick += 1) await Promise.resolve()
        second = source()
      })
      pending.resolve(desktopAccount("generation-1", () => true))
      await started

      // then
      const stored = await first
      expect({ offset, same: await second === stored, opened }).toEqual({ offset, same: true, opened: 1 })
    }
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
