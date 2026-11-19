import { afterEach, describe, expect, test } from "bun:test"
import { resolveAddress, type ResolveOptions } from "."
import { UNKNOWN_CALLER } from "../tools/ports"
import { B, B_TWIN, OFF, T, createTwoDevices, type TwoDeviceOptions } from "./testing/two-devices"

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup()
})

async function resolve(
  text: string,
  opts: ResolveOptions = {},
  setup: TwoDeviceOptions = {},
  context: { readonly callerId?: string; readonly root?: string } = {},
) {
  const two = createTwoDevices(setup)
  cleanups.push(two.cleanup)
  return await resolveAddress(
    {
      remote: two.remote,
      callerWorkspaceRoot: context.root ?? process.cwd(),
      local: two.entries,
      callerId: context.callerId ?? T.hereLive,
    },
    text,
    opts,
  )
}

describe("#given the refusal table of design section 5 #when each condition is met #then its code and details answer", () => {
  test.each([
    ["empty text", "", {}, {}, { code: "invalid_arguments" }],
    ["a control character", "a\u0001b", {}, {}, { code: "invalid_arguments" }],
    [
      "a device part that matches no device",
      "nowhere-device/beta",
      {},
      {},
      { code: "not_found", details: { kind: "device" } },
    ],
    [
      "a device name two online devices carry",
      `${B.name}/beta`,
      {},
      { twin: true },
      { code: "ambiguous_target", details: { kind: "device" } },
    ],
    [
      "an offline device when the caller needs it online",
      `${OFF.name}/${T.nowhere}`,
      { need: "online" },
      {},
      { code: "device_offline", details: { device: OFF.id, device_name: OFF.name, last_seen: null } },
    ],
    [
      "a thread on B while B is offline and the caller needs it online",
      T.bLive,
      { need: "online" },
      { bOffline: true },
      { code: "device_offline", details: { device: B.id, device_name: B.name } },
    ],
    [
      "a relay configured but not connected",
      "no thread is named so",
      {},
      { plan: "offline" },
      { code: "host_unavailable", details: { state: "offline" } },
    ],
    [
      "a name on B while B misses the listing round",
      "beta",
      {},
      { incomplete: true },
      { code: "host_unavailable", details: { reason: "listing_incomplete", devices: [B.id] } },
    ],
    [
      "a device-qualified name on B while B misses the listing round",
      `${B.id}/beta`,
      {},
      { incomplete: true },
      { code: "host_unavailable", details: { reason: "listing_incomplete", devices: [B.id] } },
    ],
    [
      "a name B does not hold, B answered",
      `${B.name}/no such thread`,
      {},
      {},
      { code: "not_found", details: { kind: "thread", device: B.id, device_name: B.name } },
    ],
    [
      "nothing matches and every device answered",
      "no thread is named so",
      {},
      {},
      { code: "not_found", details: { kind: "thread" } },
    ],
    ["a name two threads carry", "shared", {}, {}, { code: "ambiguous_target", details: { kind: "thread" } }],
  ] as const)("%s", async (_label, text, opts, setup, expected) => {
    expect(await resolve(text, opts, setup)).toMatchObject({ kind: "error", ...expected })
  })

  test("#given self #when the caller has no identity #then caller_context_missing", async () => {
    expect(await resolve("self", {}, {}, { callerId: UNKNOWN_CALLER })).toMatchObject({
      kind: "error",
      code: "caller_context_missing",
    })
  })

  test("#given a caller in another workspace #when a name this device holds outside it is resolved #then scope_denied, never not_found", async () => {
    expect(await resolve("alpha", {}, {}, { root: "/nonexistent-workspace-for-scope" })).toMatchObject({
      kind: "error",
      code: "scope_denied",
    })
  })

  test("#given no relay set up #when a name nothing holds is resolved #then it stays this device's plain not_found", async () => {
    expect(await resolve("no thread is named so", {}, { plan: "signed_out" })).toMatchObject({
      kind: "error",
      code: "not_found",
    })
  })

  test("#given B missed the round #when a name misses #then the message names the devices that did not answer and points at thread_list", async () => {
    const resolved = await resolve("no thread is named so", {}, { incomplete: true })
    expect(resolved).toMatchObject({ kind: "error", code: "host_unavailable", details: { devices: [B.id] } })
    if (resolved.kind !== "error") throw new Error("expected a refusal")
    expect(resolved.message).toContain(B.id)
    expect(resolved.next_action).toContain("thread_list")
  })

  test("#given B answered one round and missed the next #when its thread is resolved by id #then the remembered device is named", async () => {
    const two = createTwoDevices({ dropsAfterFirstRound: true })
    cleanups.push(two.cleanup)
    const context = { remote: two.remote, callerWorkspaceRoot: process.cwd(), local: two.entries, callerId: T.hereLive }
    expect(await resolveAddress(context, T.bLive, {})).toMatchObject({ kind: "ok", thread: T.bLive })
    expect(await resolveAddress(context, T.bLive, {})).toMatchObject({
      kind: "error",
      code: "host_unavailable",
      details: { reason: "listing_incomplete", devices: [B.id] },
    })
  })

  test("#given two online devices named alike #when the name is the device part #then both are candidates with their ids", async () => {
    const resolved = await resolve(`${B.name}/beta`, {}, { twin: true })
    const details = resolved.kind === "error" ? resolved.details : undefined
    const candidates = (details?.["candidates"] ?? []) as readonly { readonly device: string }[]
    expect(candidates.map((row) => row.device).sort()).toEqual([B.id, B_TWIN.id].sort())
  })
})

