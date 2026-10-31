import { afterEach, expect, test } from "bun:test"
import type { DesktopSyncOperation } from "@oh-my-opencode/memory-core/sync-engine"
import { disposeSyncRpcFixtures, owner, setup } from "./sync-rpc-test-support"

afterEach(disposeSyncRpcFixtures)

type Fixture = Awaited<ReturnType<typeof setup>>
type EnableInput = Parameters<Fixture["runtime"]["enableSync"]>[0]

const forgedRequest = {
  serviceOrigin: "https://attacker.invalid",
  rpId: "attacker.invalid",
  userName: "attacker",
  genesis: { prfSupported: true },
}

async function fixture(genesis: "supported" | "unsupported") {
  const f = await setup()
  const bridge = { prfSupported: true } as unknown as NonNullable<DesktopSyncOperation["genesis"]>
  const supported = genesis === "supported"
  const base = f.account.forOperation
  Object.assign(f.account, {
    descriptor: { ...f.account.descriptor, genesis, rpId: supported ? "sync.example" : null, userName: supported ? "person" : null },
    forOperation: async (authority: Parameters<typeof base>[0]) => ({ ...await base(authority), genesis: bridge }),
  })
  const seen: EnableInput[] = []
  const called = Promise.withResolvers<void>()
  f.runtime.enableSync = async (input) => { seen.push(input); called.resolve(); return { kind: "needs_first_device" } }
  const enabled = () => Promise.race([
    called.promise,
    Bun.sleep(10_000).then(() => { throw new Error("waited 10s for enableSync, never called") }),
  ])
  return { f, bridge, seen, enabled }
}

test("#given forged enable fields #when enable is called #then the request is refused before any account work", async () => {
  const { f, seen } = await fixture("supported")

  const result = await f.call("enable", owner("a").context, forgedRequest)

  expect(result).toEqual({ kind: "refused", reason: "This request takes no parameters." })
  expect(seen).toEqual([])
  expect(f.counts().begins).toBe(0)
})

test("#given a genesis-capable descriptor #when enable runs #then origin, RP, user and bridge come only from the descriptor and its operation", async () => {
  const { f, bridge, seen, enabled } = await fixture("supported")

  await f.call("enable", owner("a").context, {})
  await enabled()

  const input = seen[0]
  expect(input?.serviceOrigin).toBe(f.account.descriptor.serviceOrigin)
  expect(input?.rpId).toBe("sync.example")
  expect(input?.userName).toBe("person")
  expect(input?.genesis).toBe(bridge)
  expect(input?.account).toBe(f.account.descriptor.accountId)
  expect(input?.serviceDeviceId).toBe(f.account.descriptor.serviceDeviceId)
})

test("#given a descriptor without genesis support #when enable runs #then no RP, user or bridge reaches enable", async () => {
  const { f, seen, enabled } = await fixture("unsupported")

  await f.call("enable", owner("a").context, {})
  await enabled()

  const input = seen[0]
  expect(input?.rpId).toBeUndefined()
  expect(input?.userName).toBeUndefined()
  expect(input?.genesis).toBeUndefined()
  expect(input?.serviceOrigin).toBe(f.account.descriptor.serviceOrigin)
})
