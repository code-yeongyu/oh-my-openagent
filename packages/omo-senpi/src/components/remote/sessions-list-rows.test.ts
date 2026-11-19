import { afterEach, describe, expect, test } from "bun:test"
import type { ListingRow } from "../../../../device-service-core/src/local-api/protocol.ts"
import { defaultWorld, PEER, type World } from "../../../../device-service-core/test/local-api/conformance/world.ts"
import type { ThreadHost, ThreadHostSession } from "../thread/tools/ports"
import { createLocalSessions } from "./local-sessions"
import { clientOn, closeClients, failureOf, fakeClock, startOwner } from "./testing/fake-service"
import type { SessionRow } from "./types"

// #14305 U6 (design section 6): sessions.list builds its rows the way thread_list does - this device's rows from its own
// endpoint, one row per thread id, one naming function on both legs - and resolves --device inside its one call.

afterEach(closeClients)

const SELF = "dev-self"

const listed = (world: World, extra: readonly ListingRow[]): World => ({
  ...world,
  listing: {
    ...world.listing,
    revisions: world.listing.revisions.map((revision) => ({ ...revision, rows: [...revision.rows, ...extra] })),
  },
})

const unused = async (): Promise<never> => {
  throw new Error("not used by a listing")
}
const hostOf = (sessions: readonly ThreadHostSession[]): ThreadHost => ({
  socket: "fake.sock",
  listSessions: async () => sessions,
  openSession: unused,
  getMessages: unused,
  getState: unused,
  prompt: unused,
  interrupt: unused,
  setSessionName: unused,
  setModel: unused,
  getAvailableModels: unused,
  setThinkingLevel: unused,
  getAvailableThinkingLevels: unused,
})

const listOn = async (world: World, sessions: readonly ThreadHostSession[]) => {
  const owner = await startOwner(world)
  return clientOn(owner.stateDir, fakeClock(), undefined, {
    localSessions: async () => createLocalSessions(async () => hostOf(sessions)),
  })
}

const rowsOf = async (outcome: Promise<{ kind: "ok"; value: { rows: readonly SessionRow[] } } | { kind: "error" }>) => {
  const settled = await outcome
  if (settled.kind !== "ok") throw new Error(`expected rows, got ${JSON.stringify(settled)}`)
  return settled.value.rows
}

const serviceRow = (device: string, durable: string, title: string): ListingRow => ({
  device,
  session_id: `rk-${durable}`,
  durable_id: durable,
  title,
  project: "omo",
  path: "/home/user/omo",
  state: "idle",
  updated_ms: 1_790_000_000_000,
  source: "live",
  as_of: 1_790_000_100_000,
})

describe("sessions.list rows (#14305 U6)", () => {
  test("#given the listing also carries a copy of this device's thread #when sessions.list runs #then the thread is one row, from this device's own endpoint", async () => {
    const client = await listOn(listed(defaultWorld(), [serviceRow(SELF, "dur-here", "service copy")]), [
      { sessionId: "rpc-1", durableSessionId: "dur-here", cwd: "/w/here", name: "own name" },
    ])
    const rows = (await rowsOf(client.sessions.list())).filter((row) => row.durable_id === "dur-here")
    expect(rows.map((row) => row.name)).toEqual(["own name"])
  })

  test("#given a session with no name on each leg #when sessions.list runs #then both show the same kind of fallback and say unnamed, and a name filter never matches the fallback", async () => {
    const client = await listOn(listed(defaultWorld(), [serviceRow(PEER, "dur-peer-anon", "")]), [
      { sessionId: "rpc-1", durableSessionId: "dur-here-anon", cwd: "/w/proj" },
    ])
    const rows = await rowsOf(client.sessions.list())
    const anon = rows.filter((row) => row.durable_id === "dur-peer-anon" || row.durable_id === "dur-here-anon")
    expect(anon.map((row) => [row.durable_id, row.name, row.unnamed]).sort()).toEqual([
      ["dur-here-anon", "proj", true],
      ["dur-peer-anon", "omo", true],
    ])
    expect(rows.find((row) => row.name === "Live session")?.unnamed).toBeUndefined()
    expect(await rowsOf(client.sessions.list({ name: "omo" }))).toEqual([])
  })
})

describe("sessions.list --device by name (#14305 U6)", () => {
  test("#given two online devices sharing a name #when sessions.list filters by that name #then it answers ambiguous_target with both devices as candidates", async () => {
    const world = defaultWorld()
    const twin = {
      device: "dev-peer-3",
      label: "Studio",
      kind: "desktop" as const,
      platform: "linux" as const,
      last_seen_ms: 1_790_000_000_000,
      online: true,
    }
    const client = await listOn({ ...world, devices: [...world.devices, twin] }, [])
    const failure = failureOf(await client.sessions.list({ device: "Studio" }))
    expect(failure.code).toBe("ambiguous_target")
    const candidates = (failure.details?.["candidates"] ?? []) as readonly { readonly device: string }[]
    expect(candidates.map((candidate) => candidate.device).sort()).toEqual([PEER, "dev-peer-3"])
  })

  test("#given here as the device #when sessions.list filters by it #then it lists this device's own rows only", async () => {
    const client = await listOn(defaultWorld(), [
      { sessionId: "rpc-1", durableSessionId: "dur-here", cwd: "/w/here", name: "own" },
    ])
    const rows = await rowsOf(client.sessions.list({ device: "here" }))
    expect(rows.map((row) => [row.device.id, row.durable_id])).toEqual([[SELF, "dur-here"]])
  })
})
