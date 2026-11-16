import { afterEach, describe, expect, test } from "bun:test"
import type { ListingRow } from "../../../../device-service-core/src/local-api/protocol.ts"
import { defaultWorld, PEER, type World } from "../../../../device-service-core/test/local-api/conformance/world.ts"
import type { AliasError, AliasHolder, AliasRegistry, AliasResult } from "../thread/remote/ports"
import { DEADLINES } from "./deadlines"
import { canonicalizeThreadHandle, handleOf } from "./seams"
import { clientOn, closeClients, failureOf, type FakeClock, fakeClock, startOwner } from "./testing/fake-service"
import type { RemoteClient } from "./client"
import type { ThreadHandle } from "./types"
import type { DeviceService } from "@oh-my-opencode/device-service-core/device-service"

// The alias members over the account's alias registry the caller injects (deps.aliasRegistry). The registry holds a
// session by its DURABLE id, as the thread tools do; the client maps it to and from the listed session's handle. The
// fake registry keeps the port's rules: one holder per alias, one alias per session, keyed by the session id it is given.

afterEach(closeClients)

// Each listed session's durable id differs from its session key, so a registry fed the key instead is caught.
const LIVE = "c2Vzc2lvbi1saXZl"
const OTHER = "c2Vzc2lvbi1vdGhlcg"
const OLD = "c2Vzc2lvbi1vbGQ"
const listingRow = (session_id: string, durable_id?: string): ListingRow => ({
  device: PEER,
  session_id,
  ...(durable_id === undefined ? {} : { durable_id }),
  title: session_id,
  project: "omo",
  path: "/home/user/omo",
  state: "running",
  updated_ms: 1_790_000_000_000,
  source: "live",
  as_of: 1_790_000_100_000,
})
const world = (): World => ({
  ...defaultWorld(),
  listing: {
    revisions: [
      { rows: [listingRow(LIVE, "dur-live"), listingRow(OTHER, "dur-other"), listingRow(OLD)], incomplete: [] },
    ],
    devices: { [PEER]: "answered" },
  },
})

const failed = <T>(code: AliasError["code"], details?: AliasError["details"]): AliasResult<T> => ({
  kind: "error",
  error: { code, message: `fake ${code}`, ...(details === undefined ? {} : { details }) },
})

type FakeRegistry = AliasRegistry & { readonly keys: string[]; readonly holders: Map<string, AliasHolder> }

const fakeRegistry = (): FakeRegistry => {
  const holders = new Map<string, AliasHolder>()
  const keys: string[] = []
  const aliasOf = (session: string) => [...holders].find(([, holder]) => holder.session_id === session)?.[0]
  return {
    keys,
    holders,
    claim: async ({ alias, holder, idempotency_key }) => {
      keys.push(idempotency_key)
      if (alias === "") return failed("alias_invalid", { reason: "empty" })
      const taken = holders.get(alias)
      if (taken !== undefined && taken.session_id !== holder.session_id) return failed("alias_taken", { holder: taken })
      holders.set(alias, holder)
      return { kind: "ok", value: { alias, holder } }
    },
    rename: async ({ session_id, from, to, idempotency_key }) => {
      keys.push(idempotency_key)
      const holder = holders.get(from)
      if (holder === undefined || holder.session_id !== session_id) return failed("alias_not_found")
      const taken = holders.get(to)
      if (taken !== undefined && taken.session_id !== session_id) return failed("alias_taken", { holder: taken })
      holders.delete(from)
      holders.set(to, holder)
      return { kind: "ok", value: { alias: to, holder } }
    },
    release: async ({ session_id, alias }) => {
      const released = holders.get(alias)?.session_id === session_id
      if (released) holders.delete(alias)
      return { kind: "ok", value: { released } }
    },
    resolve: async (alias) => {
      const holder = holders.get(alias)
      return holder === undefined ? failed("alias_not_found") : { kind: "ok", value: holder }
    },
    aliasesOf: async (sessionIds) => {
      const found = new Map<string, string>()
      for (const id of sessionIds) {
        const alias = aliasOf(id)
        if (alias !== undefined) found.set(id, alias)
      }
      return { kind: "ok", value: found }
    },
  }
}

const clientWith = async (
  registry: () => Promise<AliasRegistry>,
  clock: FakeClock = fakeClock(),
): Promise<RemoteClient> =>
  clientOn((await startOwner(world())).stateDir, clock, undefined, { aliasRegistry: registry })

