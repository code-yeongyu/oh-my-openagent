import { afterEach, describe, expect, test } from "bun:test"
import { createRemoteThreadFixture } from "../thread-remote-fixture"
import type { RemoteSessionRow } from "../remote/ports"
import type { ThreadAddressEntry } from "../addressing"
import { resolveAddress, type AddressCandidate, type Resolution, type ResolveOptions } from "."
import {
  ALIAS,
  B,
  FIX,
  HERE,
  KEY,
  NAMES,
  ROUTE,
  T,
  createTwoDevices,
  type TwoDeviceOptions,
} from "./testing/two-devices"

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup()
})

async function resolve(text: string, opts: ResolveOptions = {}, setup: TwoDeviceOptions = {}, callerId = T.hereLive) {
  const two = createTwoDevices(setup)
  cleanups.push(two.cleanup)
  return await resolveAddress(
    { remote: two.remote, callerWorkspaceRoot: process.cwd(), local: two.entries, callerId },
    text,
    opts,
  )
}

type Hit = {
  readonly thread: string
  readonly where: "here" | "device"
  readonly device?: string
  readonly resolution: Resolution
}

const hit = (thread: string, where: "here" | "device", resolution: Resolution, device?: string): Hit => ({
  thread,
  where,
  resolution,
  ...(device === undefined ? {} : { device }),
})

async function expectHit(text: string, expected: Hit, opts: ResolveOptions = {}, setup: TwoDeviceOptions = {}) {
  const resolved = await resolve(text, opts, setup)
  if (resolved.kind !== "ok") throw new Error(`${text}: ${resolved.code} ${resolved.message}`)
  expect({
    thread: resolved.thread,
    where: resolved.where.kind,
    resolution: resolved.resolution,
    ...(expected.device === undefined ? {} : { device: resolved.device?.id }),
  }).toEqual(expected)
  if (resolved.device !== null) expect(resolved.address).toBe(`${resolved.device.id}/${resolved.thread}`)
}

describe("#given two devices of one account #when every input form names a thread on this device or on B #then resolveAddress answers the same thread", () => {
  test.each([
    ["the exact thread id here", T.hereLive, hit(T.hereLive, "here", "id")],
    ["the exact thread id on B", T.bLive, hit(T.bLive, "device", "id", B.id)],
    ["a routing id here", ROUTE.hereLive, hit(T.hereLive, "here", "session_id")],
    ["a listing key on B", KEY.bLive, hit(T.bLive, "device", "session_id", B.id)],
    ["an alias held here", ALIAS.here, hit(T.hereLive, "here", "alias")],
    ["an alias held on B", ALIAS.onB, hit(T.bLive, "device", "alias", B.id)],
    ["a name here", NAMES.hereLive, hit(T.hereLive, "here", "name")],
    ["a name on B", NAMES.bLive, hit(T.bLive, "device", "name", B.id)],
    ["an 8-hex id prefix here", T.hereLive.slice(0, 8), hit(T.hereLive, "here", "id_prefix")],
    ["an 8-hex id prefix on B", T.bLive.slice(0, 8), hit(T.bLive, "device", "id_prefix", B.id)],
    ["self", "self", hit(T.hereLive, "here", "self")],
    ["<device id>/<thread id> on B", `${B.id}/${T.bLive}`, hit(T.bLive, "device", "id", B.id)],
    [
      "<device name>/<thread name> on B, NFKC and spacing folded",
      "studio   LAPTOP/beta",
      hit(T.bLive, "device", "name", B.id),
    ],
    [
      "<device id prefix>/<thread id prefix> on B",
      `${B.id.slice(0, 6)}/${T.bLive.slice(0, 8)}`,
      hit(T.bLive, "device", "id_prefix", B.id),
    ],
    ["<device>/<listing key> on B", `${B.id}/${KEY.bLive}`, hit(T.bLive, "device", "session_id", B.id)],
    ["<device>/<alias> on B", `${B.name}/${ALIAS.onB}`, hit(T.bLive, "device", "alias", B.id)],
    ["here/<thread id>", `here/${T.hereLive}`, hit(T.hereLive, "here", "id", HERE.id)],
    ["<this device's name>/<thread name>", `${HERE.name}/${NAMES.hereLive}`, hit(T.hereLive, "here", "name", HERE.id)],
    ["here/<routing id>", `here/${ROUTE.hereLive}`, hit(T.hereLive, "here", "session_id", HERE.id)],
  ])("%s", async (_label, text, expected) => {
    await expectHit(text, expected)
  })

  test("#given B lists no row for an id it holds #when <device>/<thread id> names it #then B itself is asked for it and answers (a session no listing shows yet)", async () => {
    const resolved = await resolve(`${B.id}/${T.bProbe}`, {}, { probe: true })
    expect(resolved).toMatchObject({
      kind: "ok",
      thread: T.bProbe,
      where: { kind: "device", row: { device: B.id, durable_id: T.bProbe } },
    })
  })

  test("#given an ended thread on B #when it is named by id #then it resolves to B's ended row", async () => {
    expect(await resolve(T.bEnded)).toMatchObject({ kind: "ok", where: { kind: "device", row: { state: "ended" } } })
  })

  test("#given an id resolved on B #when the result is read #then its address resolves as written to the same thread", async () => {
    const first = await resolve(NAMES.bLive)
    if (first.kind !== "ok") throw new Error(first.code)
    expect(await resolve(first.address)).toMatchObject({
      kind: "ok",
      thread: T.bLive,
      device: { id: B.id, name: B.name },
    })
  })
})

