import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createAccountHttp } from "../../../../memory-core/src/sync/account/http"
import { createPairingHttp } from "../../../../memory-core/src/sync/account/pairing-http"
import { createRejectionCounter } from "../../../../memory-core/src/sync/crypto/rejection"
import { createRecoveryBridge } from "../../../../memory-core/src/sync/recovery/bridge"
import { enrollPhraseRecoveryKey } from "../../../../memory-core/src/sync/recovery/enroll-phrase"
import { generateRecoveryPhrase, TypedPhrase } from "../../../../memory-core/src/sync/recovery/phrase"
import type { PasskeyAuthenticator } from "../../../../memory-core/src/sync/recovery/ports"
import { fakeAuthenticator } from "../../../../memory-core/src/sync/recovery/testing/fake-passkey.test-support"
import {
  createWorld,
  type Device,
  freshStateDir,
  newDevice,
  transportFor,
  type World,
} from "../../../../memory-core/src/sync/recovery/testing/world.test-support"
import { desktopRecoveryBridge } from "./desktop-sync/desktopRecoveryBridge"
import type { MemoryRpcSync } from "./memory-rpc-sync"
import type { SyncRpcAccount, SyncRpcContext, SyncRpcRegistration } from "./sync-rpc-ports"
import { wireSyncRpc } from "./sync-rpc-wiring"

const roots: string[] = []
export const removeRecoverRoots = (): void => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
}

const OFFLINE = {
  baseUrl: "https://unused.invalid",
  token: () => {
    throw new Error("unexpected HTTP request")
  },
}

export const phraseWords = (fill: number): ReadonlyArray<string> => {
  const phrase = generateRecoveryPhrase((bytes) => void bytes.fill(fill))
  const words = phrase.reveal()
  phrase.dispose()
  return words
}
export const ENROLLED = phraseWords(17)

/** Every rendering of the enrolled phrase a leak could take: words, the joined phrase and the entropy encodings. */
export const CANARIES: ReadonlyArray<string> = (() => {
  const entropy = Buffer.alloc(32, 17)
  return [
    ...new Set(ENROLLED.filter((word) => word.length >= 4)),
    ENROLLED.join(" "),
    entropy.toString("hex"),
    entropy.toString("base64"),
    entropy.toString("base64url"),
  ]
})()
export const hits = (captured: ReadonlyArray<string>): ReadonlyArray<string> =>
  CANARIES.filter((canary) => captured.some((text) => text.includes(canary)))

export const enrolledWorld = async (): Promise<World> => {
  const world = await createWorld()
  let shown: ReadonlyArray<string> = []
  const enrolled = await enrollPhraseRecoveryKey({
    anchor: world.anchor,
    account: world.account,
    keyring: world.owner.keyring,
    bridge: createRecoveryBridge(fakeAuthenticator(world.provider), world.owner.keyring, {
      phraseSurface: {
        show: async (phrase) => {
          shown = phrase.reveal()
          return true
        },
        confirm: async (positions) => new TypedPhrase(positions.map((p) => shown[p - 1] ?? "").join(" ")),
        enter: async () => null,
      },
      phraseRandom: {
        phrase: () => generateRecoveryPhrase((bytes) => void bytes.fill(17)),
        positions: () => [1, 2, 3],
      },
    }),
    chain: { ...transportFor(world, world.owner), listEntriesAfter: async () => null, state: async () => null },
    rejections: createRejectionCounter(),
    pinDir: freshStateDir(),
    phraseGate: { enabled: true, serviceFloor: async () => "on", refused: () => undefined },
  })
  if (!enrolled.ok) throw new Error("fixture enrollment failed")
  return world
}

const noPasskeys: PasskeyAuthenticator = {
  prfSupported: false,
  create: async () => null,
  assert: async () => null,
  discover: async () => null,
  signalRemoved: async () => "unsupported",
}

/** Stands in for desktop main: serves the recovery ops with the reference bridge over a scripted words surface. */
export const fakeMain = (device: Device, typed: ReadonlyArray<string | null>) => {
  let next = 0
  const bridge = createRecoveryBridge(noPasskeys, device.keyring, {
    phraseSurface: {
      show: async () => false,
      confirm: async () => null,
      enter: async () => {
        const entry = typed[next++] ?? null
        return entry === null ? null : new TypedPhrase(entry)
      },
    },
  })
  return async (op: string, data: unknown): Promise<unknown> => {
    const request = Object(data)
    if (op === "recoverBeginPhrase") return { op: "recoverBegin", ...(await bridge.recoverBeginWithPhrase?.(request)) }
    if (op === "recoverFinish") return { op: "recoverFinish", ...(await bridge.recoverFinish(request)) }
    if (op === "recoverAbort") {
      await bridge.recoverAbort(String(Reflect.get(request, "handle")))
      return { op: "recoverAbort" }
    }
    return { op: "recoverBegin", ok: false, reason: "unavailable" }
  }
}

