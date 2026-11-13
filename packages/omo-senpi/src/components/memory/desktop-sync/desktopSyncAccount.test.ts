import { describe, expect, test } from "bun:test"
import type { DesktopSyncDescriptor } from "@oh-my-opencode/memory-core/sync-engine"
import { openDesktopSyncAccount, type DesktopSyncEngineWire } from "./desktopSyncAccount"
import type { DesktopSyncRequest } from "./desktopSyncProtocol"

// Contract (account-transport-api v11 section 6): the genesis bridge is bound to the operation's own main-issued
// handle, offered only when the descriptor supports genesis, and never runs on the background account handle.

const descriptor = (genesis: "supported" | "unsupported", phraseGenesis?: "supported"): DesktopSyncDescriptor => ({
  genesis,
  ...(phraseGenesis === undefined ? {} : { phraseGenesis }),
  rpId: genesis === "supported" ? "recovery.example.test" : null,
  userName: genesis === "supported" ? "account-1" : null,
  serviceOrigin: "https://api.example.test",
  accountId: "account-1",
  serviceDeviceId: "device-1",
  syncPrincipalId: "principal-1",
  publicKeys: { signing: "signing-1", sealing: "sealing-1" },
  generation: "generation-1",
  incarnation: "incarnation-1",
})

type ServiceReply = { readonly kind: "json"; readonly status: number; readonly body: unknown }

function fakeMain(
  genesis: "supported" | "unsupported",
  options: {
    readonly phraseGenesis?: "supported"
    readonly service?: (data: Record<string, unknown>) => ServiceReply
  } = {},
) {
  const sent: DesktopSyncRequest[] = []
  let handles = 0
  const lifetime = new AbortController()
  const wire: DesktopSyncEngineWire = {
    signal: lifetime.signal,
    close: () => lifetime.abort(),
    onEvent: () => () => {},
    request: async (request) => {
      sent.push(request)
      switch (request.op) {
        case "descriptor":
          return descriptor(genesis, options.phraseGenesis)
        case "operationBegin":
          handles += 1
          return { handle: `h-${handles}` }
        case "capability":
          return { prfSupported: true, genesisSupported: true }
        case "genesisRun":
        case "phraseGenesisRun":
          return { ok: false, reason: "cancelled" }
        case "service":
          return (
            options.service?.(("data" in request ? request.data : {}) as Record<string, unknown>) ?? {
              kind: "json",
              status: 200,
              body: {},
            }
          )
        default:
          return {}
      }
    },
  }
  return { wire, sent }
}
const owner = () => ({ signal: new AbortController().signal, admit: <T>(effect: () => T) => effect() })

describe("the desktop operation genesis bridge", () => {
  test("runs on the operation's own handle under the caller's admission", async () => {
    const main = fakeMain("supported")
    const account = await openDesktopSyncAccount(main.wire, "/unused")
    const operation = await account.forOperation(owner())
    if (operation.genesis === undefined) throw new Error("a genesis-capable account offered no bridge")
    expect(operation.genesis.prfSupported).toBe(true)
    let admitted = 0
    const result = await operation.genesis.createGenesis(
      {
        account: "account-1",
        rpId: "recovery.example.test",
        userName: "account-1",
        roaming: false,
        firstDevice: { kind: "device", id: "d", signing_public_key: "s", sealing_public_key: "e" },
      },
      {
        operation: {
          signal: new AbortController().signal,
          admit: (effect) => {
            admitted += 1
            return effect()
          },
        },
      },
    )
    expect(result).toEqual({ ok: false, reason: "cancelled" })
    expect(admitted).toBe(1)
    const begins = main.sent.filter((request) => request.op === "operationBegin").length
    const run = main.sent.find((request) => request.op === "genesisRun")
    expect(begins).toBe(2)
    expect(run !== undefined && "handle" in run ? run.handle : undefined).toBe("h-2")
  })

  test("is absent when main does not support genesis", async () => {
    const main = fakeMain("unsupported")
    const account = await openDesktopSyncAccount(main.wire, "/unused")
    const operation = await account.forOperation(owner())
    expect(operation.genesis).toBeUndefined()
    expect(main.sent.some((request) => request.op === "capability")).toBe(false)
  })

  test("is never offered on the background account ports", async () => {
    const account = await openDesktopSyncAccount(fakeMain("supported").wire, "/unused")
    expect("genesis" in account).toBe(false)
  })
})

