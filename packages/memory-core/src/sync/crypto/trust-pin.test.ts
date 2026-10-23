import { afterEach, describe, expect, mock, spyOn, test } from "bun:test"
import { createHash } from "node:crypto"
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, relative, sep } from "node:path"
import * as resilient from "../../fs/resilient"
import * as durable from "../../journal/fsync"
import { creatorAnchor, type PinCandidate } from "./anchor.ts"
import { appendEntries, emptyChain } from "./chain.ts"
import * as cryptoIndex from "./index.ts"
import { createRejectionCounter } from "./rejection.ts"
import { genesisEntry, newDeviceKeyring, newRecoveryCredential } from "./testing/genesis.ts"
import { ACCOUNT, fixtureAnchor, mainChain, record } from "./testing/sync-v1.test-support.ts"
import { forgetTrustAnchor, loadTrustAnchor, pinTrustAnchor, TrustPinError } from "./trust-pin.ts"

const dirs: string[] = []
afterEach(() => {
  mock.restore()
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})
const stateDir = (): string => {
  const dir = mkdtempSync(join(tmpdir(), "trust-pin-"))
  dirs.push(dir)
  return dir
}
const pinPath = (dir: string, account = ACCOUNT): string => join(dir, "trust-anchor", createHash("sha256").update(account).digest("base64url"), "pin.json")

const provenCandidate = async (): Promise<PinCandidate> => {
  const outcome = await appendEntries(emptyChain(ACCOUNT, fixtureAnchor()), mainChain(), createRejectionCounter())
  if (!outcome.ok || outcome.state.pin === null) throw new Error("the fixture creator walk proves no pin")
  return outcome.state.pin
}

const otherCandidate = async (): Promise<PinCandidate> => {
  const keyring = await newDeviceKeyring()
  const other = await genesisEntry(ACCOUNT, keyring, "W".repeat(43), newRecoveryCredential())
  const walked = await appendEntries(emptyChain(ACCOUNT, creatorAnchor(ACCOUNT, keyring)), [other], createRejectionCounter())
  if (!walked.ok || walked.state.pin === null) throw new Error("other root walk")
  return walked.state.pin
}

const pinned = async (dir: string) => pinTrustAnchor(dir, ACCOUNT, await provenCandidate())

const expectNoAnchor = async (dir: string, reason: "no_pin" | "corrupt_pin") => {
  expect(await loadTrustAnchor(dir, ACCOUNT)).toEqual({ ok: false, reason, next: "re-pair or recover" })
}

describe("the pinned root: set once from a proven walk, then the only root", () => {
  test("a pin set from a verified walk loads back and anchors the genuine chain", async () => {
    const dir = stateDir()
    const anchor = await pinned(dir)
    const loaded = await loadTrustAnchor(dir, ACCOUNT)
    expect(loaded.ok && loaded.anchor.genesisDigest).toBe(record("genesis").digest)
    if (!loaded.ok) return
    expect((await appendEntries(emptyChain(ACCOUNT, loaded.anchor), mainChain(), createRejectionCounter())).ok).toBe(true)
    expect(anchor.genesisDigest).toBe(loaded.anchor.genesisDigest)
  })

  test("a candidate no verified walk minted is never pinned", async () => {
    const dir = stateDir()
    const handBuilt = { account: ACCOUNT, genesisDigest: record("genesis").digest, pinnedBy: "creator" as const, at: { seq: 1, keyring_link: record("genesis").keyring_link } }
    // @ts-expect-error only a walk that met its anchor mints a PinCandidate
    await expect(pinTrustAnchor(dir, ACCOUNT, handBuilt)).rejects.toMatchObject({ problem: "not_verified" })
    await expectNoAnchor(dir, "no_pin")
  })

  test("a second, different root is refused and the first pin is untouched", async () => {
    const dir = stateDir()
    await pinned(dir)
    const before = readFileSync(pinPath(dir), "utf8")
    const keyring = await newDeviceKeyring()
    const other = await genesisEntry(ACCOUNT, keyring, "W".repeat(43), newRecoveryCredential())
    const walked = await appendEntries(emptyChain(ACCOUNT, creatorAnchor(ACCOUNT, keyring)), [other], createRejectionCounter())
    if (!walked.ok || walked.state.pin === null) throw new Error("other root walk")
    await expect(pinTrustAnchor(dir, ACCOUNT, walked.state.pin)).rejects.toBeInstanceOf(TrustPinError)
    expect(readFileSync(pinPath(dir), "utf8")).toBe(before)
  })

  test("a chain refused under the pin leaves the pin file byte for byte as it was", async () => {
    const dir = stateDir()
    await pinned(dir)
    const before = readFileSync(pinPath(dir), "utf8")
    const loaded = await loadTrustAnchor(dir, ACCOUNT)
    if (!loaded.ok) throw new Error("pin")
    const substituted = await genesisEntry(ACCOUNT, await newDeviceKeyring(), "W".repeat(43), newRecoveryCredential())
    const refused = await appendEntries(emptyChain(ACCOUNT, loaded.anchor), [substituted], createRejectionCounter())
    expect(refused.ok ? "accepted" : refused.reason).toBe("untrusted_root")
    expect(readFileSync(pinPath(dir), "utf8")).toBe(before)
  })

  test("re-pinning is reachable only through forgetTrustAnchor, which the package does not export", async () => {
    expect(Object.keys(cryptoIndex)).not.toContain("forgetTrustAnchor")
    expect(Object.keys(cryptoIndex)).not.toContain("mintTrustAnchor")
    const dir = stateDir()
    await pinned(dir)
    await forgetTrustAnchor(dir, ACCOUNT)
    await expectNoAnchor(dir, "no_pin")
  })
})

