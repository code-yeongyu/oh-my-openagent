import { afterEach, expect, spyOn, test } from "bun:test"
import { readdir, readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import * as pins from "../crypto/trust-pin.ts"
import { creatorAnchor } from "../crypto/anchor.ts"
import { appendEntries, emptyChain } from "../crypto/chain.ts"
import { createRejectionCounter } from "../crypto/rejection.ts"
import { deviceKeyring, entryOf } from "../genesis/vector.test-support.ts"
import { buildGenesis } from "../genesis/build.ts"
import { prepareGenesis } from "../genesis/prepare.ts"
import { enableSync } from "./enable.ts"
import { principalOf } from "./join.ts"
import { createAccountHttp } from "./http.ts"
import { createPairingHttp } from "./pairing-http.ts"
import { ACCOUNT, fixture } from "./testing/genesis-enable.test-support.ts"

const cleanup: (() => void | Promise<void>)[] = []
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close() })
const setup = async () => { const f = await fixture(); cleanup.push(f.close); return f }

test("pin write failure resumes accepted genesis without another credential", async () => {
  const f = await setup()
  const pin = spyOn(pins, "pinTrustAnchor").mockRejectedValue(new Error("synthetic disk full"))
  cleanup.push(() => pin.mockRestore())
  await expect(enableSync(f.input)).rejects.toThrow("synthetic disk full")
  expect(f.entries).toHaveLength(1)
  pin.mockRestore()
  expect(await enableSync(f.input)).toEqual({ kind: "joined", created: true })
  expect(f.ceremonies()).toBe(1)
})

test("corrupt intent is preserved and refused before switches or another ceremony", async () => {
  const f = await setup()
  await expect(enableSync({ ...f.input, chain: {
    ...f.input.chain, appendKeys: async () => { throw new TypeError("synthetic network failure") },
  } })).rejects.toThrow()
  const root = join(f.input.pinDir, "genesis-intent")
  const dir = (await readdir(root)).find((name) => /^[a-f0-9]{64}$/.test(name))
  if (!dir) throw new Error("intent missing")
  const path = join(root, dir, "intent.json")
  await writeFile(path, '{"version":1}')
  f.server.switches.length = 0
  await expect(enableSync(f.input)).rejects.toMatchObject({ reason: "corrupt_intent" })
  expect(await readFile(path, "utf8")).toBe('{"version":1}')
  expect(f.server.switches).toHaveLength(0)
  expect(f.ceremonies()).toBe(1)
})

test("different winner after CAS refusal requires pairing and never pins the winning root", async () => {
  const f = await setup()
  const other = await deviceKeyring(40)
  const prepared = await prepareGenesis({ ...f.bootstrap, first_device: principalOf(other) }, f.capabilities)
  const won = await buildGenesis(ACCOUNT, other, prepared)
  const winner = await entryOf(won.request, other)
  const chain = {
    ...f.input.chain,
    appendKeys: async () => {
      f.entries.push(winner)
      return { ok: false as const, reason: "stale_base" as const }
    },
  }
  expect(await enableSync({ ...f.input, chain })).toEqual({ kind: "join_required" })
  expect((await pins.loadTrustAnchor(f.input.pinDir, ACCOUNT)).ok).toBe(false)
  expect(await readdir(join(f.input.pinDir, "genesis-intent"))).toEqual([])
})

test("another genuinely signed genesis naming this device fails the exact-intent check", async () => {
  const f = await setup()
  const prepared = await prepareGenesis({ ...f.bootstrap, custody_nonce: Buffer.alloc(16, 91).toString("base64url") }, f.capabilities)
  const different = await buildGenesis(ACCOUNT, f.keyring, prepared)
  const chain = {
    ...f.input.chain,
    appendKeys: async () => { f.entries.push(await entryOf(different.request, f.keyring)); return { ok: true as const, seq: 1 } },
  }
  await expect(enableSync({ ...f.input, chain })).rejects.toMatchObject({ reason: "intent_mismatch" })
  expect((await pins.loadTrustAnchor(f.input.pinDir, ACCOUNT)).ok).toBe(false)
  expect(f.ceremonies()).toBe(1)
})

