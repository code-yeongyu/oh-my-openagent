import { afterEach, describe, expect, test } from "bun:test"
import type { ThreadToolName } from "../contracts"
import { B, HERE, T, createTwoDevices, type TwoDeviceOptions } from "../address/testing/two-devices"

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup()
})

async function run(name: ThreadToolName, args: Record<string, unknown>, setup: TwoDeviceOptions = {}) {
  const two = createTwoDevices(setup)
  cleanups.push(two.cleanup)
  return await two.run(name, args)
}

const onB = { name: `${B.name}/${T.bLive}`, prefixes: `${B.id.slice(0, 6)}/${T.bLive.slice(0, 8)}` }
const controls = [
  ["thread_read", {}],
  ["thread_close", {}],
  ["thread_interrupt", {}],
  ["thread_set_model", { model: "opus" }],
] as const

describe("#given a thread on device B #when a control tool names it as <device>/<thread> #then the tool reaches B's thread (#14305)", () => {
  for (const [tool, extra] of controls) {
    test(`#given ${tool} #when the thread is <device name>/<thread id> #then it acts on B's thread`, async () => {
      expect(await run(tool, { thread: onB.name, ...extra })).toMatchObject({ kind: "ok", thread: T.bLive, device: B.id })
    })

    test(`#given ${tool} #when the thread is <device id prefix>/<thread id prefix> #then it acts on B's thread`, async () => {
      expect(await run(tool, { thread: onB.prefixes, ...extra })).toMatchObject({
        kind: "ok",
        thread: T.bLive,
        device: B.id,
      })
    })

    test(`#given ${tool} and B missing this listing round #when the thread is B's name/thread name #then host_unavailable, never not_found`, async () => {
      expect(await run(tool, { thread: `${B.name}/beta`, ...extra }, { incomplete: true })).toMatchObject({
        kind: "error",
        error: { code: "host_unavailable", details: { reason: "listing_incomplete", devices: [B.id] } },
      })
    })
  }

  for (const [tool] of controls.filter(([name]) => name !== "thread_set_model")) {
    test(`#given ${tool} #when the thread is here/<thread id> #then it acts on this device's thread`, async () => {
      const result = await run(tool, { thread: `${HERE.id}/${T.hereLive}` })
      expect(result).toMatchObject({ kind: "ok", thread: T.hereLive })
      expect(result).not.toHaveProperty("device")
    })
  }
})

describe("#given B holds a thread live and this device keeps a stale copy of the same id #when thread_read names the id #then B's live thread is read", () => {
  test("#given the stale copy here #when thread_read names the id #then it reads B's live session", async () => {
    expect(await run("thread_read", { thread: T.stale })).toMatchObject({ kind: "ok", thread: T.stale, device: B.id })
  })
})
