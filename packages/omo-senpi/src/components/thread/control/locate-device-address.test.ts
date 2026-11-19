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
      expect(await run(tool, { thread: onB.name, ...extra })).toMatchObject({
        kind: "ok",
        thread: T.bLive,
        device: B.id,
      })
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

  for (const [tool] of controls.filter(([name]) => name !== "thread_set_model"))
    for (const [form, device] of [
      ["here", "here"],
      ["this device's id", HERE.id],
    ] as const)
      test(`#given ${tool} #when the thread is <${form}>/<thread id> #then it acts on this device's thread`, async () => {
        const result = await run(tool, { thread: `${device}/${T.hereLive}` })
        expect(result).toMatchObject({ kind: "ok", thread: T.hereLive })
        expect(result).not.toHaveProperty("device")
      })
})

describe("#given <device>/<thread id> on B that B's listing does not show #when thread_read names it #then B is asked and its answer decides (#14305 review H1)", () => {
  test.each([
    ["B answered and holds no such thread", { probe: true }, { code: "not_found", details: { kind: "thread", device: B.id } }],
    ["B did not answer the probe", { probe: true, silent: [B.id] }, { code: "host_unavailable", details: { reason: "host_not_answering" } }],
    ["B cannot be asked", {}, { code: "host_unavailable", details: { reason: "wake_unavailable" } }],
    ["B missed this listing round", { probe: true, incomplete: true }, { code: "host_unavailable", details: { reason: "listing_incomplete" } }],
  ] as const)("%s", async (_label, setup, error) => {
    expect(await run("thread_read", { thread: `${B.name}/${T.nowhere}` }, setup)).toMatchObject({ kind: "error", error })
  })

  test("#given B holds a thread only on disk #when thread_read names it as <device>/<thread id> #then it answers as the bare id does", async () => {
    const qualified = await run("thread_read", { thread: `${B.name}/${T.bProbe}` }, { probe: true })
    const bare = await run("thread_read", { thread: T.bProbe }, { probe: true })
    expect(qualified).toEqual(bare)
  })
})

describe("characterization of current behaviour: a closed copy of an id here while B lists it live", () => {
  test("#given the closed copy here, its transcript absent #when thread_read names the id #then this device's copy answers not_found and B is never asked", async () => {
    const two = createTwoDevices()
    cleanups.push(two.cleanup)
    expect(await two.run("thread_read", { thread: T.stale })).toMatchObject({
      kind: "error",
      error: { code: "not_found" },
    })
    expect(two.account.sent.filter((entry) => entry.device === B.id)).toEqual([])
  })
})
