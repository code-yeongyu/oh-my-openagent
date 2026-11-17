import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { OFFLINE_PEER, PEER, SESSION_ID } from "../../../../device-service-core/test/local-api/conformance/world.ts"
import { canonicalizeThreadHandle, describeThread } from "./seams"
import { clientOn, closeClients, failureOf, fakeClock, startOwner } from "./testing/fake-service"
import type { RemoteClient } from "./client"

// Conformance rows of part 4a-1 (design v8-core r2, B1): the service, devices and sessions.list members over the device
// service's own answers (the conformance fake owner's default world), the self row, and the no-service self row.

const emptyDirs: string[] = []
afterEach(async () => {
  await closeClients()
  for (const dir of emptyDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

const valueOf = async <T>(
  outcome: Promise<{ readonly kind: "ok"; readonly value: T } | { readonly kind: "error" }>,
) => {
  const settled = await outcome
  if (settled.kind !== "ok") throw new Error(`expected a value, got ${JSON.stringify(settled)}`)
  return settled.value
}

const onDefaultWorld = async (): Promise<RemoteClient> => clientOn((await startOwner()).stateDir, fakeClock())

describe("conformance rows: service.*", () => {
  test("#given the default world #when the service members read #then they answer the service's own status, version and attach setting", async () => {
    const client = await onDefaultWorld()
    expect(await valueOf(client.service.info())).toEqual({
      service_version: "1.4.0",
      capabilities: expect.arrayContaining(["sessions", "devices", "control"]),
    })
    expect(await valueOf(client.service.status())).toMatchObject({ state: "connected", enabled: true })
    expect(await valueOf(client.service.control())).toMatchObject({ attached: expect.any(Boolean) })
  })

  test("#given a person client #when it disables the service and sets the attach setting #then the service reports both", async () => {
    const client = await onDefaultWorld()
    expect(await valueOf(client.service.setEnabled(false))).toEqual({ enabled: false })
    expect(await valueOf(client.service.status())).toMatchObject({ enabled: false, state: "disabled" })
    expect(await valueOf(client.service.setControl(false))).toMatchObject({ attached: false })
    expect(await valueOf(client.service.control())).toMatchObject({ attached: false })
  })

  test("#given a session client #when it calls a mutator #then it answers sender_not_allowed and the service is unchanged", async () => {
    const owner = await startOwner()
    const session = clientOn(owner.stateDir, fakeClock(), { kind: "session", id: "dur-1" })
    expect(failureOf(await session.service.setEnabled(false)).code).toBe("sender_not_allowed")
    expect(failureOf(await session.service.setControl(false)).code).toBe("sender_not_allowed")
    expect(await valueOf(session.service.status())).toMatchObject({ enabled: true })
  })

  test("#given bootstrap #when no runner was given #then unsupported{bootstrap}; when one was #then its result", async () => {
    const owner = await startOwner()
    expect(failureOf(await clientOn(owner.stateDir, fakeClock()).service.bootstrap({}))).toMatchObject({
      code: "unsupported",
      details: { feature: "bootstrap" },
    })
    const stopped = { kind: "stopped", state: "signed_out", notice: "signed out" } as const
    const withRunner = clientOn(owner.stateDir, fakeClock(), { kind: "service" }, { bootstrap: async () => stopped })
    expect(await valueOf(withRunner.service.bootstrap({ install: true }))).toEqual(stopped)
  })
})

describe("conformance rows: devices.*", () => {
  test("#given the default world #when devices.list reads #then this device comes first as the self row, then the listed devices", async () => {
    const rows = await valueOf((await onDefaultWorld()).devices.list())
    expect(rows.map((row) => [row.id, row.name, row.self ?? false])).toEqual([
      ["dev-self", "This Mac", true],
      [PEER, "Studio", false],
      [OFFLINE_PEER, "Laptop", false],
    ])
    expect(rows[0]?.caps).toEqual({ attach: true, machine: false, control: true })
    expect(rows[2]).toMatchObject({ online: false, kind: "cli", platform: "linux" })
  })

  test("#given device names #when devices.resolve takes an id, a name in any case, or an unknown name #then it finds the row or answers not_found", async () => {
    const client = await onDefaultWorld()
    expect((await valueOf(client.devices.resolve(PEER))).name).toBe("Studio")
    expect((await valueOf(client.devices.resolve("laptop"))).id).toBe(OFFLINE_PEER)
    expect(failureOf(await client.devices.resolve("Nowhere"))).toMatchObject({
      code: "not_found",
      details: { kind: "device" },
    })
  })

  test("#given no device service on this device #when devices.list reads #then it answers the local self row; service.status answers host_unavailable", async () => {
    const stateDir = mkdtempSync(join(tmpdir(), "rm-"))
    emptyDirs.push(stateDir)
    const client = clientOn(stateDir, fakeClock())
    const rows = await valueOf(client.devices.list())
    expect(rows).toEqual([
      expect.objectContaining({
        id: "local",
        self: true,
        online: true,
        caps: { attach: true, machine: false, control: false },
      }),
    ])
    expect(failureOf(await client.service.status())).toMatchObject({
      code: "host_unavailable",
      details: { reason: "service_not_installed" },
    })
  })
})

describe("conformance rows: sessions.list", () => {
  test("#given the default world #when sessions.list reads #then rows carry their device rows and the device that missed the round is unanswered", async () => {
    const list = await valueOf((await onDefaultWorld()).sessions.list())
    expect(list.rows.map((row) => [row.thread, row.device.name, row.source, row.archived])).toEqual([
      [`${OFFLINE_PEER}/${SESSION_ID}`, "Laptop", "cache", false],
      [`${PEER}/${SESSION_ID}`, "Studio", "live", false],
    ])
    expect(list.unanswered.map((row) => row.id)).toEqual([OFFLINE_PEER])
    const live = list.rows[1]
    if (live === undefined) throw new Error("the default world lists a live session")
    expect(describeThread(live)).toBe(`"Live session" on Studio (${PEER}/${SESSION_ID})`)
    expect(canonicalizeThreadHandle(live.thread, {})).toMatchObject({
      kind: "ok",
      value: { handle: live.thread, target: { kind: "device_session", device: PEER, session: SESSION_ID } },
    })
  })

  test("#given a name filter and an archived filter #when sessions.list reads #then only the named row comes back and no row is archived", async () => {
    const client = await onDefaultWorld()
    expect((await valueOf(client.sessions.list({ name: "live SESSION" }))).rows.map((row) => row.title)).toEqual([
      "Live session",
    ])
    expect((await valueOf(client.sessions.list({ archived: true }))).rows).toEqual([])
  })
})
