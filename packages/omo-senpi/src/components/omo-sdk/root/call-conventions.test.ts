import { describe, expect, test } from "bun:test"
import { tmpdir } from "node:os"

import { createOmoSdk, type DeviceServiceStatusPort, type OmoSdk } from ".."
import type { CallOptions } from "../contract"
import { ROOT_RACED_CALLS } from "../contract/cancellation"
import { ROOT_DISPOSED } from "./assemble"

const env = { OMO_SERVICE_API_URL: "https://accounts.example.test" }

// The port answers no_answer once the signal it was handed aborts, as the real reader does when its wait is stopped.
function signalledPort() {
  const handed: (AbortSignal | undefined)[] = []
  const port: DeviceServiceStatusPort = ({ signal }) => {
    handed.push(signal)
    if (signal === undefined) return Promise.resolve("not_running")
    if (signal.aborted) return Promise.resolve("no_answer")
    return new Promise((resolve) => signal.addEventListener("abort", () => resolve("no_answer"), { once: true }))
  }
  return { port, handed }
}

describe("deviceService.status keeps both call conventions", () => {
  test("#given the shipped one-argument call with a signal #when it is aborted #then the port got that signal and the answer is no_answer", async () => {
    const { port, handed } = signalledPort()
    const sdk = createOmoSdk({ env, cwd: tmpdir(), ports: { deviceServiceStatus: port } })
    const stop = new AbortController()
    const answer = sdk.deviceService.status({ signal: stop.signal })
    stop.abort()
    expect(await answer).toMatchObject({ kind: "ok", value: { state: "no_answer" } })
    expect(handed).toEqual([stop.signal])
  })

  test("#given the root call with its signal in the call options #when it is aborted #then the port's wait stops and the answer is no_answer", async () => {
    const { port, handed } = signalledPort()
    const sdk = createOmoSdk({ env, cwd: tmpdir(), ports: { deviceServiceStatus: port } })
    const stop = new AbortController()
    const answer = sdk.deviceService.status({}, { signal: stop.signal })
    stop.abort()
    expect(await answer).toMatchObject({ kind: "ok", value: { state: "no_answer" } })
    expect(handed[0]?.aborted).toBe(true)
  })

  test("#given the root call with a deadline in the call options #when the deadline passes #then the port's wait stops and the answer is no_answer", async () => {
    const { port } = signalledPort()
    const sdk = createOmoSdk({ env, cwd: tmpdir(), ports: { deviceServiceStatus: port } })
    expect(await sdk.deviceService.status({}, { deadline_ms: 1 })).toMatchObject({
      kind: "ok",
      value: { state: "no_answer" },
    })
  })
})

// The calls the root honours by racing the answer (contract/cancellation.ts ROOT_RACED_CALLS, design lane ruling (A)):
// their core is not handed the signal, so a late result and a late rejection must never surface. The harness map is keyed
// by that list, so a call added to it without its cases does not compile.
type RacedCall = (typeof ROOT_RACED_CALLS)[number]
const signedIn = { device: { id: "dev-1", name: "laptop" }, accessToken: "t" }
const RACED: Readonly<
  Record<RacedCall, { readonly call: (sdk: OmoSdk, options?: CallOptions) => Promise<unknown>; readonly late: unknown }>
> = {
  "account.devices": { call: (sdk, options) => sdk.account.devices({}, options), late: { devices: [] } },
}
const heldRead = () => {
  let settle: ((outcome: { ok: unknown } | { fail: unknown }) => void) | undefined
  let entered: (() => void) | undefined
  const inRead = new Promise<void>((resolve) => {
    entered = resolve
  })
  const uses: string[] = []
  const sdk = createOmoSdk({
    env,
    cwd: tmpdir(),
    ports: {
      desktopLaunch: () => false,
      credentialStore: { read: async () => signedIn as never },
      session: {
        accessToken: async () => "t",
        request: (async (path: string) => {
          uses.push(path)
          entered?.()
          return new Promise((resolve, reject) => {
            settle = (outcome) => ("ok" in outcome ? resolve(outcome.ok) : reject(outcome.fail))
          })
        }) as never,
      },
    },
  })
  return { sdk, inRead, uses, settle: (outcome: { ok: unknown } | { fail: unknown }) => settle?.(outcome) }
}
const unhandled: unknown[] = []
const onUnhandled = (reason: unknown) => unhandled.push(reason)

for (const key of ROOT_RACED_CALLS) {
  const { call, late } = RACED[key]
  describe(`${key} honours signal and deadline_ms on its answer`, () => {
    test("#given a read in flight #when the caller's signal aborts #then the answer is cancelled and a late answer of the read is dropped", async () => {
      process.on("unhandledRejection", onUnhandled)
      try {
        const { sdk, inRead, settle } = heldRead()
        const stop = new AbortController()
        const answer = call(sdk, { signal: stop.signal })
        await inRead
        stop.abort()
        expect(await answer).toMatchObject({ kind: "error", error: { code: "cancelled" } })
        settle({ ok: late })
        await new Promise((resolve) => setImmediate(resolve))
        expect(unhandled).toEqual([])
      } finally {
        process.off("unhandledRejection", onUnhandled)
      }
    })

    test("#given a read in flight #when the deadline passes and the read then fails #then the answer is timeout and the failure surfaces nowhere", async () => {
      process.on("unhandledRejection", onUnhandled)
      try {
        const { sdk, inRead, settle } = heldRead()
        const answer = call(sdk, { deadline_ms: 1 })
        await inRead
        expect(await answer).toMatchObject({ kind: "error", error: { code: "timeout" } })
        settle({ fail: new Error("late failure") })
        await new Promise((resolve) => setImmediate(resolve))
        expect(unhandled).toEqual([])
      } finally {
        process.off("unhandledRejection", onUnhandled)
      }
    })

    test("#given a read in flight #when the root is disposed and the port then answers #then the call answers what the port did and the next call is refused with no port use", async () => {
      const { sdk, inRead, uses, settle } = heldRead()
      const answer = call(sdk)
      await inRead

      const disposed = sdk.dispose()
      settle({ ok: late })

      expect(await answer).toMatchObject({ kind: "ok" })
      await disposed
      const after = uses.length
      expect(await call(sdk)).toEqual({ kind: "error", error: ROOT_DISPOSED })
      expect(uses.length).toBe(after)
    })
  })
}