const STATE = { head: { seq: 3, link: "l", keyring_link: "k" }, current_epoch: 1, rotation_pending: false }
const firstDevice = { kind: "device" as const, id: "d", signing_public_key: "s", sealing_public_key: "e" }
const operationAuthority = () => ({ signal: new AbortController().signal, admit: <T>(effect: () => T) => effect() })

describe("the desktop phrase genesis path (A3 part 2a)", () => {
  test("a phrase-only descriptor offers a phrase bridge without asking main for the passkey capability", async () => {
    const main = fakeMain("unsupported", { phraseGenesis: "supported" })
    const account = await openDesktopSyncAccount(main.wire, "/unused")
    const operation = await account.forOperation(owner())
    if (operation.genesis?.createPhraseGenesis === undefined)
      throw new Error("a phrase-capable account offered no phrase bridge")
    expect(operation.genesis.phraseSupported).toBe(true)
    expect(operation.genesis.prfSupported).toBe(false)
    expect(main.sent.some((request) => request.op === "capability")).toBe(false)
    const result = await operation.genesis.createPhraseGenesis(
      { account: "account-1", firstDevice },
      { operation: operationAuthority() },
    )
    expect(result).toEqual({ ok: false, reason: "cancelled" })
    const run = main.sent.find((request) => request.op === "phraseGenesisRun")
    expect(run !== undefined && "handle" in run ? run.handle : undefined).toBe("h-2")
  })

  test("a descriptor without the phrase flag offers no phrase bridge", async () => {
    const main = fakeMain("supported")
    const operation = await (await openDesktopSyncAccount(main.wire, "/unused")).forOperation(owner())
    expect(operation.genesis?.createPhraseGenesis).toBeUndefined()
  })

  test("every service request carries the engine's sync capability for main to pass through", async () => {
    const main = fakeMain("unsupported", { service: () => ({ kind: "json", status: 200, body: STATE }) })
    const operation = await (await openDesktopSyncAccount(main.wire, "/unused")).forOperation(owner())
    await operation.chain.state()
    const services = main.sent.filter((request) => request.op === "service")
    expect(services.length).toBeGreaterThan(0)
    expect(
      services.map((request) =>
        "data" in request ? (request.data as Record<string, unknown>)["syncCapabilities"] : undefined,
      ),
    ).toEqual(services.map(() => "phrase"))
  })
})

describe("the desktop account ports for phrase keys (A3 part 2a)", () => {
  for (const [label, body, expected] of [
    ["accepts_phrase_keys true", { ...STATE, accepts_phrase_keys: true }, true],
    ["accepts_phrase_keys false", { ...STATE, accepts_phrase_keys: false }, false],
    ["accepts_phrase_keys absent (an older service)", STATE, false],
  ] as const) {
    test(`a state reply with ${label} reads acceptsPhraseKeys ${expected}`, async () => {
      const main = fakeMain("unsupported", { service: () => ({ kind: "json", status: 200, body }) })
      const operation = await (await openDesktopSyncAccount(main.wire, "/unused")).forOperation(owner())
      expect((await operation.chain.state())?.acceptsPhraseKeys).toBe(expected)
    })
  }

  test("the service's phrase_keys_not_accepted refusal reaches the engine as a typed refusal", async () => {
    const main = fakeMain("unsupported", {
      service: () => ({ kind: "json", status: 409, body: { error: { code: "phrase_keys_not_accepted" } } }),
    })
    const operation = await (await openDesktopSyncAccount(main.wire, "/unused")).forOperation(owner())
    const request = { record: {}, base_seq: 0, link: "l", keyring_link: "k", record_sig: "s", wraps: [] }
    expect(await operation.chain.appendKeys(request as Parameters<typeof operation.chain.appendKeys>[0])).toEqual({
      ok: false,
      reason: "phrase_keys_not_accepted",
    })
  })
})
