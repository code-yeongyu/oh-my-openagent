import { afterEach, describe, expect, test } from "bun:test"
import { chmodSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { connectDeviceService, deviceServiceStateDir, type DeviceService, LocalApiError, type RemoteAttachEvent } from "../src/index.ts"
import { writeToken } from "../src/local-api/access.ts"
import { connectLocalApi } from "../src/local-api/client.ts"
import { startFakeOwner, type FakeOwner } from "./local-api/conformance/fake-owner.ts"
import { defaultWorld, OFFLINE_PEER, PEER, SESSION_ID, type World } from "./local-api/conformance/world.ts"
import { testSecure } from "./local-api/support.ts"

const owners: FakeOwner[] = []
const services: DeviceService[] = []
const dirs: string[] = []

afterEach(async () => {
  for (const service of services.splice(0)) service.close()
  for (const owner of owners.splice(0)) await owner.stop()
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

const within = <T>(promise: Promise<T>, what: string, ms = 5_000): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined
  const expired = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`waited ${ms} ms for ${what}, it never came`)), ms)
  })
  return Promise.race([promise, expired]).finally(() => clearTimeout(timer))
}

const stateDir = (): string => {
  const dir = mkdtempSync(join(tmpdir(), "dsc-"))
  chmodSync(dir, 0o700)
  dirs.push(dir)
  return dir
}

function firstSession(world: World) {
  const session = world.sessions[0]
  if (session === undefined) throw new Error("the default world has no session")
  return session
}

async function serviceFor(world: World = defaultWorld()): Promise<{ owner: FakeOwner; service: DeviceService }> {
  const owner = await startFakeOwner({ stateDir: stateDir(), world })
  owners.push(owner)
  const service = await connectDeviceService({ version: "5.1.52", stateDir: owner.stateDir })
  services.push(service)
  return { owner, service }
}

describe("deviceServiceStateDir", () => {
  test("uses ~/.omo/device-service on POSIX and LOCALAPPDATA on Windows", () => {
    expect(deviceServiceStateDir("darwin", {}, "/Users/a")).toBe(join("/Users/a", ".omo", "device-service"))
    expect(deviceServiceStateDir("linux", { LOCALAPPDATA: "/ignored" }, "/home/a")).toBe(join("/home/a", ".omo", "device-service"))
    expect(deviceServiceStateDir("win32", { LOCALAPPDATA: "C:\\Users\\a\\AppData\\Local" }, "C:\\Users\\a")).toBe(
      join("C:\\Users\\a\\AppData\\Local", "OmO", "device-service"),
    )
    expect(deviceServiceStateDir("win32", {}, "C:\\Users\\a")).toBe(join("C:\\Users\\a", "AppData", "Local", "OmO", "device-service"))
  })
})

describe("connectDeviceService", () => {
  test("proves the owner, then reports the welcome status and version", async () => {
    const { service } = await serviceFor()
    expect(service.serviceVersion).toBe("1.4.0")
    expect(service.initialStatus.state).toBe("connected")
    expect(await service.status()).toEqual(defaultWorld().status)
    expect(await service.thisDevice()).toEqual({ id: "dev-self", name: "This Mac" })
  })

  test("refuses an owner that cannot prove the per-boot token before sending any request", async () => {
    const owner = await startFakeOwner({ stateDir: stateDir(), world: defaultWorld() })
    owners.push(owner)
    await writeToken(owner.stateDir, testSecure)
    const error = await connectDeviceService({ version: "5.1.52", stateDir: owner.stateDir }).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(LocalApiError)
    expect((error as LocalApiError).code).toBe("server_proof_invalid")
  })

  test.skipIf(process.platform === "win32")("refuses a state dir other users can read before connecting", async () => {
    const owner = await startFakeOwner({ stateDir: stateDir(), world: defaultWorld() })
    owners.push(owner)
    chmodSync(owner.stateDir, 0o755)
    const error = await connectDeviceService({ version: "5.1.52", stateDir: owner.stateDir }).catch((e: unknown) => e)
    expect((error as LocalApiError).code).toBe("insecure_state_dir")
    expect(owner.connections()).toBe(0)
  })
})

