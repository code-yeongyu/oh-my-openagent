import { afterEach, expect, mock, spyOn, test } from "bun:test"
import { readdir, readFile } from "node:fs/promises"
import { join } from "node:path"
import { failAnchorListingAfterPin } from "../crypto/testing/retired-pin-listing.test-support.ts"
import { loadTrustAnchor } from "../crypto/trust-pin.ts"
import { enableSync } from "./enable.ts"
import { ACCOUNT, fixture, operationScope } from "./testing/genesis-enable.test-support.ts"

const cleanups: (() => Promise<void>)[] = []
afterEach(async () => {
  mock.restore()
  for (const close of cleanups.splice(0).reverse()) await close()
})
const setup = async () => {
  const f = await fixture()
  cleanups.push(f.close)
  return f
}

test("empty account creates genesis, persists exact intent before PUT, and pins the served chain", async () => {
  const f = await setup()
  let durable = false
  const chain = {
    ...f.input.chain,
    async appendKeys(request: Parameters<typeof f.input.chain.appendKeys>[0]) {
      const dirs = await readdir(join(f.input.pinDir, "genesis-intent"))
      for (const dir of dirs.filter((name) => !name.endsWith(".lock") && !name.endsWith(".tmp"))) {
        const intent: unknown = JSON.parse(
          await readFile(join(f.input.pinDir, "genesis-intent", dir, "intent.json"), "utf8"),
        )
        if (typeof intent === "object" && intent !== null && "request" in intent) {
          expect(intent.request).toEqual(request)
          durable = true
        }
      }
      return f.input.chain.appendKeys(request)
    },
  }
  expect(await enableSync({ ...f.input, chain })).toEqual({ kind: "joined", created: true })
  expect(durable).toBe(true)
  expect(f.ceremonies()).toBe(1)
  const pin = await loadTrustAnchor(f.input.pinDir, ACCOUNT)
  expect(pin.ok && pin.anchor.genesisDigest).toBe(f.built.digest)
  expect(await enableSync(f.input)).toEqual({ kind: "joined" })
  expect(f.ceremonies()).toBe(1)
})

test.each(["before-commit", "after-commit"] as const)(
  "uncertain %s resumes the identical signed request without a second ceremony",
  async (when) => {
    const f = await setup()
    const requests: unknown[] = []
    const chain = {
      ...f.input.chain,
      async appendKeys(request: Parameters<typeof f.input.chain.appendKeys>[0]) {
        requests.push(request)
        if (when === "after-commit") await f.input.chain.appendKeys(request)
        throw new TypeError("synthetic lost response")
      },
    }
    await expect(enableSync({ ...f.input, chain })).rejects.toThrow()
    expect(
      await enableSync({
        ...f.input,
        chain: {
          ...f.input.chain,
          appendKeys: async (request) => {
            requests.push(request)
            return f.input.chain.appendKeys(request)
          },
        },
      }),
    ).toEqual({ kind: "joined", created: true })
    expect(f.ceremonies()).toBe(1)
    expect(f.entries).toHaveLength(1)
    if (when === "before-commit") expect(requests[1]).toEqual(requests[0])
  },
)

test("malformed key list and a withheld pinned chain fail before switches or ceremony", async () => {
  const f = await setup()
  await expect(enableSync({ ...f.input, chain: { ...f.input.chain, listKeys: async () => null } })).rejects.toThrow()
  expect(f.server.switches).toHaveLength(0)
  expect(f.ceremonies()).toBe(0)
  await enableSync(f.input)
  f.server.switches.length = 0
  await expect(enableSync({ ...f.input, chain: { ...f.input.chain, listKeys: async () => [] } })).rejects.toThrow()
  expect(f.server.switches).toHaveLength(0)
  expect(f.ceremonies()).toBe(1)
})

test("cancellation after PUT leaves the exact intent for a successor, without stale success", async () => {
  const f = await setup()
  const { controller, operation } = operationScope()
  const chain = {
    ...f.input.chain,
    async appendKeys(request: Parameters<typeof f.input.chain.appendKeys>[0]) {
      const result = await f.input.chain.appendKeys(request)
      controller.abort()
      return result
    },
  }
  await expect(enableSync({ ...f.input, chain, ...operation })).rejects.toThrow()
  expect((await loadTrustAnchor(f.input.pinDir, ACCOUNT)).ok).toBe(false)
  expect(await enableSync(f.input)).toEqual({ kind: "joined", created: true })
  expect(f.ceremonies()).toBe(1)
})

// #12382: the root-change notice runs after the pin is written, so a failure to list the retired pins must not turn a
// pinned enable into an error. The skipped check is part of the outcome, for the caller to show; the library itself
// writes nothing to the host's stderr (in-process it would draw over the TUI).
test("an enable that pinned still joins, and reports the root-change check as skipped, when the retired pins cannot be listed", async () => {
  const f = await setup()
  const fault = failAnchorListingAfterPin(f.input.pinDir)
  const stderr = spyOn(process.stderr, "write")

  const outcome = await enableSync(f.input)
  const written = stderr.mock.calls.length
  mock.restore()

  expect(fault.pinned()).toBe(true)
  expect(outcome).toEqual({ kind: "joined", created: true, rootCheck: { kind: "skipped", reason: "EACCES" } })
  expect(written).toBe(0)
  const pinned = await loadTrustAnchor(f.input.pinDir, ACCOUNT)
  expect(pinned.ok && pinned.anchor.genesisDigest).toBe(f.built.digest)
})

test("no bridge answers passkey_unavailable for the passkey method without changing switches", async () => {
  const f = await setup()
  const { genesis: _genesis, ...input } = f.input
  expect(await enableSync(input)).toEqual({ kind: "passkey_unavailable" })
  expect(f.server.switches).toHaveLength(0)
})
