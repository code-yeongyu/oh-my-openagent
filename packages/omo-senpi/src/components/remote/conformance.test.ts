import { afterEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
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

  // #14172: a signed-in device (adopted identity kept) with no endpoint is "restarting" only while a process holds its state
  // or an update is in flight; a crashed, stopped or uninstalled service is "not running", never retried forever.
  const MINUTE = 60_000
  const exitedPid = async (): Promise<number> => {
    const child = Bun.spawn(["true"])
    await child.exited
    return child.pid
  }
  test.each([
    ["a live process holds the state (its endpoint not up yet)", { owner: "live" }, "service_restarting"],
    ["an update is pending", { update: ["pending", 1] }, "service_restarting"],
    ["an update is in trial", { update: ["trial", 2] }, "service_restarting"],
    ["only the identity is left (a crash or a hand stop)", {}, "service_not_running"],
    [
      "the recorded process is gone and the last update committed",
      { owner: "exited", update: ["committed", 1] },
      "service_not_running",
    ],
    ["an update has been pending past its bound", { update: ["pending", 16] }, "service_not_running"],
  ] as const)(
    "#given a signed-in device with no endpoint where %s #when the service is read #then it answers host_unavailable with that reason",
    async (_case, files, reason) => {
      const stateDir = mkdtempSync(join(tmpdir(), "rm-"))
      emptyDirs.push(stateDir)
      const clock = fakeClock()
      writeFileSync(join(stateDir, "device-identity.json"), "{}")
      if ("owner" in files) {
        const pid = files.owner === "live" ? process.pid : await exitedPid()
        writeFileSync(
          join(stateDir, "owner.info"),
          JSON.stringify({ pid, since_ms: 0, owner: "service", version: "0.1.42" }),
        )
      }
      if ("update" in files) {
        const [status, minutesAgo] = files.update
        mkdirSync(join(stateDir, "update"))
        writeFileSync(
          join(stateDir, "update", "update.json"),
          JSON.stringify({ v: 2, status, started_ms: clock.now() - minutesAgo * MINUTE }),
        )
      }
      const client = clientOn(stateDir, clock)
      expect(failureOf(await client.service.status())).toMatchObject({
        code: "host_unavailable",
        details: { reason, phase: "connect" },
      })
      // Not the no-service self row: the device is set up, its service is what is missing.
      expect(failureOf(await client.devices.list())).toMatchObject({ code: "host_unavailable", details: { reason } })
    },
  )
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
