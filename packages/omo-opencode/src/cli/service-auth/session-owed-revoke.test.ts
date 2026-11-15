// #12281: a sign-out whose revoke the service did not confirm (offline, 5xx, an uncertain refresh) still discards the
// device's keys, but the service device stays live, so the service never asks the account's members to rotate its
// sync principal out of the keyring. The revoke is owed: a later sign-in on this computer sends it with the new
// device's bearer, judged against that account's own device list.

import { describe, expect, test } from "bun:test"
import { mkdir, readFile, rm, writeFile } from "node:fs/promises"

import { devicePlatform } from "./device-name"
import { credentialId, type CredentialStore } from "./keystore"
import { owedRevokePath } from "./owed-revoke"
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

type Row = { id: string; kind: string; platform: string; revokedAt: string | null }

/**
 * A service holding each account's devices. A bearer names its device and account; `GET /v1/devices` lists the
 * caller's account, `DELETE /v1/devices/:id` revokes a device of that account (404 for any other), and `down`
 * makes every revoke answer 503. Each request is recorded as `METHOD path bearer`.
 */
async function world() {
  const calls: string[] = []
  const accounts = new Map<string, Row[]>()
  const bearers = new Map<string, { account: string; device: string }>()
  let down = false
  let onDelete: () => void = () => undefined
  const api = fakeApi((request) => {
    const path = new URL(request.url).pathname
    const bearer = request.headers.get("authorization") ?? "-"
    calls.push(`${request.method} ${path} ${bearer}`)
    const caller = bearers.get(bearer.replace(/^Bearer /, ""))
    const rows = accounts.get(caller?.account ?? "") ?? []
    if (request.method === "GET" && path === "/v1/devices")
      return Response.json({ devices: rows.map((row) => ({ ...row, current: row.id === caller?.device })) })
    onDelete()
    if (down) return refusal("unavailable", undefined, 503)
    const row = rows.find((candidate) => `/v1/devices/${candidate.id}` === path)
    if (row === undefined) return refusal("not_found", undefined, 404)
    row.revokedAt = new Date(0).toISOString()
    return new Response(null, { status: 204 })
  })
  const home = await temporaryHome()
  const logs: string[] = []
  const add = (account: string, row: Omit<Row, "revokedAt">) => {
    accounts.set(account, [...(accounts.get(account) ?? []), { ...row, revokedAt: null }])
  }
  /** A sign-in shaped like a real grant: its account rides only in the owner record. */
  const signIn = (device: string, account: string = ACCOUNT): Credentials => {
    add(account, { id: device, kind: "cli", platform: devicePlatform() })
    bearers.set(`access-${device}`, { account, device })
    return {
      ...grant,
      ...privateKeys,
      accessToken: `access-${device}`,
      device: { id: device, name: `CLI ${device}` },
      owner: { accountId: account, deviceId: device, familyId: `family-${device}`, generation: 1, ownerHandle: "h" },
    }
  }
  return {
    calls,
    logs,
    accounts,
    add,
    signIn,
    owedPath: owedRevokePath(home, credentialId(api)),
    setDown: (value: boolean) => {
      down = value
    },
    onDelete: (hook: () => void) => {
      onDelete = hook
    },
    session: (store: CredentialStore, signal?: AbortSignal) =>
      createSession({
        api,
        store,
        home,
        beforeKeysDiscarded: async () => undefined,
        log: (line) => logs.push(line),
        ...(signal === undefined ? {} : { signal }),
      }),
  }
}

/** Signs device-1 out of ACCOUNT with the service down, so its revoke is owed. */
async function owedWorld() {
  const w = await world()
  const s = memoryStore(w.signIn("device-1"))
  w.setDown(true)
  expect(await w.session(s.store).logout()).toBe(false)
  expect(s.current()).toBeNull()
  w.setDown(false)
  w.calls.length = 0
  return { w, s }
}

const list = (bearer: string) => `GET /v1/devices Bearer ${bearer}`
const revoke = (device: string, bearer: string) => `DELETE /v1/devices/${device} Bearer ${bearer}`