describe("DeviceService", () => {
  test("watchStatus replays the current status and follows the switch", async () => {
    const { service } = await serviceFor()
    const seen: string[] = []
    const changed = new Promise<void>(resolve => {
      void service.watchStatus(status => {
        seen.push(`${status.state}:${status.enabled}`)
        if (!status.enabled) resolve()
      })
    })
    expect(await service.setEnabled(false)).toBe(false)
    await within(changed, "status.changed with the switch off")
    expect(seen[0]).toBe("connected:true")
    expect(seen.at(-1)).toBe("disabled:false")
  })

  test("devices lists every device of the account with its presence", async () => {
    const { service } = await serviceFor()
    const devices = await service.devices()
    expect(devices.map(device => [device.device, device.label, device.online])).toEqual([
      [PEER, "Studio", true],
      [OFFLINE_PEER, "Laptop", false],
    ])
  })

  test("sessions settles on the round's last revision and reports each revision whole", async () => {
    const { service } = await serviceFor()
    const revisions: number[][] = []
    const result = await service.sessions(undefined, revision => revisions.push([revision.revision, revision.rows.length]))
    expect(revisions).toEqual([[1, 1], [2, 2]])
    expect(result.rows.map(row => [row.device, row.source])).toEqual([[OFFLINE_PEER, "cache"], [PEER, "live"]])
    expect(result.incomplete).toEqual([])
    expect(result.devices).toEqual({ [PEER]: "answered", [OFFLINE_PEER]: "undelivered" })
  })

  test("a device filter narrows only this query's rows", async () => {
    const { service } = await serviceFor()
    const result = await service.sessions({ device: PEER })
    expect(result.rows.map(row => row.device)).toEqual([PEER])
  })

  test("attach delivers the snapshot, then records, reads history pages and detaches", async () => {
    const { service } = await serviceFor()
    const attach = await service.attach(PEER, SESSION_ID)
    expect(await attach.snapshot).toEqual(firstSession(defaultWorld()).snapshot)
    const events: RemoteAttachEvent["kind"][] = []
    const recordsSeen = new Promise<void>(resolve => {
      attach.onEvent(event => {
        events.push(event.kind)
        if (event.kind === "records") resolve()
      })
    })
    await within(recordsSeen, "the attach's records")
    expect(events.slice(0, 2)).toEqual(["snapshot", "records"])
    const page = await attach.read({ before: "e-3" })
    expect(page.entries).toEqual([
      { entry_id: "e-1", entry: { id: "e-1", type: "message", text: "first" } },
      { entry_id: "e-2", too_large: true, bytes: 20_000_000 },
    ])
    expect(page.next_before).toBeNull()
    await attach.detach()
  })

  test("detach releases the attach's subscription, settles detached, and tolerates a second detach", async () => {
    const owner = await startFakeOwner({ stateDir: stateDir(), world: defaultWorld() })
    owners.push(owner)
    let live = 0
    const service = await connectDeviceService({
      version: "5.1.52",
      stateDir: owner.stateDir,
      connect: async options => {
        const client = await connectLocalApi(options)
        return {
          ...client,
          onEvent: listener => {
            live++
            const stop = client.onEvent(listener)
            let stopped = false
            return () => {
              if (!stopped) live--
              stopped = true
              stop()
            }
          },
        }
      },
    })
    services.push(service)
    const before = live
    const attach = await service.attach(PEER, SESSION_ID)
    await attach.snapshot
    expect(live).toBe(before + 1)
    await attach.detach()
    expect(await within(attach.detached, "detached to settle")).toBe("detached")
    expect(live).toBe(before)
    await attach.detach()
  })

  test("a snapshot too large for one line arrives as a verified blob", async () => {
    const world = defaultWorld()
    const session = firstSession(world)
    const big = "x".repeat(700_000)
    const snapshot = { ...session.snapshot, entries: [{ id: "e-3", type: "message", text: big }] }
    const { service } = await serviceFor({ ...world, sessions: [{ ...session, snapshot }] })
    const attach = await service.attach(PEER, SESSION_ID)
    expect(await attach.snapshot).toEqual(snapshot)
  })

  test("attaching to an unknown session fails with the service's error code", async () => {
    const { service } = await serviceFor()
    const error = await service.attach(PEER, "bm8tc3VjaC1zZXNzaW9u").catch((e: unknown) => e)
    expect(error).toBeInstanceOf(LocalApiError)
    expect((error as LocalApiError).code).toBe("session_not_found")
  })
})