const handle = (text: string): ThreadHandle => {
  const parsed = canonicalizeThreadHandle(text, {})
  if (parsed.kind !== "ok") throw new Error(`${text} parses`)
  return parsed.value.handle
}
const live = handleOf(PEER, LIVE)

describe("aliases", () => {
  test("#given a client without an alias registry #when resolve, set or clear is called #then each answers unsupported{aliases} naming the missing service access", async () => {
    const client = clientOn((await startOwner(world())).stateDir, fakeClock())

    const answers = [
      await client.aliases.resolve("build"),
      await client.aliases.set(live, "build"),
      await client.aliases.clear(live),
    ]

    for (const answer of answers)
      expect(failureOf(answer)).toMatchObject({
        code: "unsupported",
        details: { feature: "aliases", missing: "service_access" },
      })
  })

  test("#given a listed session whose durable id differs from its key #when it is aliased, re-aliased and cleared #then the registry holds the durable id and resolve maps it back to the session's handle", async () => {
    const registry = fakeRegistry()
    const client = await clientWith(async () => registry)

    expect(await client.aliases.set(live, "build")).toEqual({ kind: "ok", value: { alias: "build" } })
    expect(registry.holders.get("build")).toEqual({ session_id: "dur-live", device: PEER })
    expect(await client.aliases.resolve("build")).toEqual({ kind: "ok", value: live })
    expect(await client.aliases.set(live, "ship")).toEqual({ kind: "ok", value: { alias: "ship" } })
    expect([...registry.holders]).toEqual([["ship", { session_id: "dur-live", device: PEER }]])
    expect(failureOf(await client.aliases.resolve("build"))).toMatchObject({
      code: "not_found",
      details: { kind: "alias", alias_code: "alias_not_found" },
    })
    expect(await client.aliases.clear(live)).toEqual({ kind: "ok", value: { released: true } })
    expect(await client.aliases.clear(live)).toEqual({ kind: "ok", value: { released: false } })
    expect(registry.holders.size).toBe(0)
  })

  test("#given an alias the thread tools set on a durable id #when resolve reads it #then it names that session's handle; a durable id no row lists is not_found{session}", async () => {
    const registry = fakeRegistry()
    registry.holders.set("tools", { session_id: "dur-other", device: PEER })
    registry.holders.set("gone", { session_id: "dur-gone", device: PEER })
    const client = await clientWith(async () => registry)

    expect(await client.aliases.resolve("tools")).toEqual({ kind: "ok", value: handleOf(PEER, OTHER) })
    expect(failureOf(await client.aliases.resolve("gone"))).toMatchObject({
      code: "not_found",
      details: { kind: "session", durable_id: "dur-gone" },
    })
  })

  test("#given a session with no durable id or one the listing does not hold #when set or clear runs #then unsupported{no_durable_id} or not_found{session}, and the registry is untouched", async () => {
    const registry = fakeRegistry()
    const client = await clientWith(async () => registry)

    for (const answer of [
      await client.aliases.set(handleOf(PEER, OLD), "build"),
      await client.aliases.clear(handleOf(PEER, OLD)),
    ])
      expect(failureOf(answer)).toMatchObject({
        code: "unsupported",
        details: { feature: "aliases", reason: "no_durable_id" },
      })
    for (const answer of [
      await client.aliases.set(handleOf(PEER, "nope"), "build"),
      await client.aliases.clear(handleOf(PEER, "nope")),
    ])
      expect(failureOf(answer)).toMatchObject({ code: "not_found", details: { kind: "session" } })
    expect(failureOf(await client.aliases.set(handle("my-thread"), "build")).code).toBe("invalid_arguments")
    expect(registry.keys).toEqual([])
  })

  test("#given set called twice with one thread and alias #when the keys are compared #then they repeat for the same pair and differ for another alias", async () => {
    const registry = fakeRegistry()
    const client = await clientWith(async () => registry)

    await client.aliases.set(live, "build")
    await client.aliases.set(live, "build")
    await client.aliases.set(live, "ship")

    const [first, second, third] = registry.keys
    expect(first).toBe(second)
    expect(third).not.toBe(first)
  })

  test("#given registry refusals #when set and resolve meet them #then each maps onto a remote code with the registry's details kept", async () => {
    const registry = fakeRegistry()
    registry.holders.set("build", { session_id: "dur-other", device: PEER })
    const client = await clientWith(async () => registry)

    expect(failureOf(await client.aliases.set(live, "build"))).toMatchObject({
      code: "alias_taken",
      details: { holder: { session_id: "dur-other", device: PEER }, alias_code: "alias_taken" },
    })
    expect(failureOf(await client.aliases.set(live, ""))).toMatchObject({
      code: "invalid_arguments",
      details: { reason: "empty", alias_code: "alias_invalid" },
    })
    const down = await clientWith(async () => ({
      ...registry,
      resolve: async () => failed("alias_registry_unavailable", { reason: "network" }),
    }))
    expect(failureOf(await down.aliases.resolve("build"))).toMatchObject({
      code: "host_unavailable",
      details: { reason: "network", alias_code: "alias_registry_unavailable" },
    })
    const unloadable = await clientWith(async () => {
      throw new Error("signed out")
    })
    expect(failureOf(await unloadable.aliases.resolve("build"))).toMatchObject({
      code: "host_unavailable",
      details: { reason: "registry_unavailable", alias_code: "alias_registry_unavailable" },
    })
  })

  test("#given a registry that never answers #when set and resolve pass DEADLINES.aliases #then they time out, set uncertain", async () => {
    const clock = fakeClock()
    const silent = new Promise<never>(() => {})
    const reached = Promise.withResolvers<void>()
    const client = await clientWith(
      async () => ({
        ...fakeRegistry(),
        resolve: () => silent,
        aliasesOf: () => {
          reached.resolve()
          return silent
        },
      }),
      clock,
    )

    const resolving = client.aliases.resolve("build")
    const setting = client.aliases.set(live, "build")
    // set lists the session over the fake owner first; the clock moves once it is waiting on the registry.
    let breaker: ReturnType<typeof setTimeout> | undefined
    await Promise.race([
      reached.promise,
      new Promise<never>((_, reject) => {
        breaker = setTimeout(() => reject(new Error("waited 5s for set to reach the registry, it never did")), 5_000)
      }),
    ]).finally(() => clearTimeout(breaker))
    clock.advance(DEADLINES.aliases)

    expect(failureOf(await resolving)).toMatchObject({ code: "timeout", details: { deadline_ms: DEADLINES.aliases } })
    expect(failureOf(await resolving).uncertain).toBeUndefined()
    expect(failureOf(await setting)).toMatchObject({ code: "timeout", uncertain: true })
  })
})

