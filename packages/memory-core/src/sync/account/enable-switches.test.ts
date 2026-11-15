import { afterEach, expect, test } from "bun:test"
import { creatorAnchor } from "../crypto/anchor.ts"
import { appendEntries, emptyChain } from "../crypto/chain.ts"
import { createRejectionCounter } from "../crypto/rejection.ts"
import { pinTrustAnchor } from "../crypto/trust-pin.ts"
import { entryOf, deviceKeyring } from "../genesis/vector.test-support.ts"
import { enableSync } from "./enable.ts"
import { createAccountHttp } from "./http.ts"
import { createPairingHttp } from "./pairing-http.ts"
import { ACCOUNT, fixture } from "./testing/genesis-enable.test-support.ts"
import { readdir } from "node:fs/promises"
import { join } from "node:path"
import { forgetTrustAnchor, loadTrustAnchor } from "../crypto/trust-pin.ts"
import { approveDevice } from "./approve.ts"
import { joinAccount, principalOf } from "./join.ts"
import { openAccountSession } from "./session.ts"

const cleanups: (() => Promise<void>)[] = []
afterEach(async () => {
  for (const close of cleanups.splice(0).reverse()) await close()
})

for (const member of ["pinned", "joiner", "resume", "creator"] as const) {
  test.each([
    [false, true],
    [true, false],
    [false, false],
  ])(`${member} restores both switches from %j`, async (accountOn, deviceOn) => {
    const f = await fixture()
    cleanups.push(f.close)
    if (member === "pinned" || member === "joiner") f.entries.push(await entryOf(f.built.request, f.keyring))
    if (member === "pinned") {
      const walked = await appendEntries(
        emptyChain(ACCOUNT, creatorAnchor(ACCOUNT, f.keyring)),
        f.entries,
        createRejectionCounter(),
      )
      if (!walked.ok || walked.state.pin === null) throw new Error("fixture pin")
      await pinTrustAnchor(f.input.pinDir, ACCOUNT, walked.state.pin)
    }
    if (member === "resume") {
      await expect(
        enableSync({
          ...f.input,
          chain: {
            ...f.input.chain,
            appendKeys: async (request) => {
              await f.input.chain.appendKeys(request)
              throw new TypeError("lost ack")
            },
          },
        }),
      ).rejects.toThrow()
    }
    const keyring = member === "joiner" ? await deviceKeyring(12) : f.keyring
    const token = f.server.tokenFor(
      {
        ...keyring.principal(),
        sealing_public_key: keyring.publicKeys().sealing,
        signing_public_key: keyring.publicKeys().signing,
      },
      "service-first",
    )
    await createPairingHttp({ baseUrl: f.server.url, token: () => token }).setAccountSync(accountOn)
    await createPairingHttp({ baseUrl: f.server.url, token: () => token }).setDeviceSync("service-first", deviceOn)
    f.server.switches.length = 0
    const outcome = await enableSync({
      ...f.input,
      keyring,
      chain: createAccountHttp({ baseUrl: f.server.url, token: () => token }),
      pairing: createPairingHttp({ baseUrl: f.server.url, token: () => token }),
    })
    expect(outcome.kind).toBe(member === "joiner" ? "join_required" : "joined")
    expect(f.server.switches).toEqual([
      '/v1/account/sync {"enabled":true}',
      '/v1/devices/service-first/sync {"enabled":true}',
    ])
    expect(f.server.enabled("service-first")).toBe(true)
    expect(
      (await fetch(`${f.server.url}/v1/sync/batches?after=0`, { headers: { authorization: `Bearer ${token}` } }))
        .status,
    ).toBe(200)
  })
}

for (const missing of ["serviceOrigin", "rpId", "userName"] as const) {
  test(`a genesis-capable first device missing ${missing} is refused with both switches left off`, async () => {
    const f = await fixture()
    cleanups.push(f.close)
    await expect(enableSync({ ...f.input, [missing]: undefined })).rejects.toMatchObject({
      reason: "missing_configuration",
    })
    expect(f.server.switches).toEqual([])
    expect(f.server.enabled("service-first")).toBe(false)
    expect(f.ceremonies()).toBe(0)
  })
}