describe("a pin file that is missing or does not parse is no anchor, never a fallback", () => {
  test("missing", async () => {
    await expectNoAnchor(stateDir(), "no_pin")
  })

  test("an account directory without its pin is corrupt and cannot be replaced", async () => {
    const dir = stateDir()
    const accountDir = dirname(pinPath(dir))
    mkdirSync(accountDir, { recursive: true })
    await expectNoAnchor(dir, "corrupt_pin")
    await expect(pinTrustAnchor(dir, ACCOUNT, await provenCandidate())).rejects.toMatchObject({ problem: "corrupt_pin" })
    expect(readdirSync(accountDir)).toEqual([])
  })

  test.each([
    ["truncated", (pin: string) => pin.slice(0, pin.length / 2)],
    ["garbage", () => "\u0000\u00ff not json"],
    ["wrong version", (pin: string) => JSON.stringify({ ...JSON.parse(pin), version: 2 })],
    ["an inner account that is not the expected one", (pin: string) => JSON.stringify({ ...JSON.parse(pin), account: "another-account" })],
    ["a malformed root digest", (pin: string) => JSON.stringify({ ...JSON.parse(pin), genesis_digest: "short" })],
    ["an extra field", (pin: string) => JSON.stringify({ ...JSON.parse(pin), trust: "server" })],
  ])("%s", async (_name, mutate) => {
    const dir = stateDir()
    await pinned(dir)
    writeFileSync(pinPath(dir), mutate(readFileSync(pinPath(dir), "utf8")))
    await expectNoAnchor(dir, "corrupt_pin")
    await expect(pinTrustAnchor(dir, ACCOUNT, await provenCandidate())).rejects.toMatchObject({ problem: "corrupt_pin" })
  })

  test("a crash before the publishing rename leaves no pin, and the next load removes the candidate", async () => {
    const dir = stateDir()
    const exited = Bun.spawn(["true"])
    await exited.exited
    const key = createHash("sha256").update(ACCOUNT).digest("base64url")
    const candidate = join(dir, "trust-anchor", `${key}.${exited.pid}.0123456789ab.tmp`)
    mkdirSync(candidate, { recursive: true })
    writeFileSync(join(candidate, "pin.json"), '{"version":1,"acc')
    await expectNoAnchor(dir, "no_pin")
    expect(readdirSync(join(dir, "trust-anchor"))).toEqual([])
  })
})

describe("publishing the pin is durable, and a lost race is decided by the winner's pin", () => {
  test("the pin file and its directory are fsynced before the publishing rename, the parent after it", async () => {
    const dir = stateDir()
    const root = join(dir, "trust-anchor")
    const [syncFile, syncDirectory, rename] = [durable.syncJournalFile, durable.syncJournalDirectory, resilient.rename]
    const calls: string[] = []
    const name = (path: unknown) => (relative(root, String(path)) || ".").split(sep).join("/").replace(/\.\d+\.[0-9a-f]{12}\.tmp/, ".tmp")
    spyOn(durable, "syncJournalFile").mockImplementation(async (path) => {
      calls.push(`file ${name(path)}`)
      await syncFile(path)
    })
    spyOn(durable, "syncJournalDirectory").mockImplementation(async (path) => {
      calls.push(`dir ${name(path)}`)
      await syncDirectory(path)
    })
    spyOn(resilient, "rename").mockImplementation(async (from, to) => {
      calls.push(`rename ${name(from)} ${name(to)}`)
      await rename(from, to)
    })
    await pinned(dir)
    const key = dirname(relative(root, pinPath(dir)))
    expect(calls).toEqual([`file ${key}.tmp/pin.json`, `dir ${key}.tmp`, `rename ${key}.tmp ${key}`, "dir ."])
  })

  test.each([
    ["a different root is a typed conflict", otherCandidate, { problem: "pin_conflict" }],
    ["the same root returns the winner's pin", provenCandidate, null],
  ] as const)("losing the publishing race to %s", async (_name, winnerCandidate, refusal) => {
    const dir = stateDir()
    const [winner, loser] = [await winnerCandidate(), await provenCandidate()]
    const rename = resilient.rename
    spyOn(resilient, "rename").mockImplementationOnce(async (from, to) => {
      await pinTrustAnchor(dir, ACCOUNT, winner)
      await rename(from, to)
    })
    const lost = pinTrustAnchor(dir, ACCOUNT, loser)
    if (refusal !== null) await expect(lost).rejects.toMatchObject(refusal)
    else expect((await lost).genesisDigest).toBe(loser.genesisDigest)
    const loaded = await loadTrustAnchor(dir, ACCOUNT)
    expect(loaded.ok && loaded.anchor.genesisDigest).toBe(winner.genesisDigest)
    expect(readdirSync(join(dir, "trust-anchor"))).toEqual([dirname(relative(join(dir, "trust-anchor"), pinPath(dir)))])
  })
})
