import { afterEach, describe, expect, test } from "bun:test"
import { resolveAddress, type ResolveOptions } from "."
import { UNKNOWN_CALLER } from "../tools/ports"
import { B, B_TWIN, OFF, QUIET, T, createTwoDevices, type TwoDeviceOptions } from "./testing/two-devices"

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
      { code: "device_offline", details: { device: OFF.id, device_name: OFF.name, last_seen: OFF.last_seen_ms } },
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

  test("#given B listed a thread in round 1 and B and a third device both miss round 2 #when ids are resolved #then the remembered device alone is named for that thread, both for an id never listed (#14172)", async () => {
    const two = createTwoDevices({ dropsAfterFirstRound: true, quietThird: true })
    cleanups.push(two.cleanup)
    const context = { remote: two.remote, callerWorkspaceRoot: process.cwd(), local: two.entries, callerId: T.hereLive }
    expect(await resolveAddress(context, T.bLive, {})).toMatchObject({ kind: "ok", thread: T.bLive })
    expect(await resolveAddress(context, T.bLive, {})).toMatchObject({
      kind: "error",
      code: "host_unavailable",
      details: { reason: "listing_incomplete", devices: [B.id] },
    })
    const never = await resolveAddress(context, T.nowhere, {})
    expect(never).toMatchObject({ kind: "error", code: "host_unavailable", details: { reason: "listing_incomplete" } })
    const devices = never.kind === "error" ? (never.details?.["devices"] as readonly string[] | undefined) : undefined
    expect([...(devices ?? [])].sort()).toEqual([B.id, QUIET.id].sort())
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
      // #14280: a silent probe keeps the service's own reason.
      { kind: "error", code: "host_unavailable", details: { reason: "host_not_answering", devices: [B.id] } },
    ],
    [
      "B answered and holds no such thread",
      { device: B.id, thread: T.nowhere },
      { probe: true },
      { kind: "error", code: "not_found", details: { kind: "thread", device: B.id, device_name: B.name } },
    ],
    [
      "B cannot be asked (this device's service carries no wake, so no probe)",
      { device: B.id, thread: T.nowhere },
      {},
      {
        kind: "error",
        code: "host_unavailable",
        details: { reason: "wake_unavailable", device: B.id, thread: T.nowhere },
      },
    ],
  ] as const)("%s", async (_label, pin, setup, expected) => {
    expect(await resolve(pin.thread, { pin }, setup)).toMatchObject(expected)
  })
})

describe("#given <device>/<thread id> on B that B's listing does not show #when it resolves #then B itself is asked, as a pinned reply asks it (#14305 review H1)", () => {
  test.each([
    [
      "B holds it on disk (its probe finds it)",
      { probe: true },
      { kind: "ok", thread: T.bProbe, where: { kind: "device", row: { device: B.id } } },
      T.bProbe,
    ],
    [
      "B answered and holds no such thread",
      { probe: true },
      { kind: "error", code: "not_found", details: { kind: "thread", device: B.id, device_name: B.name } },
      T.nowhere,
    ],
    [
      "B did not answer the probe",
      { probe: true, silent: [B.id] },
      { kind: "error", code: "host_unavailable", details: { reason: "host_not_answering", device: B.id } },
      T.nowhere,
    ],
    [
      "this device's service carries no wake, so B cannot be asked",
      {},
      { kind: "error", code: "host_unavailable", details: { reason: "wake_unavailable", device: B.id } },
      T.nowhere,
    ],
    [
      "B missed this listing round",
      { probe: true, incomplete: true },
      { kind: "error", code: "host_unavailable", details: { reason: "listing_incomplete", device: B.id } },
      T.nowhere,
    ],
  ] as const)("%s", async (_label, setup, expected, thread) => {
    expect(await resolve(`${B.id}/${thread}`, {}, setup)).toMatchObject(expected)
  })
})

describe("#given a device that is offline #when <that device>/<thread> resolves #then rows already in hand still resolve, and anything else is device_offline with nothing sent (review M2 of #14328)", () => {
  async function offline(text: string, setup: TwoDeviceOptions) {
    const two = createTwoDevices(setup)
    cleanups.push(two.cleanup)
    const resolved = await resolveAddress(
      { remote: two.remote, callerWorkspaceRoot: process.cwd(), local: two.entries, callerId: T.hereLive },
      text,
      { probe: true },
    )
    return { resolved, lookups: two.account.lookups.length }
  }
  test("#given B offline with its rows still listed #when <B>/<a listed id> resolves #then B's row answers", async () => {
    const { resolved } = await offline(`${B.id}/${T.bLive}`, { bOffline: true, probe: true })
    expect(resolved).toMatchObject({ kind: "ok", thread: T.bLive, where: { kind: "device" } })
  })
  test.each([
    ["B offline, a thread id it does not list", `${B.id}/${T.nowhere}`, { bOffline: true, probe: true }, B.id],
    ["B offline, a name it does not list", `${B.name}/no such thread`, { bOffline: true, probe: true }, B.id],
    ["an offline device with no rows, a thread id", `${OFF.id}/${T.nowhere}`, { probe: true }, OFF.id],
  ] as const)(
    "#given %s #when resolved #then device_offline naming it, and no probe is sent",
    async (_label, text, setup, device) => {
      const { resolved, lookups } = await offline(text, setup)
      expect(resolved).toMatchObject({ kind: "error", code: "device_offline", details: { device } })
      expect(lookups).toBe(0)
    },
  )
})
