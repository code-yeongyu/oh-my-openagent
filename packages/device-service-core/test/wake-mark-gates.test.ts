import { afterEach, describe, expect, test } from "bun:test"
import { chmodSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  connectDeviceService,
  type DeviceService,
  LOCATE_SINGLE_MIN_SERVICE_VERSION,
  LocalApiError,
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
  wakeError: LocalApiError = new LocalApiError("unsupported", "the stand-in owner takes no wake target"),
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
        command: (attach, rpc, commandId, route, commandOptions) => {
          calls.commands.push([rpc, commandOptions])
          return client.command(attach, rpc, commandId, route)
        },
        wakeCommand: async (...args) => {
          calls.wakes.push(args)
          throw wakeError
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
  test("#given the shipped minimums #then both are null, so no service carries the mark or takes the single probe", () => {
    expect(WAKE_MARK_MIN_SERVICE_VERSION).toBeNull()
    expect(LOCATE_SINGLE_MIN_SERVICE_VERSION).toBeNull()
  })

  test("#given the shipped null minimums #when a marked command, a wake and a single locate are asked #then the command goes unmarked, nothing wakes, and the locate is today's request", async () => {
    const { service, calls } = await spiedService()
    expect({ mark: service.carriesWakeMark, single: service.takesSingleLocate }).toEqual({ mark: false, single: false })
    const attach = await service.attach(PEER, SESSION_ID)
    await attach.command(ADMIT, { accepts: ["session-wake:v1"] }).catch(() => undefined)
    expect(calls.commands).toEqual([[ADMIT, undefined]])
    const refused = await service.wakeCommand(PEER, "dur-1", ADMIT).catch((error: unknown) => error)
    expect(refused).toBeInstanceOf(LocalApiError)
    expect({ code: (refused as LocalApiError).code, not_sent: (refused as LocalApiError).not_sent }).toEqual({
      code: "unsupported",
      not_sent: true,
    })
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

  // #13238 review: only a code that refuses before sending marks a wake not_sent. `closed` and `protocol_violation` can
  // end a wake already written, so they keep not_sent unset (the thread side then reports it uncertain, never refused).
  test.each([
    ["closed", undefined],
    ["protocol_violation", undefined],
    ["forbidden", true],
  ] as const)("#given the wake request fails with %s and no command_id #then not_sent is %p", async (code, notSent) => {
    const { service } = await spiedService(
      { wakeMark: "1.4.0", singleLocate: "1.4.0" },
      undefined,
      new LocalApiError(code, "the wake failed"),
    )
    const failed = await service.wakeCommand(PEER, "dur-1", ADMIT).catch((error: unknown) => error)
    expect({ code: (failed as LocalApiError).code, not_sent: (failed as LocalApiError).not_sent }).toEqual({
      code,
      not_sent: notSent,
    })
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
})