test("a first device without the genesis bridge needs a first device and leaves both switches off", async () => {
  const f = await fixture()
  cleanups.push(f.close)
  expect(await enableSync({ ...f.input, genesis: { ...f.input.genesis, prfSupported: false } })).toEqual({
    kind: "needs_first_device",
  })
  expect(f.server.switches).toEqual([])
  expect(f.ceremonies()).toBe(0)
})

test("a failed device switch never disables the account or reports success", async () => {
  const f = await fixture()
  cleanups.push(f.close)
  await expect(
    enableSync({
      ...f.input,
      pairing: {
        ...f.input.pairing,
        setDeviceSync: async () => {
          throw new Error("synthetic write failure")
        },
      },
    }),
  ).rejects.toThrow("synthetic write failure")
  expect(f.server.switches).toEqual(['/v1/account/sync {"enabled":true}'])
  expect(f.ceremonies()).toBe(0)
})

// #12280 R-B5: after a retire, no read path re-learns the pin from the served chain; only the pairing
// ceremony pins again (the #10298 rule).
test("#given a joined device whose pin was retired #when it opens a session and runs enable against a valid served chain #then no pin is written, and only the pairing join pins again", async () => {
  const f = await fixture()
  cleanups.push(f.close)
  expect(await enableSync(f.input)).toEqual({ kind: "joined", created: true })
  const second = await deviceKeyring(20)
  const token = f.server.tokenFor(principalOf(second), "service-second")
  const http = { baseUrl: f.server.url, token: () => token }
  const joiner = {
    account: ACCOUNT,
    keyring: second,
    pinDir: join(f.input.pinDir, "second"),
    chain: createAccountHttp(http),
    pairing: createPairingHttp(http),
  }
  /** A ceremony clock whose sleep resolves on the next server write, never on time. */
  const mailbox = () => {
    let queued = 0
    let waiter: (() => void) | undefined
    return {
      signal() {
        if (waiter) {
          const resolve = waiter
          waiter = undefined
          resolve()
        } else queued++
      },
      sleep: async () => {
        if (queued > 0) {
          queued--
          return
        }
        await new Promise<void>((resolve) => {
          waiter = resolve
        })
      },
      now: () => 0,
    }
  }
  const pairOnce = async () => {
    const approver = mailbox()
    const joining = mailbox()
    const pending = Promise.withResolvers<string>()
    const before = new Set(f.server.pending().map((row) => row.id))
    f.server.onWrite = () => {
      approver.signal()
      joining.signal()
      const id = f.server.pending().find((row) => !before.has(row.id))?.id
      if (id !== undefined) pending.resolve(id)
    }
    const joined = joinAccount({ ...joiner, clock: joining, showCode: () => undefined })
    expect(
      (
        await approveDevice({
          ...f.input,
          clock: approver,
          pendingId: await pending.promise,
          confirmCode: async () => true,
        })
      ).kind,
    ).toBe("approved")
    const outcome = await joined
    f.server.onWrite = null
    return outcome
  }
  expect(await enableSync({ ...joiner, serviceDeviceId: "service-second" })).toEqual({ kind: "join_required" })
  expect(await pairOnce()).toEqual({ kind: "joined" })

  await forgetTrustAnchor(joiner.pinDir, ACCOUNT)
  const anchors = async () =>
    (await readdir(join(joiner.pinDir, "trust-anchor"))).filter((name) => !name.includes(".retired-"))
  expect(
    await openAccountSession({
      ...http,
      account: ACCOUNT,
      keyring: second,
      pinDir: joiner.pinDir,
      spaceId: new Uint8Array(16).fill(3),
    }),
  ).toEqual({ ok: false, reason: "no_pin" })
  expect(await enableSync({ ...joiner, serviceDeviceId: "service-second" })).toEqual({ kind: "join_required" })
  expect(await anchors()).toEqual([])
  expect((await loadTrustAnchor(joiner.pinDir, ACCOUNT)).ok).toBe(false)
})