describe("#given a thread name that contains a slash #when it is resolved #then the device reading is taken only when its first part is a device", () => {
  test("#given no device named fix #when fix/login is resolved #then the thread named fix/login answers", async () => {
    await expectHit(NAMES.slash, hit(T.hereSlash, "here", "name"))
  })

  test("#given a device named fix holding a thread named login #when fix/login is resolved #then both readings resolve, to different threads, so it is ambiguous_target naming both", async () => {
    const resolved = await resolve(NAMES.slash, {}, { fix: true })
    expect(resolved).toMatchObject({ kind: "error", code: "ambiguous_target" })
    const candidates = (
      resolved.kind === "error" ? (resolved.details?.["candidates"] ?? []) : []
    ) as readonly AddressCandidate[]
    expect(candidates.map((candidate) => candidate.thread).sort()).toEqual([T.fixLogin, T.hereSlash].sort())
  })

  test("#given a device named fix #when fix/<an id it does not hold> misses there #then the whole text is resolved as a bare address before the device refusal", async () => {
    expect(await resolve(`${FIX.name}/nothing-named-so`, {}, { fix: true })).toMatchObject({
      kind: "error",
      code: "not_found",
      details: { kind: "thread", device: FIX.id, device_name: FIX.name },
    })
  })
})

describe("#given the same name on this device and on B #when it is resolved #then it is ambiguous_target with one candidate per device, each with a pasteable address", () => {
  test("#given the shared name #when resolved #then both candidates carry address, device and device_name", async () => {
    const resolved = await resolve(NAMES.shared)
    expect(resolved).toMatchObject({ kind: "error", code: "ambiguous_target", details: { kind: "thread" } })
    const candidates = (
      resolved.kind === "error" ? (resolved.details?.["candidates"] ?? []) : []
    ) as readonly AddressCandidate[]
    expect(candidates.map((candidate) => [candidate.thread, candidate.device_name])).toEqual(
      expect.arrayContaining([
        [T.hereShared, HERE.name],
        [T.bShared, B.name],
      ]),
    )
    for (const candidate of candidates) {
      expect(candidate.address).toBe(`${candidate.device}/${candidate.thread}`)
      expect(await resolve(candidate.address ?? "")).toMatchObject({ kind: "ok", thread: candidate.thread })
    }
  })

  test("#given the shared name #when it is qualified by B's name #then only B's threads are searched", async () => {
    await expectHit(`${B.name}/${NAMES.shared}`, hit(T.bShared, "device", "name", B.id))
  })
})

