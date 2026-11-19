import { afterEach, describe, expect, test } from "bun:test"
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

  test("#given B lists no row for an id #when <device>/<thread id> names it #then B itself is asked for it, not the listing (a session opened a moment ago)", async () => {
    const resolved = await resolve(`${B.id}/${T.nowhere}`)
    expect(resolved).toMatchObject({
      kind: "ok",
      thread: T.nowhere,
      where: { kind: "device", row: { device: B.id, durable_id: T.nowhere } },
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
