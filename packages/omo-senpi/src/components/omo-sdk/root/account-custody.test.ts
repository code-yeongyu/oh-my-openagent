import { describe, expect, test } from "bun:test"

import type { CustodyLog } from "@oh-my-opencode/account-core/calls/custody-log"
import { assembleOmoSdk } from "../assembly"
import type { OmoPrincipal, RootCallKey } from "../contract"
import type { OmoSdkPorts } from "../options"
import { boundaryRefusals } from "./authority"

// Security design 8.2 at the root, with the security owner's rulings on review 6065026586: every custody-bearing call
// (signIn, signOut, forget, the store switch) is recorded, a refusal at the boundary or under a desktop launch included,
// under the root's own principal and with the refusal's code only.

function recorder() {
  const calls: string[] = []
  const log: CustodyLog = {
    begin: async (capability) => {
      calls.push(`begin ${capability}`)
      return {
        recorded: true,
        end: async (outcome, code) => {
          calls.push(`end ${capability} ${outcome}${code === undefined ? "" : ` ${code}`}`)
          return true
        },
      }
    },
    refused: async (capability, code) => {
      calls.push(`refused ${capability} ${code}`)
      return true
    },
  }
  return { calls, log }
}

const CUSTODY_CALLS = [
  "account.signIn",
  "account.signOut",
  "account.forget",
  "account.store.enable",
  "account.store.disable",
] as const satisfies readonly RootCallKey[]
const INPUTS: Partial<Record<RootCallKey, unknown>> = {
  "account.signIn": { method: "device_code", onUserCode: () => undefined },
}

function rootOf(principal: OmoPrincipal, ports: OmoSdkPorts, signIn?: Parameters<typeof assembleOmoSdk>[1]["signIn"]) {
  const { calls, log } = recorder()
  const sdk = assembleOmoSdk(
    {
      principal,
      env: { OMO_SERVICE_API_URL: "https://accounts.example.test" },
      cwd: "/work",
      ports: { desktopLaunch: () => false, ...ports, custody: log },
    },
    signIn === undefined ? {} : { signIn },
  )
  const call = (key: RootCallKey) =>
    (key.split(".").reduce<unknown>((node, part) => Reflect.get(Object(node), part), sdk) as (i: unknown) => unknown)(
      INPUTS[key] ?? {},
    )
  return { sdk, calls, call }
}

const PRINCIPALS: readonly OmoPrincipal[] = [
  { kind: "session", session_id: "01-session" },
  { kind: "connector", binding: "binding-1" },
  { kind: "service" },
]

describe("custody records at the root", () => {
  for (const principal of PRINCIPALS)
    test(`#given a ${principal.kind} root #when it calls a custody-bearing call its boundary refuses #then one refused record with the code`, async () => {
      const refusals = boundaryRefusals(principal, {})
      const refused = CUSTODY_CALLS.filter((key) => refusals.has(key))
      expect(refused.length).toBeGreaterThan(0)
      for (const key of refused) {
        const { calls, call } = rootOf(principal, {})
        await call(key)
        expect(calls).toEqual([`refused ${key} ${refusals.get(key)?.code}`])
      }
    })

  test("#given a desktop launch #when a script calls each custody-bearing call #then each refusal is recorded as desktop_sign_in", async () => {
    for (const key of CUSTODY_CALLS) {
      const { calls, call } = rootOf({ kind: "script", uid: 501 }, { desktopLaunch: () => true })
      await call(key)
      expect(calls).toEqual([`refused ${key} desktop_sign_in`])
    }
  })

  test("#given the in-process sign-in #then it is handed the root's custody log", async () => {
    const handed: CustodyLog[] = []
    const { call } = rootOf({ kind: "script", uid: 501 }, {}, async (_api, _request, custody) => {
      handed.push(custody)
      return { kind: "refused", code: "cancelled" }
    })
    await call("account.signIn")
    expect(handed.length).toBe(1)
  })

  test("#given a session's child-backed sign-in #then the root writes its started and terminal records", async () => {
    const { calls, call } = rootOf(
      { kind: "session", session_id: "01-session" },
      {
        signInProcess: async ({ onLine }) => {
          onLine(JSON.stringify({ event: "signed_in", device: { id: "dev-1", name: "laptop" }, deviceService: "on" }))
          return { code: 0 }
        },
      },
    )
    expect(await call("account.signIn")).toMatchObject({ kind: "ok" })
    expect(calls).toEqual(["begin account.signIn", "end account.signIn ok"])
  })

  test("#given the store switch #then enable and disable write their records", async () => {
    const ports: OmoSdkPorts = {
      accountStore: {
        platform: "darwin",
        available: async () => true,
        status: () => ({ store: "login", state: "absent", path: "/store" }),
        enable: async () => ({ kind: "ok", value: { store: "omo", created: true, moved: "none", loginLeftover: false } }),
        disable: async () => ({ kind: "ok", value: { store: "login", moved: "none", erased: true } }),
      },
    }
    const { calls, call } = rootOf({ kind: "person", uid: 501 }, ports)
    await call("account.store.enable")
    await call("account.store.disable")
    expect(calls).toEqual([
      "begin account.store.enable",
      "end account.store.enable ok",
      "begin account.store.disable",
      "end account.store.disable ok",
    ])
  })
})
