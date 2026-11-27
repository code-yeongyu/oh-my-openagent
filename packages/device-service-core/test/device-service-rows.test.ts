import { afterEach, describe, expect, test } from "bun:test"
import { chmodSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { connectDeviceService, type DeviceService } from "../src/index.ts"
import { newestRowsListing } from "../src/listing-rows.ts"
import type { LocalApiClient } from "../src/local-api/client.ts"
import type { ListingRow, ListingWait } from "../src/local-api/protocol.ts"
import { startFakeOwner, type FakeOwner } from "./local-api/conformance/fake-owner.ts"
import type { RowsVersion } from "./local-api/conformance/fake-owner-rows.ts"
import { defaultWorld, type World } from "./local-api/conformance/world.ts"
import { cleanup, connectClient, startOwner } from "./local-api/support.ts"

const owners: FakeOwner[] = []
const services: DeviceService[] = []
const dirs: string[] = []

afterEach(cleanup)
afterEach(async () => {
  for (const service of services.splice(0)) service.close()
  for (const owner of owners.splice(0)) await owner.stop()
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

const DURABLE_ID = "01a1c608-a959-7764-a0db-94773c516e26"

const MODEL = { provider: "anthropic", id: "claude-opus-5-5" }
const WAITING: ListingWait = {
  kind: "rate_limit",
  attempt: 2,
  maxAttempts: 5,
  delayMs: 30_000,
  until: "2026-11-21T01:30:00.000Z",
}
const ENGINE_VERSION = "2026.11.19-3"

function worldKnowing(rowsNewest: RowsVersion): World {
  const world = defaultWorld()
  const base = world.listing.revisions[1]?.rows[0]
  if (base === undefined) throw new Error("the default world lists no row")
  const row: ListingRow = {
    ...base,
    kind: "interactive",
    durable_id: DURABLE_ID,
    model: MODEL,
    archived: true,
    waiting: WAITING,
    engine_version: ENGINE_VERSION,
  }
  return { ...world, listing: { revisions: [{ rows: [row], incomplete: [] }], devices: {}, rowsNewest } }
}

async function serviceFor(world: World): Promise<{ owner: FakeOwner; service: DeviceService }> {
  const dir = mkdtempSync(join(tmpdir(), "dsc-rows-"))
  chmodSync(dir, 0o700)
  dirs.push(dir)
  const owner = await startFakeOwner({ stateDir: dir, world })
  owners.push(owner)
  const service = await connectDeviceService({ version: "5.1.52", stateDir: owner.stateDir })
  services.push(service)
  return { owner, service }
}

const listCalls = (owner: FakeOwner): number => owner.state.log.filter((type) => type === "sessions.list").length

// The rows versions one listing asks, in order: the real client against the fake owner, each ask recorded.
async function rowsAsked(rowsNewest: RowsVersion, listings: number): Promise<(number | undefined)[]> {
  const asked: (number | undefined)[] = []
  const client = await connectClient(await startOwner(worldKnowing(rowsNewest)))
  const recording: LocalApiClient = {
    ...client,
    list: (filter, onRevision, rows) => {
      asked.push(rows)
      return client.list(filter, onRevision, rows)
    },
  }
  const list = newestRowsListing(recording)
  for (let i = 0; i < listings; i += 1) await list()
  return asked
}

describe("DeviceService.sessions asks the newest listing row version (#13045, part of #12996)", () => {
  test("#given a service that serves rows 7 #when sessions lists #then each row carries every field through its engine version, asked once", async () => {
    const { owner, service } = await serviceFor(worldKnowing(7))
    const [row] = (await service.sessions()).rows
    expect(row).toMatchObject({
      durable_id: DURABLE_ID,
      kind: "interactive",
      model: MODEL,
      archived: true,
      waiting: WAITING,
      engine_version: ENGINE_VERSION,
    })
    expect(listCalls(owner)).toBe(1)
  })

  test("#given a service that predates rows 7 #when sessions lists #then the row carries its retry wait and no engine version", async () => {
    const { owner, service } = await serviceFor(worldKnowing(6))
    const [row] = (await service.sessions()).rows
    expect(row?.waiting).toEqual(WAITING)
    expect(row).not.toHaveProperty("engine_version")
    expect(listCalls(owner)).toBe(2)
  })

  test("#given a service that serves rows 4 #when sessions lists #then each row carries its durable_id, model and archived flag and neither rows 6/7 field", async () => {
    const { service } = await serviceFor(worldKnowing(4))
    const [row] = (await service.sessions()).rows
    expect(row).toMatchObject({ durable_id: DURABLE_ID, kind: "interactive", model: MODEL, archived: true })
    expect(row).not.toHaveProperty("waiting")
    expect(row).not.toHaveProperty("engine_version")
  })

  test("#given services that refuse newer rows #when one listing runs #then it asks rows 7 first and steps down one version per invalid_request", async () => {
    expect(await rowsAsked(7, 1)).toEqual([7])
    expect(await rowsAsked(6, 1)).toEqual([7, 6])
    expect(await rowsAsked(5, 1)).toEqual([7, 6, 5])
    expect(await rowsAsked(4, 1)).toEqual([7, 6, 5, 4])
    expect(await rowsAsked(1, 1)).toEqual([7, 6, 5, 4, 3, 2, undefined])
  })

  test("#given a service that accepted rows 5 #when it lists again #then it asks rows 5 straight away", async () => {
    expect(await rowsAsked(5, 3)).toEqual([7, 6, 5, 5, 5])
  })

  test("#given a service that predates rows 4 #when sessions lists #then each row carries its durable_id and neither model nor archived", async () => {
    const { service } = await serviceFor(worldKnowing(3))
    const [row] = (await service.sessions()).rows
    expect(row?.durable_id).toBe(DURABLE_ID)
    expect(row?.kind).toBe("interactive")
    expect(row).not.toHaveProperty("model")
    expect(row).not.toHaveProperty("archived")
  })

  test("#given a service that predates rows 3 #when sessions lists #then it steps down to rows 2 and keeps listing", async () => {
    const { service } = await serviceFor(worldKnowing(2))
    const [row] = (await service.sessions()).rows
    expect(row?.kind).toBe("interactive")
    expect(row?.durable_id).toBeUndefined()
  })

  test("#given a service that predates rows #when sessions lists twice #then it lists plain rows and asks the old service only once more", async () => {
    const { owner, service } = await serviceFor(worldKnowing(1))
    const [row] = (await service.sessions()).rows
    expect(row?.kind).toBeUndefined()
    expect(row?.durable_id).toBeUndefined()
    expect(listCalls(owner)).toBe(7)
    await service.sessions()
    expect(listCalls(owner)).toBe(8)
  })
})
