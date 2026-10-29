import { describe, expect, test } from "bun:test"
import { PassThrough } from "node:stream"
import type { DesktopSyncEngineWire } from "../desktop-sync/desktopSyncAccount"
import { DesktopSyncRefused } from "../desktop-sync/desktopSyncProtocol"
import type { DesktopSyncAccount, DeviceAccountSource } from "./account-source"
import { createDeviceSessionResolver } from "./resolver"
import { selectDeviceAccountSource, type DesktopSyncAttachment } from "./selected-account-source"

// Security contract (account-transport-api v8 section 7): a launch that declares the private memory-sync channel never
// constructs the CLI credential source; only an undeclared launch does.

const cliCanary = (): DeviceAccountSource => { throw new Error("the CLI credential source was constructed on a desktop host") }
const declared = (stream: PassThrough | undefined) => ({
  declared: (name: string) => name === "memory-sync",
  take: (name: string) => (name === "memory-sync" ? stream : undefined),
})
const wire = (): DesktopSyncEngineWire & { readonly lifetime: AbortController } => {
  const lifetime = new AbortController()
  return { lifetime, signal: lifetime.signal, close: () => lifetime.abort(), onEvent: () => () => {}, request: async () => { throw new Error("unused") } }
}
const desktopAccount = (generation: string, current: () => boolean) => ({ kind: "desktop", descriptor: { generation }, isCurrent: async () => current() }) as unknown as DesktopSyncAccount

describe("selecting the one account source at registration", () => {
  test("an undeclared launch is a standalone CLI and gets the CLI source", async () => {
    let built = 0
    const source = selectDeviceAccountSource({
      inherited: { declared: () => false, take: () => { throw new Error("an undeclared channel was claimed") } },
      attach: async () => { throw new Error("an undeclared launch attached a channel") },
      cli: () => { built += 1; return async () => null },
    })
    expect(await source()).toBeNull()
    expect(built).toBe(1)
  })

  test("a declaration without a descriptor selects the unavailable desktop source, never the CLI", async () => {
    let attached: unknown = "not called"
    const source = selectDeviceAccountSource({
      inherited: declared(undefined),
      attach: async stream => { attached = stream; return { kind: "unavailable", reason: "private_channel_unavailable" } },
      cli: cliCanary,
    })
    expect(await source()).toEqual({ kind: "unavailable", reason: "private_channel_unavailable" })
    expect(attached).toBeUndefined()
  })

  test("a connected channel selects the desktop account and reopens it only when it stops being current", async () => {
    const channel = wire()
    let opened = 0
    let current = true
    const source = selectDeviceAccountSource({
      inherited: declared(new PassThrough()),
      attach: async (): Promise<DesktopSyncAttachment> => ({ kind: "connected", channel }),
      cli: cliCanary,
      openAccount: async () => { opened += 1; return desktopAccount(`generation-${opened}`, () => current) },
    })
    const first = await source()
    expect(await source()).toBe(first)
    current = false
    const second = await source()
    expect(opened).toBe(2)
    expect(second).not.toBe(first)
  })

  test("main with no account to describe is signed out, then the next resolve opens the account", async () => {
    const channel = wire()
    let signedIn = false
    const source = selectDeviceAccountSource({
      inherited: declared(new PassThrough()),
      attach: async (): Promise<DesktopSyncAttachment> => ({ kind: "connected", channel }),
      cli: cliCanary,
      openAccount: async () => { if (!signedIn) throw new DesktopSyncRefused(); return desktopAccount("generation-1", () => true) },
    })
    expect(await source()).toBeNull()
    signedIn = true
    expect((await source())?.kind).toBe("desktop")
  })

  test("a closed channel stays unavailable for the rest of the launch and sync reports why", async () => {
    const channel = wire()
    const source = selectDeviceAccountSource({
      inherited: declared(new PassThrough()),
      attach: async (): Promise<DesktopSyncAttachment> => ({ kind: "connected", channel }),
      cli: cliCanary,
      openAccount: async () => desktopAccount("generation-1", () => !channel.signal.aborted),
    })
    expect((await source())?.kind).toBe("desktop")
    channel.lifetime.abort()
    expect(await source()).toEqual({ kind: "unavailable", reason: "private_channel_unavailable" })
    const resolve = createDeviceSessionResolver({ source, pinDir: "/unused", loadRuntime: async () => { throw new Error("an unavailable source loaded the sync runtime") } })
    expect(await resolve({ paths: { repo: "/unused" }, space: { profile: "default", projectDir: "/unused" } } as never)).toEqual({ idle: "private_channel_unavailable" })
  })
})
