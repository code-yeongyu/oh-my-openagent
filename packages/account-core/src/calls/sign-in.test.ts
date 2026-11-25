import { describe, expect, test } from "bun:test"

import type { CredentialStore } from "../keystore"
import { createSession } from "../session"
import { clock, fakeApi, grant, memorySecrets, minted, temporaryHome } from "../test-support"
import type { CustodyLog } from "./custody-log"
import { accountSignIn } from "./sign-in"

// The commit point of account.signIn: the request that turns an approval into a granted device, together with the
// store write after it. An abort before it ends the call `cancelled` with nothing stored and nothing asked of the
// service; the commit itself is not split by an abort; an abort after it ends the call signed in, the device-service
// setup not run or abandoned (`not_on`, its answer when it does not finish), and the custody record says partial.

const never = () => new Promise<never>(() => undefined)

async function world(options: { readonly onToken?: () => void } = {}) {
  const calls: string[] = []
  const api = fakeApi(async (request) => {
    const path = new URL(request.url).pathname
    calls.push(path)
    if (path === "/v1/health") return Response.json({ ok: true })
    if (path === "/v1/device/code") return Response.json(minted)
    if (path === "/v1/device/token") {
      options.onToken?.()
      return Response.json(grant)
    }
    return new Response("", { status: 404 })
  })
  const controller = new AbortController()
  const store = memorySecrets().store(api)
  const home = await temporaryHome()
  const records: string[] = []
  const custody: CustodyLog = {
    begin: async () => ({
      recorded: true,
      end: async (outcome, code) => {
        records.push(code === undefined ? outcome : `${outcome} ${code}`)
        return true
      },
    }),
    refused: async () => true,
  }
  return { api, calls, controller, store, home, records, custody }
}

type World = Awaited<ReturnType<typeof world>>

function run(
  w: World,
  extra: {
    readonly onUserCode?: (signal?: AbortSignal) => void | Promise<void>
    readonly setUp?: (signal?: AbortSignal) => Promise<"on">
    readonly store?: CredentialStore
  } = {},
) {
  const store = extra.store ?? w.store
  const session = createSession({
    api: w.api,
    store,
    home: w.home,
    signal: w.controller.signal,
    beforeKeysDiscarded: async () => undefined,
  })
  return accountSignIn(
    {
      api: w.api,
      session,
      store,
      accountsOpen: false,
      custody: w.custody,
      ...(extra.setUp === undefined ? {} : { setUpDeviceService: extra.setUp }),
      ...clock(),
    },
    {
      method: "device_code",
      onUserCode: (_code, signal) => extra.onUserCode?.(signal),
      signal: w.controller.signal,
    },
  )
}

const bounded = <T>(answer: Promise<T>) =>
  Promise.race([
    answer,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error("waited 5s for the cancelled sign-in")), 5000)),
  ])

const signedInNotOn = { kind: "ok", value: { device: { id: grant.device.id }, deviceService: "not_on" } }

test("#given a sign-in that completes #then its custody record closes ok", async () => {
  const w = await world()
  expect(await run(w, { setUp: async () => "on" })).toMatchObject({ kind: "ok", value: { deviceService: "on" } })
  expect(w.records).toEqual(["ok"])
})

describe("account.signIn cancelled before the commit point: nothing stored", () => {
  test("#given a signal already aborted #then it answers cancelled before any request", async () => {
    const w = await world()
    w.controller.abort()
    expect(await run(w)).toEqual({ kind: "refused", code: "cancelled" })
    expect({ calls: w.calls, stored: await w.store.read(), records: w.records }).toEqual({
      calls: [],
      stored: null,
      records: ["cancelled cancelled"],
    })
  })

  test("#given an abort while the code waits for approval #then cancelled, no token asked for", async () => {
    const w = await world()
    expect(await run(w, { onUserCode: () => w.controller.abort() })).toEqual({ kind: "refused", code: "cancelled" })
    expect({ token: w.calls.includes("/v1/device/token"), stored: await w.store.read() }).toEqual({
      token: false,
      stored: null,
    })
  })

  test("#given an onUserCode that never settles #when the caller aborts #then the call ends cancelled, and the callback had the signal", async () => {
    const w = await world()
    const seen: (AbortSignal | undefined)[] = []
    const answer = await bounded(
      run(w, {
        onUserCode: (signal) => {
          seen.push(signal)
          queueMicrotask(() => w.controller.abort())
          return never()
        },
      }),
    )
    expect(answer).toEqual({ kind: "refused", code: "cancelled" })
    expect({ seen: seen[0] === w.controller.signal, stored: await w.store.read() }).toEqual({
      seen: true,
      stored: null,
    })
  })
})

describe("account.signIn cancelled at or after the commit point: signed in, setup not on", () => {
  test("#given an abort while the grant is exchanged #then the grant is stored and the setup never runs", async () => {
    const w = await world({ onToken: () => w.controller.abort() })
    let setUp = false
    const answer = await run(w, {
      setUp: async () => {
        setUp = true
        return "on"
      },
    })
    expect(answer).toMatchObject(signedInNotOn)
    expect({ setUp, stored: (await w.store.read())?.device.id, records: w.records }).toEqual({
      setUp: false,
      stored: grant.device.id,
      records: ["partial setup_cancelled"],
    })
  })

  test("#given an abort during the store write #then the write completes and the call answers signed in", async () => {
    const w = await world()
    const store: CredentialStore = {
      ...w.store,
      write: async (...args) => {
        w.controller.abort()
        await w.store.write(...args)
      },
    }
    let setUp = false
    const answer = await run(w, {
      store,
      setUp: async () => {
        setUp = true
        return "on"
      },
    })
    expect(answer).toMatchObject(signedInNotOn)
    expect({ setUp, stored: (await w.store.read())?.device.id }).toEqual({ setUp: false, stored: grant.device.id })
  })

  test("#given an abort after the store write, before the setup #then the setup never runs", async () => {
    const w = await world()
    let reads = 0
    const store: CredentialStore = {
      ...w.store,
      read: async () => {
        const stored = await w.store.read()
        if (stored !== null && ++reads === 1) w.controller.abort()
        return stored
      },
    }
    let setUp = false
    const answer = await run(w, {
      store,
      setUp: async () => {
        setUp = true
        return "on"
      },
    })
    expect(answer).toMatchObject(signedInNotOn)
    expect(setUp).toBe(false)
  })

  test("#given a setup that never settles #when the caller aborts #then the call ends signed in, the setup had the signal", async () => {
    const w = await world()
    const seen: (AbortSignal | undefined)[] = []
    const answer = await bounded(
      run(w, {
        setUp: (signal) => {
          seen.push(signal)
          queueMicrotask(() => w.controller.abort())
          return never()
        },
      }),
    )
    expect(answer).toMatchObject(signedInNotOn)
    expect({ seen: seen[0] === w.controller.signal, records: w.records }).toEqual({
      seen: true,
      records: ["partial setup_cancelled"],
    })
  })
})
