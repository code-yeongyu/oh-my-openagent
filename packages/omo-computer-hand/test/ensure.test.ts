import { join } from "node:path"
import { describe, expect, it } from "vitest"

import {
  createAttachOnlyHost,
  createHandEnsure,
  DaemonLauncher,
  type DaemonLink,
  type EnsureReply,
} from "../src/index.ts"
import { fakeAuthority, fakeChild, type FakeChild } from "./support/fakes.ts"
import { tempDirs } from "./support/tmp.ts"

const temp = tempDirs("omo-hand-ensure-")

function spawningHost(remoteCommands: () => boolean) {
  const root = temp()
  const children: FakeChild[] = []
  const authority = fakeAuthority()
  const launcher = new DaemonLauncher({
    engine: "/opt/omo-computer-engine",
    endpoint: join(root, "engine.sock"),
    lock: join(root, "engine.lock"),
    env: {},
    latch: () => ({ suspended: false, stopEpoch: 0 }),
    isListening: async () => false,
    spawnDaemon: () => {
      const child = fakeChild()
      children.push(child)
      return child
    },
    connectAuthority: async () => authority,
  })
  return {
    ensure: createHandEnsure({ launcher, remoteCommandsEnabled: remoteCommands }),
    children,
    authority,
    endpoint: join(root, "engine.sock"),
  }
}

describe("hand.ensure (the one attach rule)", () => {
  it("registers the caller as (pid, processStart) on the authority link and returns a capability bound to it", async () => {
    // Given a spawning host with no daemon yet.
    const host = spawningHost(() => true)

    // When two attach-only callers ensure.
    const first = await host.ensure({ pid: 501, processStart: 11 })
    const second = await host.ensure({ pid: 502, processStart: 12 })

    // Then one daemon serves both, each caller got its own capability, registered under its identity.
    expect(host.children).toHaveLength(1)
    expect(first).toMatchObject({ kind: "ensured", endpoint: host.endpoint, generation: 1 })
    expect(second.kind === "ensured" && first.kind === "ensured" && second.capability !== first.capability).toBe(true)
    expect(host.authority.calls.filter((call) => call.method === "hand.register").map((call) => call.params)).toEqual([
      { pid: 501, processStart: 11 },
      { pid: 502, processStart: 12 },
    ])
  })

  it("the hand-wide remote-commands switch off refuses before any engine process exists", async () => {
    const host = spawningHost(() => false)
    expect(await host.ensure({ pid: 501, processStart: 11 })).toEqual({
      kind: "refused",
      code: "RemoteCommandsDisabled",
    })
    expect(host.children).toEqual([])
    expect(host.authority.calls).toEqual([])
  })

  it("attach_only_profile_never_spawns", async () => {
    // Given two attach-only hosts whose only route to the engine is the spawning host's hand.ensure.
    const host = spawningHost(() => true)
    const ensures: number[] = []
    const dialed: Array<{ endpoint: string; capability: string }> = []
    const attachOnly = (pid: number) =>
      createAttachOnlyHost({
        self: { pid, processStart: pid * 10 },
        ensure: async (caller): Promise<EnsureReply> => {
          ensures.push(caller.pid)
          return host.ensure(caller)
        },
        connect: async (endpoint, capability): Promise<DaemonLink> => {
          dialed.push({ endpoint, capability: capability.toString("hex") })
          return fakeAuthority()
        },
      })

    // When each attaches twice, a daemon already serving after the first.
    const a = attachOnly(601)
    const b = attachOnly(602)
    for (const attacher of [a, a, b, b]) expect((await attacher.attach()).kind).toBe("attached")

    // Then hand.ensure ran before EVERY attach, each dial used the capability ensure returned, and only the spawning host spawned, once.
    expect(ensures).toEqual([601, 601, 602, 602])
    expect(new Set(dialed.map((dial) => dial.capability)).size).toBe(4)
    expect(dialed.every((dial) => dial.endpoint === host.endpoint)).toBe(true)
    expect(host.children).toHaveLength(1)
  })

  it("an ensure that refuses leaves the attach-only host unattached: it never dials", async () => {
    const host = spawningHost(() => false)
    let dials = 0
    const attachOnly = createAttachOnlyHost({
      self: { pid: 700, processStart: 1 },
      ensure: host.ensure,
      connect: async () => {
        dials += 1
        return fakeAuthority()
      },
    })
    expect(await attachOnly.attach()).toEqual({ kind: "refused", code: "RemoteCommandsDisabled" })
    expect(dials).toBe(0)
  })
})
