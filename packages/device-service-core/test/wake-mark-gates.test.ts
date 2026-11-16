import { afterEach, describe, expect, test } from "bun:test"
import { chmodSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  connectDeviceService,
  type DeviceService,
  LOCATE_SINGLE_MIN_SERVICE_VERSION,
  LocalApiError,
  NotSentError,
  WAKE_MARK_MIN_SERVICE_VERSION,
} from "../src/index.ts"
import { connectLocalApi, type LocalApiClient } from "../src/local-api/client.ts"
import { startFakeOwner, type FakeOwner } from "./local-api/conformance/fake-owner.ts"
import { defaultWorld, PEER, SESSION_ID } from "./local-api/conformance/world.ts"

// omo#13037 A6 and A4.3.3: the wake mark, the `wake` target and the single-probe locate are each sent only to a device
// service at or above its named minimum version (welcome.service_version); below it, or with the minimum null as it is
// until the release cut, every request this client makes keeps today's bytes.

const owners: FakeOwner[] = []
const services: DeviceService[] = []
const dirs: string[] = []

afterEach(async () => {
  for (const service of services.splice(0)) service.close()
  for (const owner of owners.splice(0)) await owner.stop()
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

type Calls = {
  readonly commands: unknown[][]
  readonly wakes: unknown[][]
  readonly locates: unknown[]
}

async function spiedService(
  minimums?: { readonly wakeMark: string | null; readonly singleLocate: string | null },
  serviceVersion?: string,
) {
  const stateDir = mkdtempSync(join(tmpdir(), "dsc-wake-"))
  chmodSync(stateDir, 0o700)
  dirs.push(stateDir)
  const world = defaultWorld()
  const owner = await startFakeOwner({
    stateDir,
    world: serviceVersion === undefined ? world : { ...world, service_version: serviceVersion },
  })
  owners.push(owner)
  const calls: Calls = { commands: [], wakes: [], locates: [] }
  const service = await connectDeviceService({
    version: "5.1.70",
    stateDir,
    ...(minimums === undefined ? {} : { minimums }),
    connect: async (options): Promise<LocalApiClient> => {
      const client = await connectLocalApi(options)
      return {
        ...client,
        // The owner stands in for a service before the mark: it gets the command without it, so the attach settles.
        commandTo: async (target, rpc, commandId, route, mark) => {
          if ("wake" in target) {
            calls.wakes.push([target.wake.device, target.wake.durable_id, rpc])
            throw new LocalApiError("unsupported", "the stand-in owner takes no wake target")
          }
          calls.commands.push([rpc, mark])
          return await client.commandTo(target, rpc, commandId, route)
        },
        request: (type, params) => {
          if (type === "session.locate") calls.locates.push(params)
          return client.request(type, params)
        },
      }
    },
  })
  services.push(service)
  return { service, calls }
}

const ADMIT = { type: "admit_external_message", sessionId: SESSION_ID, deliveryId: "d-1", text: "hello" }

describe("omo#13037: the wake mark and the single-probe locate are gated on the service's version", () => {
  // The release contract with omo-relay-daemon: the mark and the wake target shipped in device-service-v0.1.31 (#1076),
  // the single-probe locate in device-service-v0.1.13 (#393, #692). A wrong pin either sends a field an older service
  // refuses or never sends what a current one takes.
  test("#given the shipped minimums #then the mark and the wake target need 0.1.31 and the single probe 0.1.13", () => {
    expect(WAKE_MARK_MIN_SERVICE_VERSION).toBe("0.1.31")
    expect(LOCATE_SINGLE_MIN_SERVICE_VERSION).toBe("0.1.13")
  })

  test("#given null minimums #when a marked command, a wake and a single locate are asked #then the command goes unmarked, nothing wakes, and the locate is today's request", async () => {
    const { service, calls } = await spiedService({ wakeMark: null, singleLocate: null })
    expect({ mark: service.carriesWakeMark, single: service.takesSingleLocate }).toEqual({ mark: false, single: false })
    const attach = await service.attach(PEER, SESSION_ID)
    await attach.command(ADMIT, { accepts: ["session-wake:v1"] }).catch(() => undefined)
    expect(calls.commands).toEqual([[ADMIT, undefined]])
    const refused = await service.wakeCommand(PEER, "dur-1", ADMIT).catch((error: unknown) => error)
    expect(refused).toBeInstanceOf(NotSentError)
    expect((refused as NotSentError).code).toBe("unsupported")
    expect(calls.wakes).toEqual([])
    await service.locate(PEER, "dur-1", { single: true }).catch(() => undefined)
    expect(calls.locates).toEqual([{ device: PEER, engine_id: "dur-1" }])
  })

  test("#given a service at the minimum #when the same are asked #then the command carries the mark, the wake target is sent and the locate asks for one probe", async () => {
    const { service, calls } = await spiedService({ wakeMark: "1.4.0", singleLocate: "1.4.0" })
    expect({ mark: service.carriesWakeMark, single: service.takesSingleLocate }).toEqual({ mark: true, single: true })
    const attach = await service.attach(PEER, SESSION_ID)
    await attach.command(ADMIT, { accepts: ["session-wake:v1"] }).catch(() => undefined)
    expect(calls.commands).toEqual([[ADMIT, { accepts: ["session-wake:v1"] }]])
    await service.wakeCommand(PEER, "dur-1", ADMIT).catch(() => undefined)
    expect(calls.wakes.map(([device, durableId, rpc]) => [device, durableId, rpc])).toEqual([[PEER, "dur-1", ADMIT]])
    await service.locate(PEER, "dur-1", { single: true }).catch(() => undefined)
    expect(calls.locates).toEqual([{ device: PEER, engine_id: "dur-1", single: true }])
  })

  test("#given one connection to a service at the minimum and a later one to an older service #then each connection reads its own welcome: the later one carries no mark", async () => {
    const minimums = { wakeMark: "1.4.0", singleLocate: "1.4.0" }
    const first = await spiedService(minimums, "1.4.0")
    const later = await spiedService(minimums, "1.3.9")
    expect([first.service.carriesWakeMark, later.service.carriesWakeMark]).toEqual([true, false])
    const attach = await later.service.attach(PEER, SESSION_ID)
    await attach.command(ADMIT, { accepts: ["session-wake:v1"] }).catch(() => undefined)
    expect(later.calls.commands).toEqual([[ADMIT, undefined]])
  })

  test("#given a service below the minimum #then neither the mark nor the single probe is sent", async () => {
    const { service, calls } = await spiedService({ wakeMark: "1.5.0", singleLocate: "1.4.1" })
    expect({ mark: service.carriesWakeMark, single: service.takesSingleLocate }).toEqual({ mark: false, single: false })
    const attach = await service.attach(PEER, SESSION_ID)
    await attach.command(ADMIT, { accepts: ["session-wake:v1"] }).catch(() => undefined)
    await service.locate(PEER, "dur-1", { single: true }).catch(() => undefined)
    expect({ commands: calls.commands, locates: calls.locates }).toEqual({
      commands: [[ADMIT, undefined]],
      locates: [{ device: PEER, engine_id: "dur-1" }],
    })
  })

  test("#given a service below the minimum #when a wake is asked #then it is refused unsent, naming the service's version, the minimum and an action", async () => {
    // omo#13763: a bare `unsupported` left the user no way to tell an outdated device service from a missing feature.
    const { service, calls } = await spiedService({ wakeMark: "1.5.0", singleLocate: null })
    const refused = await service.wakeCommand(PEER, "dur-1", ADMIT).catch((error: unknown) => error)
    expect(refused).toBeInstanceOf(NotSentError)
    const { code, reason, action } = refused as NotSentError
    expect({ code, names: [reason.includes("1.4.0"), reason.includes("1.5.0")], hasAction: action !== null }).toEqual({
      code: "unsupported",
      names: [true, true],
      hasAction: true,
    })
    expect(calls.wakes).toEqual([])
  })
})
