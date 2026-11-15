// #12281: a sign-out whose revoke the service did not confirm (offline, 5xx, an uncertain refresh) still discards the
// device's keys, but the service device stays live, so the service never asks the account's members to rotate its
// sync principal out of the keyring. The revoke is owed: the next sign-in on this computer sends it with the new
// device's bearer (`DELETE /v1/devices/:id` revokes any device of the caller's account).

import { describe, expect, test } from "bun:test"

import type { CredentialStore } from "./keystore"
import type { Credentials } from "./protocol"
import { createSession } from "./session"
import { fakeApi, grant, privateKeys, refusal, temporaryHome } from "./test-support"

const ACCOUNT = "account-12281"

function memoryStore(initial: Credentials | null) {
  let value = initial
  const store: CredentialStore = {
    read: async () => value,
    readAuthoritative: async () => value,
    write: async (next) => {
      value = next
    },
    clear: async () => {
      value = null
    },
  }
  return { store, current: () => value }
}

type Reply = "ok" | "unavailable" | "not_found"

/** A service whose every revoke answers `reply()`; it records each request as `METHOD path bearer`. */
async function world(reply: () => Reply) {
  const calls: string[] = []
  const api = fakeApi((request) => {
    const path = new URL(request.url).pathname
    calls.push(`${request.method} ${path} ${request.headers.get("authorization") ?? "-"}`)
    const answer = reply()
    if (answer === "unavailable") return refusal("unavailable", undefined, 503)
    if (answer === "not_found") return refusal("not_found", undefined, 404)
    return new Response(null, { status: 204 })
  })
  const home = await temporaryHome()
  const session = (store: CredentialStore) =>
    createSession({ api, store, home, beforeKeysDiscarded: async () => undefined })
  return { calls, session }
}

const first: Credentials = { ...grant, ...privateKeys, accountId: ACCOUNT }
const signIn = (device: string, accountId: string | undefined = ACCOUNT): Credentials => ({
  ...grant,
  ...privateKeys,
  accessToken: `access-${device}`,
  device: { id: device, name: `CLI ${device}` },
  ...(accountId === undefined ? {} : { accountId }),
})

describe("an unconfirmed sign-out owes its revoke to the next sign-in (#12281)", () => {
  test("#given the service is unavailable at logout #when this computer signs in again #then the new device revokes the old one, once", async () => {
    let answer: Reply = "unavailable"
    const w = await world(() => answer)
    const s = memoryStore(first)
    expect(await w.session(s.store).logout()).toBe(false)
    expect(s.current()).toBeNull()
    answer = "ok"
    w.calls.length = 0

    await w.session(s.store).save(signIn("device-2"))
    expect(s.current()?.device.id).toBe("device-2")
    expect(w.calls).toEqual(["DELETE /v1/devices/device-1 Bearer access-device-2"])

    w.calls.length = 0
    await w.session(s.store).save({ ...signIn("device-2"), accessToken: "access-device-2-fresh" })
    expect(w.calls).toEqual([])
  })

  test("#given a logout whose refresh outcome is uncertain #when this computer signs in again #then the old device is revoked", async () => {
    const w = await world(() => "ok")
    const s = memoryStore({ ...first, refreshState: "uncertain" })
    expect(await w.session(s.store).logout()).toBe(false)
    expect(w.calls).toEqual([])

    await w.session(s.store).save(signIn("device-2"))
    expect(w.calls).toEqual(["DELETE /v1/devices/device-1 Bearer access-device-2"])
  })

  test("#given a logout the service confirmed #when this computer signs in again #then nothing more is revoked", async () => {
    const w = await world(() => "ok")
    const s = memoryStore(first)
    expect(await w.session(s.store).logout()).toBe(true)
    w.calls.length = 0

    await w.session(s.store).save(signIn("device-2"))
    expect(w.calls).toEqual([])
  })

  test("#given the owed revoke fails at the next sign-in #when it fails #then the sign-in still succeeds and the sign-in after it sends the revoke again", async () => {
    let answer: Reply = "unavailable"
    const w = await world(() => answer)
    const s = memoryStore(first)
    await w.session(s.store).logout()
    w.calls.length = 0

    await w.session(s.store).save(signIn("device-2"))
    expect(s.current()?.device.id).toBe("device-2")
    expect(w.calls).toEqual(["DELETE /v1/devices/device-1 Bearer access-device-2"])

    answer = "ok"
    w.calls.length = 0
    await w.session(s.store).save({ ...signIn("device-2"), accessToken: "access-device-2-fresh" })
    expect(w.calls).toEqual(["DELETE /v1/devices/device-1 Bearer access-device-2-fresh"])
  })

  test("#given an owed revoke on one account #when this computer signs in to another account #then that sign-in revokes nothing and the owe waits for its own account", async () => {
    let answer: Reply = "unavailable"
    const w = await world(() => answer)
    const s = memoryStore(first)
    await w.session(s.store).logout()
    answer = "ok"
    w.calls.length = 0

    await w.session(s.store).save(signIn("device-other", "account-other"))
    expect(w.calls).toEqual([])

    await w.session(s.store).save(signIn("device-3"))
    expect(w.calls).toEqual(["DELETE /v1/devices/device-1 Bearer access-device-3"])
  })

  test("#given an owed revoke the service no longer knows in that same account #when the sign-in sends it #then the owe is settled", async () => {
    let answer: Reply = "unavailable"
    const w = await world(() => answer)
    const s = memoryStore(first)
    await w.session(s.store).logout()
    answer = "not_found"
    w.calls.length = 0

    await w.session(s.store).save(signIn("device-2"))
    expect(w.calls).toEqual(["DELETE /v1/devices/device-1 Bearer access-device-2"])

    answer = "ok"
    w.calls.length = 0
    await w.session(s.store).save({ ...signIn("device-2"), accessToken: "access-device-2-fresh" })
    expect(w.calls).toEqual([])
  })
})
