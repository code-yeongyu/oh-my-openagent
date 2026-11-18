import { afterEach, describe, expect, test } from "bun:test"
import { chmodSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { ListingRow } from "@oh-my-opencode/device-service-core"
import {
  startFakeOwner,
  type FakeOwner,
} from "../../../../device-service-core/test/local-api/conformance/fake-owner.ts"
import { defaultWorld, OFFLINE_PEER, PEER } from "../../../../device-service-core/test/local-api/conformance/world.ts"
import { clientOn, closeClients, failureOf, fakeClock } from "./testing/fake-service"

// sessions.resolve (#13414 unit U5) over the conformance fake owner: an address to its row from the listing the client
// last read, with the owner counting every sessions.list it answers (contract L-1: a known session costs no relist).

const owners: FakeOwner[] = []
const dirs: string[] = []
afterEach(async () => {
  await closeClients()
  await Promise.all(owners.splice(0).map((owner) => owner.stop()))
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

const listed = (device: string, key: string, durable: string, title: string, project = "/work/omo"): ListingRow => ({
  device,
  session_id: key,
  durable_id: durable,
  title,
  project,
  path: `/home/user/.omo/agent/sessions/${durable}.jsonl`,
  state: "idle",
  updated_ms: 1_790_000_000_000,
  source: "live",
  as_of: 1_790_000_100_000,
})

async function account(rows: readonly ListingRow[]) {
  const stateDir = mkdtempSync(join(tmpdir(), "rs-"))
  chmodSync(stateDir, 0o700)
  dirs.push(stateDir)
  const world = defaultWorld()
  let listings = 0
  const owner = await startFakeOwner({
    stateDir,
    world: { ...world, listing: { ...world.listing, revisions: [{ rows, incomplete: [] }] } },
    onRequest: (type) => {
      if (type === "sessions.list") listings += 1
    },
  })
  owners.push(owner)
  return { client: clientOn(stateDir, fakeClock()), listings: () => listings }
}

describe("sessions.resolve", () => {
  test("#given a session on another device #when it is resolved by durable id, by name and by <device>/<durable id> #then each answers its row, ids are served from the last listing, and every name reads a fresh one", async () => {
    const { client, listings } = await account([listed(PEER, "rk-1", "dur-1", "Build Bot")])
    for (const address of ["dur-1", "build  bot", `${PEER}/dur-1`, "dur-1", "Build Bot"])
      expect(await client.sessions.resolve(address)).toMatchObject({
        kind: "ok",
        value: { thread: `${PEER}/rk-1`, durable_id: "dur-1", device: { id: PEER, name: "Studio" } },
      })
    // A name can gain a second holder or move to another session after any listing, so it is never answered from one.
    expect(listings()).toBe(3)
  })

  test("#given two devices each with a session of one name #when the name is resolved #then ambiguous_target names both, and the device's handle picks one", async () => {
    const { client } = await account([
      listed(PEER, "rk-1", "dur-1", "reviewer"),
      listed(OFFLINE_PEER, "rk-2", "dur-2", "reviewer"),
    ])
    const failure = failureOf(await client.sessions.resolve("reviewer"))
    expect(failure).toMatchObject({ code: "ambiguous_target" })
    expect((failure.details?.["candidates"] as { device: string }[]).map((candidate) => candidate.device)).toEqual([
      "Studio",
      "Laptop",
    ])
    expect(await client.sessions.resolve("Laptop/dur-2")).toMatchObject({
      kind: "ok",
      value: { thread: `${OFFLINE_PEER}/rk-2` },
    })
  })

  test("#given an address no device lists #when it is resolved #then it is not_found after one listing, and a session that listing named then resolves with no relist", async () => {
    const { client, listings } = await account([listed(PEER, "rk-1", "dur-1", "first")])
    expect(failureOf(await client.sessions.resolve("dur-gone"))).toMatchObject({
      code: "not_found",
      details: { kind: "session" },
    })
    expect(await client.sessions.resolve("dur-1")).toMatchObject({ kind: "ok", value: { durable_id: "dur-1" } })
    expect(listings()).toBe(1)
  })

  test("#given a session in another workspace #when its name is resolved in the caller's workspace #then it is not_found, and with all_scope or by its id it resolves", async () => {
    const { client } = await account([listed(PEER, "rk-1", "dur-1", "planner", "/work/other")])
    expect(failureOf(await client.sessions.resolve("planner", { workspace: "/work/omo" }))).toMatchObject({
      code: "not_found",
    })
    expect(await client.sessions.resolve("planner", { workspace: "/work/omo", all_scope: true })).toMatchObject({
      kind: "ok",
    })
    expect(await client.sessions.resolve("dur-1", { workspace: "/work/omo" })).toMatchObject({ kind: "ok" })
  })
})