describe("characterization of current behaviour: a closed copy of an id here while B lists it live", () => {
  test("#given the closed copy here and B's live row #when the id is resolved #then this device's id hit answers, as resolveAcross does today", async () => {
    await expectHit(T.stale, hit(T.stale, "here", "id"))
  })

  test("#given a thread only this device holds, not live #when resolved #then this device's copy answers", async () => {
    await expectHit(T.hereEnded, hit(T.hereEnded, "here", "id"))
  })
})

describe("#given unique_holder (#14048: a sender whose delivery names no device) #when the resolved id is listed by one or several devices #then only one holder resolves", () => {
  test("#given one device lists the id #when it is resolved with unique_holder #then it resolves there", async () => {
    await expectHit(T.bLive, hit(T.bLive, "device", "id", B.id), { unique_holder: true, id_prefix: false })
  })

  test("#given a copy here and B's row #when the id is resolved with unique_holder #then ambiguous_target names this device and B", async () => {
    const resolved = await resolve(T.stale, { unique_holder: true, id_prefix: false })
    expect(resolved).toMatchObject({ kind: "error", code: "ambiguous_target" })
    const candidates = (
      resolved.kind === "error" ? (resolved.details?.["candidates"] ?? []) : []
    ) as readonly AddressCandidate[]
    expect(candidates.map((candidate) => candidate.device).sort()).toEqual([B.id, HERE.id].sort())
  })

  const C = { id: "c3d4e5f60718293a", name: "garage" } as const
  const onDevice = (device: string, key: string): RemoteSessionRow => ({
    device,
    session_id: key,
    durable_id: T.nowhere,
    title: "copy",
    project: "/work",
    path: "/work",
    state: "idle",
    updated_ms: 1,
  })
  test.each([
    ["B, then C", [onDevice(B.id, "rk-b"), onDevice(C.id, "rk-c")]],
    ["C, then B", [onDevice(C.id, "rk-c"), onDevice(B.id, "rk-b")]],
  ] as const)(
    "#given B and C both list the id (listing order %s) #when it is resolved with unique_holder #then ambiguous_target names both, one candidate each",
    async (_order, rows) => {
      const fixture = createRemoteThreadFixture()
      cleanups.push(fixture.cleanup)
      const account = fixture.account({
        rows,
        devices: [
          { device: B.id, label: B.name, online: true },
          { device: C.id, label: C.name, online: true },
        ],
      })
      const resolved = await resolveAddress(
        { remote: account.remote, callerWorkspaceRoot: process.cwd(), local: [], callerId: T.hereLive },
        T.nowhere,
        { unique_holder: true, id_prefix: false },
      )
      expect(resolved).toMatchObject({ kind: "error", code: "ambiguous_target" })
      const candidates = (
        resolved.kind === "error" ? (resolved.details?.["candidates"] ?? []) : []
      ) as readonly AddressCandidate[]
      expect(candidates.map((candidate) => candidate.address).sort()).toEqual(
        [`${B.id}/${T.nowhere}`, `${C.id}/${T.nowhere}`].sort(),
      )
    },
  )
})

describe("#given a device-qualified session part B has not listed #when it is resolved #then a routing id or listing key passes through to B and anything else is not_found (#13748)", () => {
  const KEY22 = "AbCdEfGhIjKlMnOpQrStUv"
  test.each([
    ["an unlisted 22-character listing key", KEY22, KEY22],
    ["an unlisted routing id", "rpc-7", "rpc-7"],
  ])("#given %s #when <B>/<it> is resolved #then it passes through to B unresolved", async (_label, part, key) => {
    const resolved = await resolve(`${B.id}/${part}`)
    expect(resolved).toMatchObject({
      kind: "ok",
      address: `${B.id}/${part}`,
      where: { kind: "device", row: { device: B.id, session_id: key } },
    })
  })

  test.each(["no such thread", "release-planner-2"])(
    "#given a name B does not list (%s) #when <B>/<it> is resolved #then not_found on B, nothing passed through",
    async (part) => {
      expect(await resolve(`${B.name}/${part}`)).toMatchObject({
        kind: "error",
        code: "not_found",
        details: { kind: "thread", device: B.id },
      })
    },
  )
})