describe("#given a thread id nothing lists #when the per-device probe runs #then its answer decides", () => {
  test("#given B holds the id on disk #when probed #then B answers it", async () => {
    expect(await resolve(T.bProbe, { probe: true }, { probe: true })).toMatchObject({
      kind: "ok",
      thread: T.bProbe,
      resolution: "probe",
      where: { kind: "device", row: { device: B.id, state: "ended" } },
    })
  })

  test("#given B does not answer the probe #when probed #then host_unavailable device_unanswered names B", async () => {
    expect(await resolve(T.nowhere, { probe: true }, { probe: true, silent: [B.id] })).toMatchObject({
      kind: "error",
      code: "host_unavailable",
      details: { reason: "device_unanswered", devices: [B.id] },
    })
  })

  test("#given B misses the listing round but every device answers the probe with none #when probed #then not_found stands", async () => {
    expect(await resolve(T.nowhere, { probe: true }, { probe: true, incomplete: true })).toMatchObject({
      kind: "error",
      code: "not_found",
    })
  })
})

describe("#given an approved reply pinned to its sender's device #when it resolves #then only that device is asked", () => {
  test.each([
    ["the sender listed on B", { device: B.id, thread: T.bLive }, {}, { kind: "ok", thread: T.bLive }],
    [
      "the sender held on B's disk",
      { device: B.id, thread: T.bProbe },
      { probe: true },
      { kind: "ok", thread: T.bProbe },
    ],
    [
      "B silent on the probe",
      { device: B.id, thread: T.nowhere },
      { probe: true, silent: [B.id] },
      { kind: "error", code: "host_unavailable", details: { reason: "device_unanswered", devices: [B.id] } },
    ],
    [
      "B answered and holds no such thread",
      { device: B.id, thread: T.nowhere },
      { probe: true },
      { kind: "error", code: "not_found", details: { kind: "thread", device: B.id, device_name: B.name } },
    ],
    [
      "B cannot be asked (no probe)",
      { device: B.id, thread: T.nowhere },
      {},
      { kind: "error", code: "host_unavailable", details: { reason: "probe_unavailable", device: B.id } },
    ],
  ] as const)("%s", async (_label, pin, setup, expected) => {
    expect(await resolve(pin.thread, { pin }, setup)).toMatchObject(expected)
  })
})
