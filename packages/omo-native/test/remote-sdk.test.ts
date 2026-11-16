import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { cleanup, startOwner } from "../../device-service-core/test/local-api/support.ts"
import {
  defaultWorld,
  OFFLINE_PEER,
  PEER,
  type World,
} from "../../device-service-core/test/local-api/conformance/world.ts"
import { withContractHost } from "../../senpi-task/src/runners/rpc-host/testing/contract-host.ts"
import {
  canonicalizeThreadHandle,
  describeThread,
  handleOf,
  openRemote,
  REMOTE_CODES,
  type Remote,
  type RemoteFailure,
} from "omo-ai/remote"

// omo#13413: the importable remote SDK. A program imports `omo-ai/remote` by its package name and drives devices and
// sessions through the one remote module (design v8-core r2, as amended by Q's W3 ruling: the SDK is that module
// exported). Every member settles with data: `{ kind: "ok", value }` or a typed RemoteFailure, never a throw.

const opened: Remote[] = []
const dirs: string[] = []
afterEach(async () => {
  for (const remote of opened.splice(0)) remote.close()
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
  await cleanup()
})

const open = (stateDir: string): Remote => {
  const remote = openRemote({ stateDir })
  opened.push(remote)
  return remote
}

const valueOf = async <T>(outcome: Promise<{ readonly kind: "ok"; readonly value: T } | RemoteFailure>): Promise<T> => {
  const settled = await outcome
  if (settled.kind !== "ok") throw new Error(`expected a value, got ${JSON.stringify(settled)}`)
  return settled.value
}

const failureOf = async (outcome: Promise<{ readonly kind: "ok" } | RemoteFailure>): Promise<RemoteFailure> => {
  const settled = await outcome
  if (settled.kind !== "error") throw new Error(`expected a failure, got ${JSON.stringify(settled)}`)
  return settled
}

describe("omo-ai/remote: devices", () => {
  test("#given a signed-in device service #when a script lists devices #then it gets this device and its peers, online as a device property", async () => {
    const remote = open((await startOwner()).stateDir)

    const devices = await valueOf(remote.devices.list())

    expect(devices.find((row) => row.self === true)).toBeDefined()
    expect(devices.find((row) => row.id === PEER)).toMatchObject({ online: true })
    expect(devices.find((row) => row.id === OFFLINE_PEER)).toMatchObject({ online: false })
  })

  test("#given no device service on this machine #when a script lists devices #then it gets the local self row, not a failure", async () => {
    const empty = mkdtempSync(join(tmpdir(), "omo-remote-sdk-"))
    dirs.push(empty)

    const devices = await valueOf(open(empty).devices.list())

    expect(devices).toEqual([expect.objectContaining({ id: "local", self: true, online: true })])
  })

  test("#given a device name nobody has #when a script resolves it #then the failure is typed: a known code and a next action", async () => {
    const remote = open((await startOwner()).stateDir)

    const failure = await failureOf(remote.devices.resolve("no-such-device"))

    expect(REMOTE_CODES).toContain(failure.code)
    expect(failure.next_action.length).toBeGreaterThan(0)
  })
})

describe("omo-ai/remote: sessions", () => {
  test("#given devices with sessions #when a script lists sessions #then it gets ONE merged list whose handles name their device and round-trip through the exported seams", async () => {
    const remote = open((await startOwner()).stateDir)

    const list = await valueOf(remote.sessions.list({ all_scope: true }))

    expect(list.rows.length).toBeGreaterThan(0)
    for (const row of list.rows) {
      const parsed = canonicalizeThreadHandle(String(row.thread), { all_scope: true })
      if (parsed.kind !== "ok" || parsed.value.target.kind !== "device_session")
        throw new Error(`unparsed ${row.thread}`)
      expect(parsed.value.target.device).toBe(row.device.id)
      expect(handleOf(row.device.id, parsed.value.target.session)).toBe(row.thread)
      expect(describeThread(row).length).toBeGreaterThan(0)
    }
  })

  test("#given the SDK #when a script reaches for the session verbs #then create, send, read, watch, interrupt, close and archive are all members", () => {
    const empty = mkdtempSync(join(tmpdir(), "omo-remote-sdk-"))
    dirs.push(empty)
    const remote = open(empty)

    expect(Object.keys(remote.sessions).sort()).toEqual(
      expect.arrayContaining(["archive", "close", "follow", "get", "interrupt", "list", "open", "read", "send"]),
    )
  })
})

// The device service cannot attach a device to itself, so a session on the script's own device is reached through this
// device's engine (its operator endpoint, found as the thread tools find it). openRemote must wire that in by default:
// without it, watching or attaching to a session the same script just opened here fails (#13868).
describe("omo-ai/remote: a session on this device", () => {
  const SELF = "dev-self"
  const SESSION = "c2VsZi1zZXNzaW9uLWtleQ"
  const ENV = ["OMO_RPC_SOCKET", "SENPI_RPC_KEY_ROOT"] as const
  const saved = ENV.map((name) => [name, process.env[name]] as const)
  afterEach(() => {
    for (const [name, value] of saved) {
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
    }
  })

  const selfWorld = (): World => {
    const world = defaultWorld()
    const [revision] = world.listing.revisions.slice(-1)
    if (revision === undefined) throw new Error("the default world has a listing")
    const row = {
      device: SELF,
      session_id: SESSION,
      durable_id: "dur-selected",
      title: "Self session",
      project: "omo",
      path: "/home/user/omo",
      state: "running" as const,
      updated_ms: 1_790_000_000_000,
      source: "live" as const,
      as_of: 1_790_000_100_000,
    }
    const revisions = [...world.listing.revisions.slice(0, -1), { ...revision, rows: [...revision.rows, row] }]
    return { ...world, listing: { ...world.listing, revisions } }
  }

  test("#given a session on this device's own engine #when a script attaches to it #then the snapshot comes from that engine's operator endpoint", async () => {
    const owner = await startOwner(selfWorld())
    await withContractHost({}, async (host) => {
      process.env["OMO_RPC_SOCKET"] = host.socket
      process.env["SENPI_RPC_KEY_ROOT"] = host.root
      const remote = open(owner.stateDir)

      const attached = await valueOf(remote.attach(handleOf(SELF, SESSION)))

      expect(attached.snapshot.state).toMatchObject({ sessionId: "rpc-1" })
      await attached.detach()
      expect(host.frames.map(({ frame }) => frame["type"])).toContain("release_attachment")
    })
  })
})
