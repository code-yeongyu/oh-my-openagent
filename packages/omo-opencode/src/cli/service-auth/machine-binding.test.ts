import { describe, expect, test } from "bun:test"
import { createHmac } from "node:crypto"
import { loginDevice } from "./device-flow"
import { generateDeviceKeys } from "./device-keys"
import { loginLoopback } from "./loopback"
import {
  HELD_BY_DEVICE_SERVICE,
  localMachineHash,
  machineHash,
  type MachineDeviceService,
  type MachineIdSources,
  prepareMachineSignIn,
  readMachineId,
  type RelaydMachineBinding,
} from "./machine-binding"
import { ApiRefusal } from "./protocol"
import { createSession, type DeviceServiceHandoff } from "./session"
import { clock, fakeApi, grant, memorySecrets, minted, refusal, temporaryHome } from "./test-support"

// omo-service#1016 / owner ruling OO1447: one machine is one OmO device. These pin the wire contract the service and
// relayd lanes share (hash formula, key reuse, refusal handling) at the CLI's real sign-in boundary.
const SALT = Buffer.alloc(32, 7).toString("base64url")
const RAW = "0123456789abcdef0123456789abcdef"
const linux = (id: string | undefined): MachineIdSources => ({
  platform: "linux",
  readText: async (path) => (path === "/etc/machine-id" ? id : undefined),
  run: async () => undefined,
})
const saltRefusal = () => refusal("machine_hash_required", { reason: "machine_hash_required", machineSalt: SALT })

function recordingService(answer: RelaydMachineBinding | undefined, held: string | null | undefined = undefined) {
  const adopted: string[] = []
  const handoff: DeviceServiceHandoff = {
    adopt: async (credentials) => {
      adopted.push(credentials.device.id)
    },
    forget: async () => undefined,
  }
  const machine: MachineDeviceService = { binding: async () => answer, heldDevice: async () => held }
  return { adopted, handoff, machine }
}

async function storedSignIn(api: string, secrets: ReturnType<typeof memorySecrets>, id: string) {
  const keys = generateDeviceKeys()
  await secrets.store(api).write({ ...grant, device: { id, name: "This Mac" }, ...keys.private })
  return keys
}

describe("machine hash (contract shared with relayd MID2 and the service)", () => {
  test("is unpadded base64url HMAC-SHA256 of the labelled id under the salt, per profile", async () => {
    const independent = (profile: string) =>
      createHmac("sha256", Buffer.from(SALT, "base64url"))
        .update(`omo-machine-v1\0${profile}\0${RAW}`)
        .digest("base64url")
    expect(machineHash(SALT, "", RAW)).toBe(independent(""))
    expect(machineHash(SALT, "", RAW)).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(await localMachineHash({ OMO_DEVICE_PROFILE: "qa" }, linux(`${RAW}\n`)).hash(SALT)).toBe(independent("qa"))
    expect(await localMachineHash({ OMO_DEVICE_PROFILE: "a/b" }, linux(RAW)).hash(SALT)).toBeUndefined()
  })

  test("reads the OS id like relayd: Linux falls back past an uninitialized file, macOS uses the absolute ioreg", async () => {
    const dbus: MachineIdSources = {
      platform: "linux",
      run: async () => undefined,
      readText: async (path) =>
        path === "/etc/machine-id" ? "uninitialized\n" : path === "/var/lib/dbus/machine-id" ? RAW : undefined,
    }
    expect(await readMachineId(dbus)).toBe(RAW)
    const runs: string[] = []
    const mac: MachineIdSources = {
      platform: "darwin",
      readText: async () => undefined,
      run: async (file, args) => {
        runs.push([file, ...args].join(" "))
        return '  "IOPlatformUUID" = "A1B2C3D4-E5F6-4711-8899-AABBCCDDEEFF"'
      },
    }
    expect(await readMachineId(mac)).toBe("A1B2C3D4-E5F6-4711-8899-AABBCCDDEEFF")
    expect(runs).toEqual(["/usr/sbin/ioreg -rd1 -c IOPlatformExpertDevice"])
    expect(await readMachineId(linux(undefined))).toBeUndefined()
  })
})

