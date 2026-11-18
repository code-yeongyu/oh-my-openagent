import { afterEach, describe, expect, test } from "bun:test"
import { createRemoteThreadFixture } from "./thread-remote-fixture"

const { account, surface, cleanup } = createRemoteThreadFixture()
afterEach(cleanup)

const failure = (result: unknown) =>
  (result as { error?: { code: string; next_action: string; details?: Record<string, unknown> } }).error
const openedOn = (sent: readonly { via: string; device?: string; rpc?: Record<string, unknown> }[]) =>
  sent
    .filter((entry) => entry.via === "endpoint" && entry.rpc?.["type"] === "open_session")
    .map((entry) => entry.device)

const LAB_ID = "0123456789abcdef0123456789abcdef"

describe("#14072 thread_create names a signed-in device by its display name, its id, or a unique id prefix", () => {
  test("#given b is signed in as studio #when thread_create names it in another case and with stray spaces #then the thread opens on b", async () => {
    const a = account()
    const { run } = surface(a.remote)
    expect(await run("thread_create", { name: "device-name-1", device: "  Studio " })).toMatchObject({
      kind: "ok",
      device: "b",
    })
    expect(openedOn(a.sent)).toEqual(["b"])
  })

  test("#given an offline row named studio listed before the online one #when thread_create names studio #then the online device takes it, never the offline twin", async () => {
    const a = account({ online: false, devices: [{ device: "b2", label: "studio", online: true }] })
    const { run } = surface(a.remote)
    expect(await run("thread_create", { name: "device-name-2", device: "studio" })).toMatchObject({ kind: "ok" })
    expect(openedOn(a.sent)).toEqual(["b2"])
  })

  test("#given two online devices named studio #when thread_create names studio #then ambiguous_target lists both and nothing opens", async () => {
    const a = account({ devices: [{ device: "b2", label: "Studio", online: true }] })
    const { run } = surface(a.remote)
    const error = failure(await run("thread_create", { name: "device-name-3", device: "studio" }))
    expect(error).toMatchObject({ code: "ambiguous_target" })
    expect(error?.details?.["candidates"]).toEqual([
      { device: "b", name: "studio", online: true },
      { device: "b2", name: "Studio", online: true },
    ])
    expect(a.sent).toEqual([])
  })

  test("#given only offline devices named studio #when thread_create names studio #then device_offline names one and nothing is queued", async () => {
    const a = account({ online: false, devices: [{ device: "b2", label: "studio", online: false }] })
    const { run } = surface(a.remote)
    expect(failure(await run("thread_create", { name: "device-name-4", device: "studio" }))).toMatchObject({
      code: "device_offline",
    })
    expect(openedOn(a.sent)).toEqual([])
  })

  test("#given a device with a hex id #when thread_create names a unique prefix of it, or the whole id #then the thread opens on that device", async () => {
    const a = account({ devices: [{ device: LAB_ID, label: "lab", online: true }] })
    const { run } = surface(a.remote)
    expect(await run("thread_create", { name: "device-name-5", device: LAB_ID.slice(0, 8) })).toMatchObject({
      kind: "ok",
      device: LAB_ID,
    })
    expect(await run("thread_create", { name: "device-name-6", device: LAB_ID })).toMatchObject({
      kind: "ok",
      device: LAB_ID,
    })
    expect(openedOn(a.sent)).toEqual([LAB_ID, LAB_ID])
  })

  test("#given two device ids sharing a prefix #when thread_create names that prefix #then ambiguous_target lists both", async () => {
    const twin = `${LAB_ID.slice(0, 12)}ffffffffffffffffffff`
    const a = account({
      devices: [
        { device: LAB_ID, label: "lab", online: true },
        { device: twin, label: "lab two", online: true },
      ],
    })
    const { run } = surface(a.remote)
    const error = failure(await run("thread_create", { name: "device-name-7", device: LAB_ID.slice(0, 8) }))
    expect(error).toMatchObject({ code: "ambiguous_target" })
    expect((error?.details?.["candidates"] as { device: string }[]).map((row) => row.device)).toEqual([LAB_ID, twin])
  })

  test("#given no device by that name #when thread_create names it #then not_found lists the account's devices by name and id", async () => {
    const a = account()
    const { run } = surface(a.remote)
    const error = failure(await run("thread_create", { name: "device-name-8", device: "nowhere" }))
    expect(error).toMatchObject({ code: "not_found", details: { device: "nowhere" } })
    expect(error?.details?.["candidates"]).toEqual([
      { device: "here", name: "this mac", online: true },
      { device: "b", name: "studio", online: true },
    ])
    expect(a.sent).toEqual([])
  })

  test("#given thread_list rows naming their machine #when each row's machine is passed to thread_create #then it creates on that row's device", async () => {
    const a = account()
    const { run, openSession } = surface(a.remote)
    const listed = await run("thread_list", { all_scope: true })
    const rows = listed.kind === "ok" && "threads" in listed ? listed.threads : []
    expect(rows.map((row) => [row.device ?? "here", row.machine])).toEqual([
      ["here", "this mac"],
      ["b", "studio"],
    ])
    for (const row of rows) await run("thread_create", { name: `device-name-${row.machine}`, device: row.machine })
    expect(openSession).toHaveBeenCalledTimes(1)
    expect(openedOn(a.sent)).toEqual(["b"])
  })
})