describe("an unconfirmed sign-out owes its revoke to the next sign-in (#12281)", () => {
  test("#given the service is unavailable at logout #when this computer signs in again #then the new device revokes the old one, once", async () => {
    const { w, s } = await owedWorld()
    await w.session(s.store).save(w.signIn("device-2"))
    expect(s.current()?.device.id).toBe("device-2")
    expect(w.calls).toEqual([list("access-device-2"), revoke("device-1", "access-device-2")])
    w.calls.length = 0
    await w.session(s.store).save({ ...w.signIn("device-2"), accessToken: "access-device-2" })
    expect(w.calls).toEqual([])
    expect(w.logs).toEqual([])
  })

  test("#given a logout whose refresh outcome is uncertain #when this computer signs in again #then the old device is revoked", async () => {
    const w = await world()
    const s = memoryStore({ ...w.signIn("device-1"), refreshState: "uncertain" })
    expect(await w.session(s.store).logout()).toBe(false)
    expect(w.calls).toEqual([])
    await w.session(s.store).save(w.signIn("device-2"))
    expect(w.calls).toEqual([list("access-device-2"), revoke("device-1", "access-device-2")])
  })

  test("#given a logout the service confirmed #when this computer signs in again #then nothing is owed or asked", async () => {
    const w = await world()
    const s = memoryStore(w.signIn("device-1"))
    expect(await w.session(s.store).logout()).toBe(true)
    w.calls.length = 0
    await w.session(s.store).save(w.signIn("device-2"))
    expect(w.calls).toEqual([])
  })

  test("#given the owed revoke cannot be sent at the next sign-in #when it fails #then the sign-in still succeeds, the gap is reported, and the sign-in after it sends the revoke again", async () => {
    const { w, s } = await owedWorld()
    w.setDown(true)
    await w.session(s.store).save(w.signIn("device-2"))
    expect(s.current()?.device.id).toBe("device-2")
    expect(w.logs).toHaveLength(1)
    w.setDown(false)
    w.calls.length = 0
    await w.session(s.store).save(w.signIn("device-3"))
    expect(w.calls).toEqual([list("access-device-3"), revoke("device-1", "access-device-3")])
  })

  test("#given an owed revoke on one account #when this computer signs in to another account #then that sign-in revokes nothing and the owe waits for its own account", async () => {
    const { w, s } = await owedWorld()
    await w.session(s.store).save(w.signIn("device-other", "account-other"))
    expect(w.calls).toEqual([list("access-device-other")])
    w.calls.length = 0
    await w.session(s.store).save(w.signIn("device-3"))
    expect(w.calls).toEqual([list("access-device-3"), revoke("device-1", "access-device-3")])
  })

  test("#given an owed device its own account no longer lists #when this computer signs in to that account #then the owe is settled without a revoke", async () => {
    const { w, s } = await owedWorld()
    w.accounts.set(ACCOUNT, [])
    await w.session(s.store).save(w.signIn("device-2"))
    expect(w.calls).toEqual([list("access-device-2")])
    w.calls.length = 0
    await w.session(s.store).save(w.signIn("device-3"))
    expect(w.calls).toEqual([])
  })

  // M1: with machine identity the service refuses every sign-in on this computer while the owed device lives, so the
  // device is removed on the Devices page first. The sign-in that then succeeds settles the owe without a request.
  test("#given the owed device was removed on the Devices page #when this computer signs in again #then nothing is revoked and the owe is gone", async () => {
    const { w, s } = await owedWorld()
    const row = w.accounts.get(ACCOUNT)?.find((candidate) => candidate.id === "device-1")
    if (row === undefined) throw new Error("device-1 is not listed")
    row.revokedAt = new Date(0).toISOString()
    await w.session(s.store).save(w.signIn("device-2"))
    expect(w.calls).toEqual([list("access-device-2")])
    w.calls.length = 0
    await w.session(s.store).save(w.signIn("device-3"))
    expect(w.calls).toEqual([])
  })

  // L1: the credential is stored before any owe is touched, so nothing after it may turn the sign-in into a failure.
  test("#given the owe file cannot be rewritten #when a sign-in settles the owe #then the sign-in resolves stored and the failure is reported", async () => {
    const { w, s } = await owedWorld()
    // A second owe, for another account, survives the settle, so the file is rewritten rather than removed.
    const owed = JSON.parse(await readFile(w.owedPath, "utf8")) as { owed: unknown[] }
    owed.owed.push({ device: "device-elsewhere", account: "account-other", at: new Date(0).toISOString() })
    await writeFile(w.owedPath, JSON.stringify(owed))
    const obstacle = `${w.owedPath}.${process.pid}.tmp`
    await mkdir(obstacle)
    await w.session(s.store).save(w.signIn("device-2"))
    expect(s.current()?.device.id).toBe("device-2")
    expect(w.logs).toHaveLength(1)
    await rm(obstacle, { recursive: true })
  })

  test("#given the sign-in is cancelled while the owed revoke is in flight #when it is cancelled #then the sign-in still resolves stored and the gap is reported", async () => {
    const { w, s } = await owedWorld()
    const controller = new AbortController()
    w.onDelete(() => controller.abort())
    await w.session(s.store, controller.signal).save(w.signIn("device-2"))
    expect(s.current()?.device.id).toBe("device-2")
    expect(w.logs).toHaveLength(1)
  })

  // L2: an owe names only this computer's own machine device; one naming a browser or a device of another platform
  // cannot come from this computer's logout, so it is never sent.
  for (const row of [
    { id: "browser-1", kind: "browser", platform: "web" },
    { id: "elsewhere-1", kind: "cli", platform: devicePlatform() === "windows" ? "linux" : "windows" },
  ]) {
    test(`#given an owe naming a ${row.kind} device on ${row.platform} #when this computer signs in #then it is dropped unsent`, async () => {
      const w = await world()
      w.add(ACCOUNT, row)
      const at = new Date(0).toISOString()
      await mkdir(w.owedPath.slice(0, w.owedPath.lastIndexOf("/")), { recursive: true })
      await writeFile(w.owedPath, JSON.stringify({ owed: [{ device: row.id, account: ACCOUNT, at }] }))
      const s = memoryStore(null)
      await w.session(s.store).save(w.signIn("device-2"))
      expect(w.calls).toEqual([list("access-device-2")])
      w.calls.length = 0
      await w.session(s.store).save(w.signIn("device-3"))
      expect(w.calls).toEqual([])
    })
  }

  // L3: an owe that names no account (a sign-in from before accounts were recorded) is sent only by a sign-in whose
  // own account lists that device, never re-sent at every sign-in to another account.
  test("#given an owe that names no account #when this computer signs in to another account twice and then to its own #then only its own account's sign-in revokes it", async () => {
    const w = await world()
    const legacy = w.signIn("device-1")
    const s = memoryStore({ ...legacy, owner: undefined })
    w.setDown(true)
    expect(await w.session(s.store).logout()).toBe(false)
    w.setDown(false)
    w.calls.length = 0
    await w.session(s.store).save(w.signIn("device-x", "account-other"))
    await w.session(s.store).save(w.signIn("device-y", "account-other"))
    expect(w.calls).toEqual([list("access-device-x"), list("access-device-y")])
    w.calls.length = 0
    await w.session(s.store).save(w.signIn("device-2"))
    expect(w.calls).toEqual([list("access-device-2"), revoke("device-1", "access-device-2")])
  })
})