describe("#given a session file this device's book shows only when asked for it by name or id #when <this device>/<thread> names it #then the book is asked for the thread part (#14305 review M2)", () => {
  // The send address book adds the session files an address names; asked with the whole "<device>/<thread>" text it
  // finds none, so the resolver asks with the thread part once the device part resolved to this device.
  async function resolveFile(text: string) {
    const two = createTwoDevices()
    cleanups.push(two.cleanup)
    const visible = two.entries.filter((entry) => entry.thread_id !== T.hereEnded)
    const file = two.entries.filter((entry) => entry.thread_id === T.hereEnded)
    return await resolveAddress(
      {
        remote: two.remote,
        callerWorkspaceRoot: process.cwd(),
        local: visible,
        localFor: (part) => (part === T.hereEnded ? [...visible, ...file] : visible),
        callerId: T.hereLive,
      },
      text,
    )
  }
  test.each([
    ["here", "here"],
    ["this device's id", HERE.id],
    ["this device's name", HERE.name],
  ])("#given <%s>/<the file's id> #when resolved #then the file answers", async (_form, device) => {
    expect(await resolveFile(`${device}/${T.hereEnded}`)).toMatchObject({
      kind: "ok",
      thread: T.hereEnded,
      where: { kind: "here" },
    })
  })
})

describe("#given <device>/<id-shaped thread> #when it resolves #then it reads at most that one device, never the account-wide listing round (#12709)", () => {
  async function counted(text: string, setup: TwoDeviceOptions = {}, extraLocal: readonly ThreadAddressEntry[] = []) {
    const two = createTwoDevices(setup)
    cleanups.push(two.cleanup)
    let unfiltered = 0
    let statuses = 0
    const sessions = two.remote.sessions
    const listing = sessions.listing
    const remote = {
      ...two.remote,
      client: {
        ...two.remote.client,
        service: {
          ...two.remote.client.service,
          status: async (...args: Parameters<typeof two.remote.client.service.status>) => {
            statuses += 1
            return await two.remote.client.service.status(...args)
          },
        },
      },
      sessions: {
        ...sessions,
        sessions: async (filter?: { readonly device?: string }) => {
          if (filter?.device === undefined) unfiltered += 1
          return await sessions.sessions(filter)
        },
        ...(listing === undefined
          ? {}
          : {
              listing: async (filter?: { readonly device?: string }) => {
                if (filter?.device === undefined) unfiltered += 1
                return await listing(filter)
              },
            }),
      },
    }
    const resolved = await resolveAddress(
      { remote, callerWorkspaceRoot: process.cwd(), local: [...two.entries, ...extraLocal], callerId: T.hereLive },
      text,
      { probe: true },
    )
    return { resolved, unfiltered, statuses }
  }
  test.each([
    ["<device id>/<thread id>", `${B.id}/${T.bLive}`],
    ["<device name>/<thread id>", `${B.name}/${T.bLive}`],
    ["<device>/<22-character key B has not listed>", `${B.id}/AbCdEfGhIjKlMnOpQrStUv`],
  ])("#given %s #when resolved #then no unfiltered listing is read and status once", async (_form, text) => {
    const { resolved, unfiltered, statuses } = await counted(text)
    expect(resolved).toMatchObject({ kind: "ok", where: { kind: "device", row: { device: B.id } } })
    expect({ unfiltered, statuses }).toEqual({ unfiltered: 0, statuses: 1 })
  })

  test("#given <device name>/<thread name> that B holds #when resolved #then only B's listing is read and the whole text is checked against this device's book alone", async () => {
    const { resolved, unfiltered, statuses } = await counted(`${B.name}/${NAMES.bLive}`)
    expect(resolved).toMatchObject({ kind: "ok", thread: T.bLive, where: { kind: "device" } })
    expect({ unfiltered, statuses }).toEqual({ unfiltered: 0, statuses: 1 })
  })

  test("#given <device name>/<a name B does not hold> #when resolved #then the whole text is read once account-wide before not_found", async () => {
    const { resolved, unfiltered } = await counted(`${B.name}/no such thread`)
    expect(resolved).toMatchObject({ kind: "error", code: "not_found" })
    expect(unfiltered).toBe(1)
  })

  test.each([
    ["here/<name>", `here/${NAMES.hereLive}`],
    ["<this device's id>/<name>", `${HERE.id}/${NAMES.hereLive}`],
  ])("#given %s #when resolved #then this device's book answers with no account-wide read", async (_form, text) => {
    const { resolved, unfiltered } = await counted(text)
    expect(resolved).toMatchObject({ kind: "ok", thread: T.hereLive, where: { kind: "here" } })
    expect(unfiltered).toBe(0)
  })

  test("#given <device>/<a thread id B does not hold> #when resolved #then B's answer stands, with no whole-text reading and no account-wide read", async () => {
    const { resolved, unfiltered } = await counted(`${B.id}/${T.nowhere}`)
    expect(resolved).toMatchObject({ kind: "error", details: { device: B.id } })
    expect(unfiltered).toBe(0)
  })

  test("#given a thread here literally named <device name>/<name> that B does not hold #when resolved #then the whole text resolves to it, after one account-wide read", async () => {
    const named: ThreadAddressEntry = {
      thread_id: "0aa00009-0000-4000-8000-000000000009",
      name: `${B.name}/notes`,
      status: "live",
      cwd: process.cwd(),
      created_at: "2026-11-01T00:00:00Z",
      updated_at: null,
    }
    const { resolved, unfiltered } = await counted(`${B.name}/notes`, {}, [named])
    expect(resolved).toMatchObject({ kind: "ok", thread: named.thread_id, where: { kind: "here" } })
    expect(unfiltered).toBe(1)
  })

  test("#given a device named fix holding login and a thread here named fix/login #when fix/login is resolved #then ambiguous_target from this device's book, with no account-wide read", async () => {
    const { resolved, unfiltered } = await counted(NAMES.slash, { fix: true })
    expect(resolved).toMatchObject({ kind: "error", code: "ambiguous_target" })
    expect(unfiltered).toBe(0)
  })

  test("#given a bare thread id on B #when resolved #then the account-wide listing is read at most once, status once", async () => {
    const { resolved, unfiltered, statuses } = await counted(T.bLive)
    expect(resolved).toMatchObject({ kind: "ok", thread: T.bLive })
    expect(unfiltered).toBeLessThanOrEqual(1)
    expect(statuses).toBe(1)
  })
})