test("held suffix is not called a complete verified chain", async () => {
  const f = await setup()
  const chain = {
    ...f.input.chain,
    state: async () => {
      const state = await f.input.chain.state()
      return state === null ? null : { ...state, head: { ...state.head, seq: state.head.seq + 1 } }
    },
  }
  await expect(enableSync({ ...f.input, chain })).rejects.toMatchObject({ reason: "incomplete_chain" })
  expect((await pins.loadTrustAnchor(f.input.pinDir, ACCOUNT)).ok).toBe(false)
})

test("same principal cannot start a second native ceremony while the first owns its durable lock", async () => {
  const f = await setup()
  const entered = Promise.withResolvers<void>()
  const release = Promise.withResolvers<void>()
  const pending = enableSync({ ...f.input, genesis: {
    prfSupported: true,
    createGenesis: async () => { entered.resolve(); await release.promise; return { ok: true as const, prepared: f.prepared } },
  } })
  await entered.promise
  try {
    await expect(enableSync(f.input)).rejects.toMatchObject({ name: "LockContentionError" })
    expect(f.ceremonies()).toBe(0)
  } finally {
    release.resolve()
  }
  expect(await pending).toEqual({ kind: "joined", created: true })
})

test("two concurrent creators select one root and the loser must pair", async () => {
  const f = await setup()
  const second = await deviceKeyring(51)
  const prepared = await prepareGenesis({ ...f.bootstrap, first_device: principalOf(second) }, f.capabilities)
  const both = Promise.withResolvers<void>()
  let entered = 0
  const meet = async () => { if (++entered === 2) both.resolve(); await both.promise }
  const options = { baseUrl: f.server.url, token: () => f.server.tokenFor(principalOf(second), "second") }
  const other = {
    ...f.input, keyring: second, pinDir: join(f.input.pinDir, "other"), serviceDeviceId: "second",
    chain: createAccountHttp(options), pairing: createPairingHttp(options),
    genesis: { prfSupported: true, createGenesis: async () => { await meet(); return { ok: true as const, prepared } } },
  }
  const results = await Promise.all([
    enableSync({ ...f.input, genesis: {
      prfSupported: true, createGenesis: async () => { await meet(); return { ok: true as const, prepared: f.prepared } },
    } }),
    enableSync(other),
  ])
  expect(results.filter((r) => r.kind === "joined")).toHaveLength(1)
  expect(results.filter((r) => r.kind === "join_required")).toHaveLength(1)
  expect(f.entries).toHaveLength(1)
  const pinned = await Promise.all([pins.loadTrustAnchor(f.input.pinDir, ACCOUNT), pins.loadTrustAnchor(other.pinDir, ACCOUNT)])
  expect(pinned.filter((p) => p.ok)).toHaveLength(1)
})

test("conflicting and corrupt pins cannot be replaced by an enable attempt", async () => {
  const f = await setup()
  const prepared = await prepareGenesis({ ...f.bootstrap, custody_nonce: Buffer.alloc(16, 81).toString("base64url") }, f.capabilities)
  const other = await buildGenesis(ACCOUNT, f.keyring, prepared)
  const walked = await appendEntries(emptyChain(ACCOUNT, creatorAnchor(ACCOUNT, f.keyring)), [await entryOf(other.request, f.keyring)], createRejectionCounter())
  if (!walked.ok || !walked.state.pin) throw new Error("fixture pin")
  await pins.pinTrustAnchor(f.input.pinDir, ACCOUNT, walked.state.pin)
  f.entries.push(await entryOf(f.built.request, f.keyring))
  await expect(enableSync(f.input)).rejects.toThrow()
  expect(f.server.switches).toHaveLength(0)
  const pin = await pins.loadTrustAnchor(f.input.pinDir, ACCOUNT)
  expect(pin.ok && pin.anchor.genesisDigest).toBe(other.digest)
})
