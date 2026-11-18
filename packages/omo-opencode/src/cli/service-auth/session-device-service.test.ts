import { describe, expect, test } from "bun:test"
import { existsSync } from "node:fs"
import { credentialId, type CredentialStore } from "./keystore"
import type { Credentials } from "./protocol"
import { createSession, type DeviceServiceHandoff, SessionEnded } from "./session"
import { signedOutMarkerPath, writeSignedOutMarker } from "./signed-out-marker"
import { fakeApi, grant, privateKeys, refusal, temporaryHome } from "./test-support"

// Design D r9 sections 4-5: a fresh sign-in hands its keys to the device service from memory, after the signed-out
// marker is gone; every local end of a sign-in tells the service to forget the device.

const fresh: Credentials = { ...grant, ...privateKeys, accountId: "acct_42" }
const expired: Credentials = { ...fresh, accessTokenExpiresAt: "2000-01-01T00:00:00Z" }

/** A store that counts every read, so a test can prove the hand-off reads nothing the sign-in did not already read. */
function countingStore(initial: Credentials | null) {
  let value = initial
  const reads = { count: 0 }
  const store: CredentialStore = {
    read: async () => {
      reads.count += 1
      return value
    },
    readAuthoritative: async () => {
      reads.count += 1
      return value
    },
    write: async (next) => {
      value = next
    },
    clear: async () => {
      value = null
    },
  }
  return { store, reads }
}

function recorder(markerPath: string) {
  const events: string[] = []
  const handed: Credentials[] = []
  const deviceService: DeviceServiceHandoff = {
    adopt: async (credentials) => {
      events.push(`adopt marker=${existsSync(markerPath) ? "present" : "absent"}`)
      handed.push(credentials)
    },
    forget: async () => {
      events.push("forget")
    },
  }
  return { deviceService, events, handed }
}

async function machine(initial: Credentials | null, api = fakeApi(() => new Response(null, { status: 204 }))) {
  const home = await temporaryHome()
  const markerPath = signedOutMarkerPath(home, credentialId(api))
  const { store, reads } = countingStore(initial)
  const r = recorder(markerPath)
  const session = createSession({
    api,
    store,
    home,
    beforeKeysDiscarded: async () => undefined,
    deviceService: r.deviceService,
  })
  return { session, markerPath, reads, ...r, api, home }
}

describe("a fresh sign-in hands its keys to the device service from memory", () => {
  test("the stale signed-out marker is deleted before the keys are handed over, and the keys are the in-memory ones", async () => {
    const m = await machine(null)
    await writeSignedOutMarker(m.markerPath, "device-0")
    await m.session.save(fresh)
    expect(m.events).toEqual(["adopt marker=absent"])
    expect(m.handed).toEqual([fresh])
    expect(existsSync(m.markerPath)).toBe(false)
  })

  test("the hand-off adds zero credential store reads to the sign-in", async () => {
    const baseline = countingStore(null)
    const home = await temporaryHome()
    await createSession({
      api: "http://127.0.0.1:9",
      store: baseline.store,
      home,
      beforeKeysDiscarded: async () => undefined,
    }).save(fresh)
    const m = await machine(null)
    await m.session.save(fresh)
    expect(m.handed).toHaveLength(1)
    expect(m.reads.count).toBe(baseline.reads.count)
  })
})

describe("every local end of a sign-in forgets the device", () => {
  test("logout that revokes on the service", async () => {
    const m = await machine(fresh)
    expect(await m.session.logout()).toBe(true)
    expect(m.events).toEqual(["forget"])
  })

  test("logout with an uncertain refresh", async () => {
    const m = await machine({ ...fresh, refreshState: "uncertain" })
    expect(await m.session.logout()).toBe(false)
    expect(m.events).toEqual(["forget"])
  })

  test("logout while offline", async () => {
    const m = await machine(expired, "http://127.0.0.1:9")
    expect(await m.session.logout()).toBe(false)
    expect(m.events).toEqual(["forget"])
  })

  test("logout with nothing stored", async () => {
    const m = await machine(null)
    expect(await m.session.logout()).toBe(true)
    expect(m.events).toEqual(["forget"])
  })

  test("account forget", async () => {
    const m = await machine(fresh)
    await m.session.forget()
    expect(m.events).toEqual(["forget"])
  })

  test("a session the service ended on refresh", async () => {
    const m = await machine(
      expired,
      fakeApi(() => refusal("invalid_grant", undefined, 401)),
    )
    const error = await m.session.accessToken().catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(SessionEnded)
    expect(m.events).toEqual(["forget"])
  })
})
