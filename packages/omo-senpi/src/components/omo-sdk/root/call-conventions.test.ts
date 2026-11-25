import { describe, expect, test } from "bun:test"
import { tmpdir } from "node:os"

import { createOmoSdk, type DeviceServiceStatusPort } from ".."

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