describe("#given a listing row on B that publishes no thread id #when it is addressed by its listing key #then it resolves, and its address is <device id>/<listing key>", () => {
  const KEYLESS = "c2Vzc2lvbi1rZXktMDAwMQ"
  const keyless: RemoteSessionRow = {
    device: B.id,
    session_id: KEYLESS,
    title: "keyless",
    project: "/work/b",
    path: "/work/b",
    state: "idle",
    updated_ms: 1,
  }
  function account() {
    const fixture = createRemoteThreadFixture()
    cleanups.push(fixture.cleanup)
    return {
      fixture,
      account: fixture.account({
        rows: [keyless],
        devices: [{ device: B.id, label: B.name, online: true }],
        live: [KEYLESS],
      }),
    }
  }
  test.each([
    ["<device id>/<key>", `${B.id}/${KEYLESS}`],
    ["<device name>/<key>", `${B.name}/${KEYLESS}`],
    ["the bare key", KEYLESS],
  ])("#given %s #when resolved #then the keyless row answers", async (_form, text) => {
    const { account: a } = account()
    const resolved = await resolveAddress(
      { remote: a.remote, callerWorkspaceRoot: process.cwd(), local: [], callerId: T.hereLive },
      text,
    )
    expect(resolved).toMatchObject({
      kind: "ok",
      address: `${B.id}/${KEYLESS}`,
      where: { kind: "device", row: { device: B.id, session_id: KEYLESS, title: "keyless" } },
    })
  })

  test("#given the keyless row #when thread_read names it as <device>/<key> #then B's session is read", async () => {
    const { fixture, account: a } = account()
    const { run } = fixture.surface(a.remote)
    expect(await run("thread_read", { thread: `${B.id}/${KEYLESS}` })).toMatchObject({ kind: "ok", device: B.id })
  })
})
