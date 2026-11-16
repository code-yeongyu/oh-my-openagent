import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { AliasError, AliasHolder, AliasRegistry, AliasResult } from "../thread/remote/ports"
import { DEADLINES } from "./deadlines"
import { canonicalizeThreadHandle, handleOf } from "./seams"
import { clientOn, closeClients, failureOf, fakeClock, startOwner } from "./testing/fake-service"
import type { RemoteClient } from "./client"
import type { ThreadHandle } from "./types"

// The alias members over the account's alias registry the caller injects (deps.aliasRegistry). The fake registry keeps
// the port's rules: one holder per alias, one alias per session, claim/rename/release keyed by the session id.

const dirs: string[] = []
afterEach(async () => {
  await closeClients()
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

const failed = <T>(code: AliasError["code"], details?: AliasError["details"]): AliasResult<T> => ({
  kind: "error",
  error: { code, message: `fake ${code}`, ...(details === undefined ? {} : { details }) },
})

type FakeRegistry = AliasRegistry & { readonly keys: string[] }

const fakeRegistry = (): FakeRegistry => {
  const holders = new Map<string, AliasHolder>()
  const keys: string[] = []
  const aliasOf = (session: string) => [...holders].find(([, holder]) => holder.session_id === session)?.[0]
  return {
    keys,
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

// No device service is installed: the alias members never need one.
const clientWith = (registry: () => Promise<AliasRegistry>, clock = fakeClock()): RemoteClient => {
  const stateDir = mkdtempSync(join(tmpdir(), "ra-"))
  dirs.push(stateDir)
  return clientOn(stateDir, clock, undefined, { aliasRegistry: registry })
}

const handle = (text: string): ThreadHandle => {
  const parsed = canonicalizeThreadHandle(text, {})
  if (parsed.kind !== "ok") throw new Error(`${text} parses`)
  return parsed.value.handle
}

describe("aliases", () => {
  test("#given a client without an alias registry #when resolve, set or clear is called #then each answers unsupported{aliases} naming the missing service access", async () => {
    const owner = await startOwner()
    const client = clientOn(owner.stateDir, fakeClock())
    const thread = handle("dev-self/s-1")

    const answers = [
      await client.aliases.resolve("build"),
      await client.aliases.set(thread, "build"),
      await client.aliases.clear(thread),
    ]

    for (const answer of answers)
      expect(failureOf(answer)).toMatchObject({
        code: "unsupported",
        details: { feature: "aliases", missing: "service_access" },
      })
  })

  test("#given a registry #when a thread is aliased, re-aliased and cleared #then set claims then renames, resolve names the holder's handle, clear releases once", async () => {
    const registry = fakeRegistry()
    const client = clientWith(async () => registry)
    const thread = handle("dev-b/s-1")

    expect(await client.aliases.set(thread, "build")).toEqual({ kind: "ok", value: { alias: "build" } })
    expect(await client.aliases.resolve("build")).toEqual({ kind: "ok", value: handleOf("dev-b", "s-1") })
    expect(await client.aliases.set(thread, "ship")).toEqual({ kind: "ok", value: { alias: "ship" } })
    expect(await client.aliases.resolve("ship")).toEqual({ kind: "ok", value: handleOf("dev-b", "s-1") })
    expect(failureOf(await client.aliases.resolve("build"))).toMatchObject({
      code: "not_found",
      details: { kind: "alias", alias_code: "alias_not_found" },
    })
    expect(await client.aliases.clear(thread)).toEqual({ kind: "ok", value: { released: true } })
    expect(await client.aliases.clear(thread)).toEqual({ kind: "ok", value: { released: false } })
    expect(failureOf(await client.aliases.resolve("ship")).code).toBe("not_found")
  })

  test("#given set called twice with one thread and alias #when the keys are compared #then they repeat for the same pair and differ for another alias", async () => {
    const registry = fakeRegistry()
    const client = clientWith(async () => registry)
    const thread = handle("dev-b/s-1")

    await client.aliases.set(thread, "build")
    await client.aliases.set(thread, "build")
    await client.aliases.set(thread, "ship")

    const [first, second, third] = registry.keys
    expect(first).toBe(second)
    expect(third).not.toBe(first)
  })

  test("#given registry refusals #when set and resolve meet them #then each maps onto a remote code with the registry's details kept", async () => {
    const registry = fakeRegistry()
    const client = clientWith(async () => registry)
    await client.aliases.set(handle("dev-a/s-0"), "build")

    expect(failureOf(await client.aliases.set(handle("dev-b/s-1"), "build"))).toMatchObject({
      code: "alias_taken",
      details: { holder: { session_id: "s-0", device: "dev-a" }, alias_code: "alias_taken" },
    })
    expect(failureOf(await client.aliases.set(handle("dev-b/s-1"), ""))).toMatchObject({
      code: "invalid_arguments",
      details: { reason: "empty", alias_code: "alias_invalid" },
    })
    const down = clientWith(async () => ({
      ...registry,
      resolve: async () => failed("alias_registry_unavailable", { reason: "network" }),
    }))
    expect(failureOf(await down.aliases.resolve("build"))).toMatchObject({
      code: "host_unavailable",
      details: { reason: "network", alias_code: "alias_registry_unavailable" },
    })
  })

  test("#given a registry that cannot be loaded or an address that is not a device/session handle #when the members run #then they settle with data", async () => {
    const unloadable = clientWith(async () => {
      throw new Error("signed out")
    })
    expect(failureOf(await unloadable.aliases.resolve("build"))).toMatchObject({
      code: "host_unavailable",
      details: { reason: "registry_unavailable", alias_code: "alias_registry_unavailable" },
    })
    const client = clientWith(async () => fakeRegistry())
    expect(failureOf(await client.aliases.set(handle("my-thread"), "build")).code).toBe("invalid_arguments")
    expect(failureOf(await client.aliases.clear(handle("my-thread"))).code).toBe("invalid_arguments")
  })

  test("#given a registry that never answers #when set and resolve pass DEADLINES.aliases #then they time out, set uncertain", async () => {
    const clock = fakeClock()
    const silent = new Promise<never>(() => {})
    const client = clientWith(
      async () => ({ ...fakeRegistry(), resolve: () => silent, aliasesOf: () => silent }),
      clock,
    )

    const resolving = client.aliases.resolve("build")
    const setting = client.aliases.set(handle("dev-b/s-1"), "build")
    clock.advance(DEADLINES.aliases)

    expect(failureOf(await resolving)).toMatchObject({ code: "timeout", details: { deadline_ms: DEADLINES.aliases } })
    expect(failureOf(await resolving).uncertain).toBeUndefined()
    expect(failureOf(await setting)).toMatchObject({ code: "timeout", uncertain: true })
  })
})