describe("aliases when the holder's device missed the listing round", () => {
  // Review M1 at 15dcf94: a device that did not answer the round is an outage, not a missing session (thread tools:
  // remote-ops.ts holderTarget answers device_offline there).
  const silentDevice = {
    serviceVersion: "0.1.37",
    capabilities: ["sessions", "devices"],
    closed: new Promise<void>(() => {}),
    close: () => {},
    status: async () => ({ state: "connected" }),
    thisDevice: async () => ({ id: "dev-self", name: "self" }),
    devices: async () => [],
    sessions: async () => ({ revision: 1, rows: [], devices: { "dev-b": "timeout" }, incomplete: [] }),
  } as unknown as DeviceService
  const registry: AliasRegistry = {
    resolve: async () => ({ kind: "ok", value: { device: "dev-b", session_id: "dur-b" } }),
    aliasesOf: async () => ({ kind: "ok", value: new Map() }),
    claim: async () => ({ kind: "error", error: { code: "alias_registry_unavailable", message: "unreached" } }),
    rename: async () => ({ kind: "error", error: { code: "alias_registry_unavailable", message: "unreached" } }),
    release: async () => ({ kind: "error", error: { code: "alias_registry_unavailable", message: "unreached" } }),
  }
  test("#given the holder's device timed out on the round #when resolve or set runs #then device_offline naming it, never not_found", async () => {
    const owner = await startOwner()
    const client = clientOn(owner.stateDir, fakeClock(), undefined, {
      connect: async () => silentDevice,
      aliasRegistry: async () => registry,
    })
    const thread = handleOf("dev-b", "key-b")
    expect(failureOf(await client.aliases.resolve("lane-b"))).toMatchObject({
      code: "device_offline",
      details: { device: "dev-b" },
    })
    expect(failureOf(await client.aliases.set(thread, "lane-b"))).toMatchObject({
      code: "device_offline",
      details: { device: "dev-b" },
    })
    expect(failureOf(await client.aliases.clear(thread))).toMatchObject({
      code: "device_offline",
      details: { device: "dev-b" },
    })
  })
})
