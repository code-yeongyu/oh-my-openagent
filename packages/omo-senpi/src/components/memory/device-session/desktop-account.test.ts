import { describe, expect, test } from "bun:test"
import { buildIdentityPaths } from "@oh-my-opencode/memory-core"
import type { AccountSessionOptions, SyncSession } from "@oh-my-opencode/memory-core/sync-engine"
import type { DesktopSyncAccount } from "./account-source"
import * as syncRuntime from "../sync-runtime"
import { createDeviceSessionResolver, type DeviceSessionRuntime } from "./resolver"

function fixture() {
  const lifetime = new AbortController()
  const principal = { kind: "device" as const, id: "main-principal" }
  const publicKeys = { signing: "public-signing", sealing: "public-sealing" }
  const account: DesktopSyncAccount = {
    kind: "desktop",
    descriptor: {
      genesis: "supported", rpId: "recovery.example.test", userName: "desktop-account",
      serviceOrigin: "https://api.example.test",
      accountId: "desktop-account",
      serviceDeviceId: "service-device",
      syncPrincipalId: principal.id,
      publicKeys,
      generation: "generation-1",
      incarnation: "incarnation-1",
    },
    signal: lifetime.signal,
    boundary: async dispatch => dispatch(),
    keyring: {
      principal: () => principal,
      publicKeys: () => publicKeys,
      sign: async () => { throw new Error("unexpected signature") },
      unseal: async () => { throw new Error("unexpected unseal") },
    },
    chain: {
      listKeys: async () => [],
      listEntries: async () => [],
      listEntriesAfter: async () => [],
      listRecoveryWraps: async () => [],
      state: async () => null,
      appendKeys: async () => ({ ok: false, reason: "refused" }),
      recoveryJoin: async () => ({ ok: false, reason: "refused" }),
    },
    pairing: {
      openPending: async () => { throw new Error("unexpected pairing") },
      readPending: async () => null,
      listPending: async () => [],
      answerPending: async () => { throw new Error("unexpected pairing") },
      revealPending: async () => { throw new Error("unexpected pairing") },
      setAccountSync: async () => undefined,
      setDeviceSync: async () => undefined,
    },
    transport: {
      pull: async () => ({ snapshot: null, entries: [], head: 0, more: false }),
      download: async () => new Uint8Array(),
      reserve: async () => "upload",
      upload: async () => undefined,
      append: async () => ({ ok: true, seq: 1 }),
      subscribe: () => () => undefined,
    },
    devices: async () => [],
    isCurrent: async () => !lifetime.signal.aborted,
    forOperation: async () => { throw new Error("unexpected ceremony") },
  }
  const calls: AccountSessionOptions[] = []
  let factoryCalls = 0
  const session: SyncSession = {
    transport: account.transport,
    verifier: {
      verifyEntry: async () => ({ ok: true, payload: { items: [] }, batchId: "batch" }),
      verifySnapshot: async () => ({ ok: true, payload: { items: [] }, batchId: "batch" }),
    },
    sealer: { seal: async () => ({ bytes: new Uint8Array(), epoch: 1, link: "", recordSig: "" }) },
  }
  const runtime: DeviceSessionRuntime = {
    ...syncRuntime,
    listRemotes: () => [],
    resolveSpace: () => syncRuntime.resolveSpace({ get: () => null, set: () => undefined }, { profile: "personal" }),
    deviceKeyringFromMaterial: async () => {
      factoryCalls++
      throw new Error("PRIVATE-MATERIAL-CANARY")
    },
    openAccountSession: async (options) => {
      calls.push(options)
      return { ok: true, session }
    },
  }
  const resolve = (loadRuntime = async () => runtime) => createDeviceSessionResolver({
    source: async () => account,
    pinDir: "/unused-pins",
    loadRuntime,
  })({
    identity: "fixture",
    paths: buildIdentityPaths("/unused-memory", "fixture"),
    space: { profile: "personal", projectDir: "/unused-project" },
  })
  return { account, lifetime, runtime, calls, resolve, factoryCalls: () => factoryCalls }
}

describe("desktop account session ports", () => {
  test("uses the main proxy and injected ports without a private-material factory or token", async () => {
    const world = fixture()
    const opened = await world.resolve()
    expect(opened).not.toBeNull()
    expect(world.factoryCalls()).toBe(0)
    expect(world.calls[0]).toMatchObject({
      account: world.account.descriptor.accountId,
      chain: world.account.chain,
      transport: world.account.transport,
      keyring: world.account.keyring,
    })
    expect(world.calls[0]).not.toHaveProperty("token")
    expect(world.calls[0]).not.toHaveProperty("baseUrl")
  })

  test("retirement during runtime loading prevents opening a session", async () => {
    const world = fixture()
    const started = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    const opening = world.resolve(async () => {
      started.resolve()
      await release.promise
      return world.runtime
    })
    await started.promise
    world.lifetime.abort()
    release.resolve()
    expect(await opening).toBeNull()
    expect(world.calls).toEqual([])
    expect(world.factoryCalls()).toBe(0)
  })

  test("an active session ends immediately on account retirement", async () => {
    const world = fixture()
    const opened = await world.resolve()
    if (opened === null || "idle" in opened) throw new Error("expected open session")
    let ended = 0
    opened.onEnded?.(() => { ended++ })
    world.lifetime.abort()
    expect(ended).toBe(1)
  })
})