describe("a CLI sign-in binds to the machine's device instead of registering its own", () => {
  test("relayd holds the stored keys: same keys re-presented with relayd's hash, no second adopt", async () => {
    const secrets = memorySecrets()
    const bodies: Record<string, unknown>[] = []
    let polls = 0
    const api = fakeApi(async (request) => {
      const body = await request.json()
      bodies.push(body)
      if (request.url.endsWith("/code")) return Response.json(minted)
      return ++polls === 1 ? saltRefusal() : Response.json({ ...grant, device: { id: "machine-1", name: "This Mac" } })
    })
    const keys = await storedSignIn(api, secrets, "machine-1")
    const service = recordingService({
      machineHash: "h".repeat(43),
      device: { id: "machine-1", ...keys.public },
      mergeDeviceIds: ["old-desktop", "machine-1"],
    })
    const session = createSession({
      beforeKeysDiscarded: async () => undefined,
      api,
      store: secrets.store(api),
      home: await temporaryHome(),
      deviceService: service.handoff,
    })
    await loginDevice(session, {
      name: "This Mac",
      platform: "macos",
      ...clock(),
      show: () => {},
      chooseDevice: async () => null,
      machine: async (current) =>
        prepareMachineSignIn({
          stored: await current.stored(),
          local: localMachineHash({}, linux(RAW)),
          deviceService: service.machine,
        }),
    })
    expect(bodies[0]).toEqual({ client: { name: "This Mac", platform: "macos", machineBinding: 1 } })
    expect(bodies[1]).not.toHaveProperty("machineHash")
    expect(bodies[2]).toMatchObject({ ...keys.public, machineHash: "h".repeat(43), mergeDeviceIds: ["old-desktop"] })
    expect(service.adopted).toEqual([])
    expect((await secrets.store(api).read())?.signingPrivateKey).toBe(keys.private.signingPrivateKey)
  })

  test("relayd holds another device and the CLI cannot present its keys: refuses instead of minting", async () => {
    const secrets = memorySecrets()
    let polls = 0
    const api = fakeApi((request) => {
      if (request.url.endsWith("/code")) return Response.json(minted)
      polls++
      return polls === 1 ? saltRefusal() : Response.json(grant)
    })
    const service = recordingService({
      machineHash: "h".repeat(43),
      device: { id: "desktop-1", ...generateDeviceKeys().public },
      mergeDeviceIds: [],
    })
    const session = createSession({
      beforeKeysDiscarded: async () => undefined,
      api,
      store: secrets.store(api),
      home: await temporaryHome(),
      deviceService: service.handoff,
    })
    await expect(
      loginDevice(session, {
        name: "This Mac",
        platform: "macos",
        ...clock(),
        show: () => {},
        chooseDevice: async () => null,
        machine: async (current) =>
          prepareMachineSignIn({
            stored: await current.stored(),
            local: localMachineHash({}, linux(RAW)),
            deviceService: service.machine,
          }),
      }),
    ).rejects.toThrow(HELD_BY_DEVICE_SERVICE)
    expect(polls).toBe(1)
    expect(secrets.writes).toHaveLength(0)
  })

  test("an older relayd still holding a live device blocks a mint the same way", async () => {
    const service = recordingService(undefined, "desktop-1")
    const machine = await prepareMachineSignIn({
      stored: null,
      local: localMachineHash({}, linux(RAW)),
      deviceService: service.machine,
    })
    await expect(machine.retry(new ApiRefusal("machine_hash_required", 400, undefined, null, SALT))).rejects.toThrow(
      HELD_BY_DEVICE_SERVICE,
    )
  })

  test("no device service: fresh keys bound by the in-process hash, then adopted as before", async () => {
    const secrets = memorySecrets()
    const tokenBodies: Record<string, unknown>[] = []
    const api = fakeApi(async (request) => {
      if (request.url.endsWith("/code")) return Response.json(minted)
      const body = await request.json()
      tokenBodies.push(body)
      return tokenBodies.length === 1 ? saltRefusal() : Response.json(grant)
    })
    const service = recordingService(undefined, undefined)
    const session = createSession({
      beforeKeysDiscarded: async () => undefined,
      api,
      store: secrets.store(api),
      home: await temporaryHome(),
      deviceService: service.handoff,
    })
    await loginDevice(session, {
      name: "Box",
      platform: "linux",
      ...clock(),
      show: () => {},
      chooseDevice: async () => null,
      machine: async (current) =>
        prepareMachineSignIn({
          stored: await current.stored(),
          local: localMachineHash({}, linux(RAW)),
          deviceService: service.machine,
        }),
    })
    expect(tokenBodies[1]).toMatchObject({ machineHash: machineHash(SALT, "", RAW) })
    expect(tokenBodies[1]).not.toHaveProperty("mergeDeviceIds")
    expect(service.adopted).toEqual([grant.device.id])
  })

  test("no readable machine id: the request is exactly today's unbound sign-in", async () => {
    const machine = await prepareMachineSignIn({
      stored: null,
      local: localMachineHash({}, linux(undefined)),
      deviceService: recordingService(undefined).machine,
    })
    expect(machine.advertise).toBe(false)
    expect(machine.fields()).toEqual({})
  })

  test("loopback: machine_hash_required retries the same unconsumed code once with the hash", async () => {
    const secrets = memorySecrets()
    const exchanges: Record<string, unknown>[] = []
    const api = fakeApi(async (request) => {
      const body = await request.json()
      exchanges.push(body)
      return exchanges.length === 1 ? saltRefusal() : Response.json(grant)
    })
    const session = createSession({
      beforeKeysDiscarded: async () => undefined,
      api,
      store: secrets.store(api),
      home: await temporaryHome(),
    })
    await loginLoopback(session, {
      accounts: "https://signin.omo.dev",
      name: "Box",
      platform: "linux",
      chooseDevice: async () => null,
      machine: async (current) =>
        prepareMachineSignIn({
          stored: await current.stored(),
          local: localMachineHash({}, linux(RAW)),
          deviceService: undefined,
        }),
      open: async (url) => {
        const authorize = new URL(url)
        const callback = new URL(authorize.searchParams.get("redirect_uri") ?? "")
        callback.searchParams.set("code", "one-use-code")
        callback.searchParams.set("state", authorize.searchParams.get("state") ?? "")
        expect((await fetch(callback, { proxy: "" })).status).toBe(200)
        return true
      },
    })
    expect(exchanges).toHaveLength(2)
    expect(exchanges[1]).toMatchObject({
      code: "one-use-code",
      codeVerifier: exchanges[0]?.["codeVerifier"],
      machineHash: machineHash(SALT, "", RAW),
    })
  })
})
