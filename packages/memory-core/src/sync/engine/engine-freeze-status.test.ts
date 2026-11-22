// #12280 R-A8: a service freeze (rotation on revoke) is an engine status with a closed reason code,
// never a silent `pushed: false`, and the first cycle that pushes clears it.

import { afterEach, expect, test } from "bun:test"

import { type Device, makeDevice } from "./engine-harness.test-support"
import { FakeSyncServer } from "./fake-server.test-support"
import type { FreezeOutcome } from "./ports"

const devices: Device[] = []
afterEach(async () => {
  for (const d of devices.splice(0)) await d.dispose()
})

test("#given a frozen account whose settler cannot rotate #when cycles run #then status is frozen with the code, and the first cycle that pushes clears it", async () => {
  const server = new FakeSyncServer()
  let outcome: FreezeOutcome = { kind: "frozen", reason: "unverified" }
  const a = await makeDevice(server, "a", undefined, { freeze: { settle: async () => outcome } })
  devices.push(a)
  server.frozen = true
  await a.engine.runCycle()
  expect(await a.engine.status()).toMatchObject({ kind: "frozen", reason: "unverified" })
  await a.write("x.md", "x\n")
  const refused = await a.engine.runCycle()
  expect(refused.pushed).toBe(false)
  expect(await a.engine.status()).toMatchObject({ kind: "frozen", reason: "unverified" })
  server.frozen = false
  outcome = { kind: "clear" }
  expect((await a.engine.runCycle()).pushed).toBe(true)
  expect((await a.engine.status()).kind).toBe("synced")
})

test("#given a frozen account #when the settler rotates #then the same cycle pulls and pushes and the status is synced", async () => {
  const server = new FakeSyncServer()
  const a = await makeDevice(server, "a", undefined, {
    freeze: {
      settle: async () => {
        if (!server.frozen) return { kind: "clear" }
        server.frozen = false
        return { kind: "rotated" }
      },
    },
  })
  devices.push(a)
  await a.engine.runCycle()
  server.frozen = true
  await a.write("x.md", "x\n")
  expect((await a.engine.runCycle()).pushed).toBe(true)
  expect((await a.engine.status()).kind).toBe("synced")
})
