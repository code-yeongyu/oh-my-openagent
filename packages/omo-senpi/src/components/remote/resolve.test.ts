import { afterEach, describe, expect, test } from "bun:test"
import { chmodSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { ListingRow } from "@oh-my-opencode/device-service-core"
import {
  startFakeOwner,
  type FakeOwner,
} from "../../../../device-service-core/test/local-api/conformance/fake-owner.ts"
import {
  defaultWorld,
  OFFLINE_PEER,
  PEER,
  type World,
} from "../../../../device-service-core/test/local-api/conformance/world.ts"
import { resolveMember } from "./resolve"
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

async function account(
  rows: readonly ListingRow[],
  over: { devices?: readonly World["devices"][number][]; incomplete?: readonly string[] } = {},
) {
  const stateDir = mkdtempSync(join(tmpdir(), "rs-"))
  chmodSync(stateDir, 0o700)
  dirs.push(stateDir)
  const world = defaultWorld()
  let listings = 0
  const owner = await startFakeOwner({
    stateDir,
    world: {
      ...world,
      ...(over.devices === undefined ? {} : { devices: over.devices }),
      listing: { ...world.listing, revisions: [{ rows, incomplete: over.incomplete ?? [] }] },
    },
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

  test("#given a device named 'Studio Mac' #when the device part differs only by Unicode form or inner whitespace #then normalizeName still resolves its session", async () => {
    const { client } = await account([listed(PEER, "rk-8", "dur-8", "Bot")], {
      devices: [
        {
          device: PEER,
          label: "Studio Mac",
          kind: "desktop",
          platform: "darwin",
          last_seen_ms: 1_790_000_000_000,
          online: true,
        },
        {
          device: OFFLINE_PEER,
          label: "Laptop",
          kind: "cli",
          platform: "linux",
          last_seen_ms: 1_789_000_000_000,
          online: false,
        },
      ],
    })
    for (const address of ["Ｓｔｕｄｉｏ mac/dur-8", "studio  mac/dur-8"])
      expect(await client.sessions.resolve(address)).toMatchObject({
        kind: "ok",
        value: { thread: `${PEER}/rk-8`, durable_id: "dur-8" },
      })
  })

  test("#given an account device no other id shares #when the device part is a 6+ character id prefix #then it resolves that device's session", async () => {
    const { client } = await account([listed("gpu-rig-77", "rk-9", "dur-9", "Rig Bot")], {
      devices: [
        {
          device: "gpu-rig-77",
          label: "Rig",
          kind: "desktop",
          platform: "linux",
          last_seen_ms: 1_790_000_000_000,
          online: true,
        },
      ],
    })
    expect(await client.sessions.resolve("gpu-ri/dur-9")).toMatchObject({
      kind: "ok",
      value: { thread: "gpu-rig-77/rk-9", durable_id: "dur-9", device: { id: "gpu-rig-77", name: "Rig" } },
    })
  })

  test("#given a session this device's listing carries #when the device part is here #then it resolves on this device", async () => {
    const { client } = await account([listed("dev-self", "rk-s", "dur-s", "Here Bot")])
    expect(await client.sessions.resolve("here/dur-s")).toMatchObject({
      kind: "ok",
      value: { thread: "dev-self/rk-s", durable_id: "dur-s", device: { id: "dev-self" } },
    })
  })

  test("#given an online device that did not answer the listing round #when nothing else matches #then the miss is host_unavailable naming it, never not_found", async () => {
    const { client } = await account([], { incomplete: [PEER] })
    const failure = failureOf(await client.sessions.resolve("dur-x"))
    expect(failure).toMatchObject({
      code: "host_unavailable",
      details: { reason: "listing_incomplete", devices: [PEER] },
    })
  })

  test("#given another online device that did not answer the round #when a device-qualified address misses on a device that answered #then not_found on that device, never the other's silence", async () => {
    const online = (device: string, label: string) => ({
      device,
      label,
      kind: "desktop",
      platform: "linux",
      last_seen_ms: 1_790_000_000_000,
      online: true,
    })
    const { client } = await account([listed(PEER, "rk-1", "dur-1", "Bot")], {
      devices: [online(PEER, "Peer"), online("dev-quiet", "Quiet")],
      incomplete: ["dev-quiet"],
    })
    expect(failureOf(await client.sessions.resolve(`${PEER}/dur-zz`))).toMatchObject({
      code: "not_found",
      details: { kind: "session" },
    })
  })

  test("#given two rows on one device that both answer a session part #when a device-qualified address names it #then ambiguous_target with both candidates, as a bare address answers", async () => {
    const { client } = await account([listed(PEER, "rk-1", "dur-1", "Bot"), listed(PEER, "dur-1", "dur-9", "Other")])
    const failure = failureOf(await client.sessions.resolve(`${PEER}/dur-1`))
    expect(failure.code).toBe("ambiguous_target")
    expect(failure.details?.["candidates"]).toEqual([
      expect.objectContaining({ thread: `${PEER}/rk-1` }),
      expect.objectContaining({ thread: `${PEER}/dur-1` }),
    ])
  })

  test("#given a device part no device answers to #when it is resolved #then not_found keeps sessions.list's details.id, with device and candidates added beside it", async () => {
    const { client } = await account([listed(PEER, "rk-1", "dur-1", "Bot")])
    expect(failureOf(await client.sessions.resolve("nowhere/dur-1"))).toMatchObject({
      code: "not_found",
      details: { kind: "device", id: "nowhere", device: "nowhere", candidates: expect.any(Array) },
    })
  })

  test("#given a device the roster misses but the listing names (#13402) #when its exact id is the device part #then its session resolves; a device nothing names stays not_found{device}", async () => {
    const { client } = await account([listed(PEER, "rk-1", "dur-1", "Bot")], { devices: [] })
    expect(await client.sessions.resolve(`${PEER}/dur-1`)).toMatchObject({
      kind: "ok",
      value: { thread: `${PEER}/rk-1`, durable_id: "dur-1" },
    })
    expect(failureOf(await client.sessions.resolve("dev-nowhere/dur-1"))).toMatchObject({
      code: "not_found",
      details: { kind: "device", id: "dev-nowhere" },
    })
  })

  test("#given a caller deadline #when a device-qualified address reads the roster and then the listing #then the listing runs under what is left of that one deadline", async () => {
    const clock = fakeClock()
    const deadlines: (number | undefined)[] = []
    const roster = {
      id: PEER,
      name: "Peer",
      platform: "linux",
      online: true,
      last_seen_ms: null,
      caps: { attach: true, machine: false, control: false },
    }
    const unreached = () => Promise.reject(new Error("resolve reads only the roster and the listing"))
    const resolve = resolveMember({
      sender: { kind: "person", uid: "user-1" },
      timers: clock,
      deps: { version: "5.1.70" },
      dial: unreached,
      member: unreached,
      self: () => {
        throw new Error("unreached")
      },
      localSessions: unreached,
      devicesList: async () => {
        clock.advance(600)
        return { kind: "ok", value: [roster] }
      },
      sessionsList: async (_filter, opts) => {
        deadlines.push(opts?.deadlineMs)
        return { kind: "ok", value: { revision: 1, rows: [], unanswered: [] } }
      },
    })
    await resolve(`${PEER}/dur-1`, {}, { deadlineMs: 1_000 })
    expect(deadlines).toEqual([400])
  })
})