export type MainServe = (op: string, data: unknown) => Promise<unknown>

export const consent = (failDevice = false) => {
  const state = { account: false, device: false }
  return {
    state,
    pull: (): 200 | 403 => (state.account && state.device ? 200 : 403),
    setAccountSync: async (on: boolean) => {
      state.account = on
    },
    setDeviceSync: async (_device: string, on: boolean) => {
      if (failDevice) throw new Error("device switch unavailable")
      state.device = on
    },
  }
}

export const context = (id: string): SyncRpcContext => ({
  ownerId: id,
  disconnectSignal: new AbortController().signal,
  admit: (dispatch) => dispatch(),
})

/** The real wiring (`wireSyncRpc` and its runtime) over a world, with every sink the canary greps captured. */
export async function recoverHarness(input: {
  readonly world: World
  readonly device?: Device
  readonly main: (device: Device) => MainServe
  readonly phraseRecover?: "supported" | "unsupported"
  readonly pinDir?: string
  readonly gate?: ReturnType<typeof consent>
  readonly chain?: Record<string, unknown>
  readonly rpId?: string
  readonly prfSupported?: boolean
  readonly syncStatus?: () => Promise<MemoryRpcSync | undefined>
}) {
  const device = input.device ?? (await newDevice())
  const frames: string[] = []
  const warnings: string[] = []
  const logs: string[] = []
  const gate = input.gate ?? consent()
  let resumes = 0
  const serve = input.main(device)
  const account: SyncRpcAccount = {
    descriptor: {
      genesis: "unsupported",
      phraseRecover: input.phraseRecover ?? "supported",
      rpId: input.rpId ?? null,
      userName: null,
      serviceOrigin: OFFLINE.baseUrl,
      accountId: input.world.account,
      serviceDeviceId: "svc-fresh",
      syncPrincipalId: device.keyring.principal().id,
      publicKeys: device.keyring.publicKeys(),
      generation: "generation-1",
      incarnation: "main-1",
    },
    signal: new AbortController().signal,
    isCurrent: async () => true,
    boundary: async (dispatch) => dispatch(),
    forOperation: async () => ({
      keyring: device.keyring,
      chain: { ...createAccountHttp(OFFLINE), ...transportFor(input.world, device), ...input.chain },
      pairing: {
        ...createPairingHttp(OFFLINE),
        setAccountSync: gate.setAccountSync,
        setDeviceSync: gate.setDeviceSync,
      },
      devices: async () => [],
      close: async () => undefined,
      recovery: (report) =>
        desktopRecoveryBridge(
          {
            request: async ({ op, data }) => {
              frames.push(JSON.stringify({ op, data }))
              const reply = await serve(op, data)
              frames.push(JSON.stringify(reply))
              return reply
            },
          },
          input.prfSupported ?? false,
          report,
        ),
    }),
  }
  const handlers = new Map<string, Parameters<SyncRpcRegistration["handle"]>[1]>()
  const memoryRoot = mkdtempSync(join(tmpdir(), "omo-recover-rpc-"))
  roots.push(memoryRoot)
  const coordinator = wireSyncRpc({
    rpc: { handle: (name, handler) => void handlers.set(name, handler) },
    source: async () => account,
    memoryRoot,
    pinDir: input.pinDir ?? freshStateDir(),
    signal: new AbortController().signal,
    syncStatus: input.syncStatus ?? (async () => undefined),
    resumeSync: async () => {
      resumes += 1
    },
    env: {},
    logger: { error: (message, fields) => void logs.push(JSON.stringify({ message, fields })) },
    warn: (message, fields) => void warnings.push(JSON.stringify({ message, fields })),
  })
  const transcript: string[] = []
  const call = async (verb: string, data: unknown = {}, owner = context("desktop")): Promise<unknown> => {
    const handler = handlers.get(`omo.memory.sync.${verb}`)
    if (handler === undefined) throw new Error(`no ${verb}`)
    transcript.push(JSON.stringify({ verb, data }))
    const answer = await handler(data, owner)
    transcript.push(JSON.stringify(answer))
    return answer
  }
  return {
    device,
    account,
    memoryRoot,
    call,
    gate,
    coordinator,
    sinks: () => [...frames, ...warnings, ...logs, ...transcript],
    frames,
    warnings,
    resumes: () => resumes,
  }
}
