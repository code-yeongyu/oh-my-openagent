import { afterEach, describe, expect, test } from "bun:test"
import { chmodSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { connectDeviceService, type DeviceService } from "../src/index.ts"
import type { ListingRow } from "../src/local-api/protocol.ts"
import { startFakeOwner, type FakeOwner } from "./local-api/conformance/fake-owner.ts"
import { defaultWorld, type World } from "./local-api/conformance/world.ts"

const owners: FakeOwner[] = []
const services: DeviceService[] = []
const dirs: string[] = []

afterEach(async () => {
  for (const service of services.splice(0)) service.close()
  for (const owner of owners.splice(0)) await owner.stop()
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

const DURABLE_ID = "01a1c608-a959-7764-a0db-94773c516e26"

function worldKnowing(rowsNewest: 1 | 2 | 3): World {
  const world = defaultWorld()
  const base = world.listing.revisions[1]?.rows[0]
  if (base === undefined) throw new Error("the default world lists no row")
  const row: ListingRow = { ...base, kind: "interactive", durable_id: DURABLE_ID }
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

const listCalls = (owner: FakeOwner): number => owner.state.log.filter(type => type === "sessions.list").length

describe("DeviceService.sessions asks the newest listing row version (#13045, part of #12996)", () => {
  test("#given a service that serves rows 3 #when sessions lists #then each row carries its durable_id", async () => {
    const { service } = await serviceFor(worldKnowing(3))
    const [row] = (await service.sessions()).rows
    expect(row?.durable_id).toBe(DURABLE_ID)
    expect(row?.kind).toBe("interactive")
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
    expect(listCalls(owner)).toBe(3)
    await service.sessions()
    expect(listCalls(owner)).toBe(4)
  })
})
