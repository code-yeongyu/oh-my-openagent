import { afterEach, describe, expect, test } from "bun:test"
import { generateKeyPairSync } from "node:crypto"
import { existsSync } from "node:fs"
import { mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises"
import { renameSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { deviceKeyringFromMaterial } from "@oh-my-opencode/memory-core/sync-engine"
import { createCredentialStore, type Credentials } from "@oh-my-opencode/omo-opencode/service-auth"
import type { DeviceKeyring } from "@oh-my-opencode/memory-core/keyring"
import { createCliAccountSource } from "./account-source"

// Security contract (account-transport-api v7 sections 2 and 3): a credential transaction never trusts a read that
// began before it, and a capture never binds an identity resolved for another generation.

const ORIGIN = "https://api.example.test"
const roots: string[] = []
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }) })

const keys = () => ({
  signingPrivateKey: generateKeyPairSync("ed25519").privateKey.export({ format: "der", type: "pkcs8" }).toString("base64"),
  sealingPrivateKey: generateKeyPairSync("x25519").privateKey.export({ format: "der", type: "pkcs8" }).toString("base64"),
})
const credential = (device: string): Credentials => ({
  ...keys(), accessToken: "access", refreshToken: "refresh", accessTokenExpiresAt: "2099-01-01T00:00:00.000Z",
  device: { id: device, name: "fixture" },
})

async function fixture() {
  const home = await mkdtemp(join(tmpdir(), "omo-account-freshness-"))
  roots.push(home)
  const secretFile = join(home, "secret.json")
  let parkNext = false
  let blankReads = 0
  let releaseParked: (() => void) | undefined
  const fileGet = () => readFile(secretFile, "utf8").catch(() => null)
  const store = createCredentialStore(ORIGIN, {
    platform: "darwin", home, lockProbe: async () => "unlocked",
    secrets: {
      // A parked OS read answers with the bytes it saw when it started, whenever the test releases it.
      get: async () => {
        // A blank OS read answers empty while the item is still stored (a keychain that briefly reads nothing).
        if (blankReads > 0) { blankReads -= 1; return null }
        if (!parkNext) return fileGet()
        parkNext = false
        const seen = await fileGet()
        return new Promise(resolve => { releaseParked = () => resolve(seen) })
      },
      set: async ({ value }) => { await writeFile(`${secretFile}.tmp`, value); await rename(`${secretFile}.tmp`, secretFile) },
      delete: async () => { await rm(secretFile, { force: true }); return true },
    },
  })
  return {
    home, secretFile, store,
    park: () => { parkNext = true },
    blank: (reads: number) => { blankReads = reads },
    release: () => {
      if (releaseParked === undefined) throw new Error("no OS read was parked")
      releaseParked()
    },
  }
}

const identity = (account: string, device: () => string, served: string[]): typeof fetch =>
  Object.assign(async (input: Parameters<typeof fetch>[0]) => {
    const path = new URL(String(input)).pathname
    if (path === "/v1/me") return Response.json({ account: { id: account } })
    if (path === "/v1/devices") return Response.json({ devices: [{ id: device(), current: true, revokedAt: null }] })
    served.push(path)
    return Response.json({})
  }, { preconnect: fetch.preconnect })

async function siblingCommitsAba(origin: string, home: string, secretFile: string): Promise<void> {
  const child = Bun.spawn([process.execPath, join(import.meta.dirname, "sibling-writer.fixture.ts"), origin, home, secretFile], {
    stdout: "pipe", stderr: "pipe", env: { ...process.env, HOME: home },
  })
  const deadline = new Promise<never>((_, reject) => setTimeout(() => reject(new Error("the sibling writer did not exit within 20s")), 20_000))
  const code = await Promise.race([child.exited, deadline])
  const out = await new Response(child.stdout).text()
  if (code !== 0 || !out.includes("SIBLING_COMMITTED_ABA")) throw new Error(`sibling writer failed (${code}): ${await new Response(child.stderr).text()}`)
}

describe("authoritative credential reads under the shared lock", () => {
  for (const barrier of ["signing", "service mutation", "pin rename"] as const) {
    test(`#given a read parked before a real sibling's A-B-A #when ${barrier} runs after it committed #then nothing bound to A1 is admitted`, async () => {
      const f = await fixture()
      await f.store.write(credential("device-a"))
      const served: string[] = []
      const account = await createCliAccountSource({ api: ORIGIN, store: f.store, home: f.home, fetch: identity("account-a", () => "device-a", served) })()
      if (account === null) throw new Error("the fixture account did not resolve")
      let rawSigns = 0
      const keyring = await account.keyring(async material => {
        const raw = await deviceKeyringFromMaterial(material)
        const counted: DeviceKeyring = { ...raw, sign: request => { rawSigns += 1; return raw.sign(request) } }
        return counted
      })
      const operation = await account.forOperation({ signal: new AbortController().signal, admit: effect => effect() })
      const pinFrom = join(f.home, "pin.tmp")
      const pinTo = join(f.home, "pin")
      await writeFile(pinFrom, "pin")

      f.park()
      const stale = f.store.read()
      await siblingCommitsAba(ORIGIN, f.home, f.secretFile)

      const attempt = barrier === "signing"
        ? keyring.sign({ purpose: "object-digest", digest: new Uint8Array(32) })
        : barrier === "service mutation"
          ? operation.pairing.setAccountSync(true)
          : account.boundary(() => renameSync(pinFrom, pinTo))
      // The pre-writer read stays parked until the attempt settles: an operation whose read joins it never settles.
      let breaker: ReturnType<typeof setTimeout> | undefined
      const joined = new Promise<string>(resolve => { breaker = setTimeout(() => resolve("joined the parked read"), 10_000) })
      const outcome = await Promise.race([attempt.then(() => "admitted", () => "refused"), joined])
      clearTimeout(breaker)
      f.release()
      await stale
      expect(outcome).toBe("refused")
      expect(rawSigns).toBe(0)
      expect(served).toEqual([])
      expect(existsSync(pinTo)).toBe(false)
      expect(account.signal.aborted).toBe(true)
      await operation.close()
    }, 30_000)
  }

  for (const rotated of ["signingPrivateKey", "sealingPrivateKey"] as const) {
    test(`#given a captured CLI account #when another store rotates the ${rotated === "signingPrivateKey" ? "signing" : "sealing"} key #then signing, a service mutation and the pin rename are all refused`, async () => {
      const f = await fixture()
      await f.store.write(credential("device-a"))
      const served: string[] = []
      const account = await createCliAccountSource({ api: ORIGIN, store: f.store, home: f.home, fetch: identity("account-a", () => "device-a", served) })()
      if (account === null) throw new Error("the fixture account did not resolve")
      let rawSigns = 0
      const keyring = await account.keyring(async material => {
        const raw = await deviceKeyringFromMaterial(material)
        return { ...raw, sign: request => { rawSigns += 1; return raw.sign(request) } } satisfies DeviceKeyring
      })
      const operation = await account.forOperation({ signal: new AbortController().signal, admit: effect => effect() })
      const pinFrom = join(f.home, "pin.tmp")
      const pinTo = join(f.home, "pin")
      await writeFile(pinFrom, "pin")
      // Another process's store rotates exactly one key; the store stamps the new generation itself.
      const other = createCredentialStore(ORIGIN, { platform: "darwin", home: f.home, lockProbe: async () => "unlocked", secrets: {
        get: async () => readFile(f.secretFile, "utf8").catch(() => null),
        set: async ({ value }) => { await writeFile(`${f.secretFile}.tmp`, value); await rename(`${f.secretFile}.tmp`, f.secretFile) },
        delete: async () => { await rm(f.secretFile, { force: true }); return true },
      } })
      const stored = await other.readAuthoritative()
      if (stored === null) throw new Error("missing stored credential")
      await other.write({ ...stored, [rotated]: keys()[rotated] })

      const outcomes = await Promise.all([
        keyring.sign({ purpose: "object-digest", digest: new Uint8Array(32) }).then(() => "admitted", () => "refused"),
        operation.pairing.setAccountSync(true).then(() => "admitted", () => "refused"),
        account.boundary(() => renameSync(pinFrom, pinTo)).then(() => "admitted", () => "refused"),
      ])
      expect(outcomes).toEqual(["refused", "refused", "refused"])
      expect(rawSigns).toBe(0)
      expect(served).toEqual([])
      expect(existsSync(pinTo)).toBe(false)
      expect(account.signal.aborted).toBe(true)
      await operation.close()
    }, 30_000)
  }

  test("#given a captured CLI account #when one authoritative read is transiently empty #then that read fails closed and the next resolve of the same generation is live", async () => {
    const f = await fixture()
    await f.store.write(credential("device-a"))
    const source = createCliAccountSource({ api: ORIGIN, store: f.store, home: f.home, fetch: identity("account-a", () => "device-a", []) })
    const first = await source()
    if (first === null) throw new Error("the fixture account did not resolve")

    f.blank(1)
    expect(await first.isCurrent()).toBe(false)
    expect(first.signal.aborted).toBe(true)

    const next = await source()
    expect(next?.descriptor.generation).toBe(first.descriptor.generation)
    expect(next?.signal.aborted).toBe(false)
    expect(await next?.isCurrent()).toBe(true)
    expect(await next?.boundary(() => "dispatched")).toBe("dispatched")
    await expect(first.boundary(() => "dispatched")).rejects.toThrow("no longer current")
  }, 30_000)

  test("#given a captured CLI account #when the device signs out #then the account is retired and the next resolve is signed out", async () => {
    const f = await fixture()
    await f.store.write(credential("device-a"))
    const source = createCliAccountSource({ api: ORIGIN, store: f.store, home: f.home, fetch: identity("account-a", () => "device-a", []) })
    const first = await source()
    if (first === null) throw new Error("the fixture account did not resolve")

    await f.store.clear()
    // The boundary observes the sign-out first, on its own read; isCurrent then sees it independently.
    await expect(first.boundary(() => "dispatched")).rejects.toThrow("no longer current")
    expect(await first.isCurrent()).toBe(false)
    expect(await first.signedOut()).toBe(true)
    expect(await source()).toBeNull()
    expect(first.signal.aborted).toBe(true)
  }, 30_000)

  // A key rotation through the store also stamps a new generation, so these rows write the stored item directly to
  // change exactly one of the two facts the capture compares.
  for (const changed of ["keys only", "generation only"] as const) {
    test(`#given a captured CLI account #when the stored credential changes its ${changed} #then the next boundary is refused`, async () => {
      const f = await fixture()
      await f.store.write(credential("device-a"))
      const account = await createCliAccountSource({ api: ORIGIN, store: f.store, home: f.home, fetch: identity("account-a", () => "device-a", []) })()
      if (account === null) throw new Error("the fixture account did not resolve")
      const stored = await f.store.readAuthoritative()
      if (stored === null) throw new Error("missing stored credential")
      const replaced: Credentials = changed === "keys only"
        ? { ...stored, ...keys() }
        : { ...stored, credentialGeneration: "another-generation" }
      await writeFile(f.secretFile, JSON.stringify(replaced))

      const outcome = await account.boundary(() => "dispatched").then(() => "admitted", () => "refused")
      expect(outcome).toBe("refused")
      expect(account.signal.aborted).toBe(true)
    }, 30_000)
  }

  test("#given no writer #when the same operations run #then each is admitted (same-identity control)", async () => {
    const f = await fixture()
    await f.store.write(credential("device-a"))
    const served: string[] = []
    const account = await createCliAccountSource({ api: ORIGIN, store: f.store, home: f.home, fetch: identity("account-a", () => "device-a", served) })()
    if (account === null) throw new Error("the fixture account did not resolve")
    const keyring = await account.keyring(deviceKeyringFromMaterial)
    const operation = await account.forOperation({ signal: new AbortController().signal, admit: effect => effect() })
    const stored = await f.store.read()
    if (stored === null) throw new Error("missing stored credential")
    await f.store.write({ ...stored, accessToken: "renewed", refreshToken: "renewed" })
    const pinFrom = join(f.home, "pin.tmp")
    await writeFile(pinFrom, "pin")
    expect((await keyring.sign({ purpose: "object-digest", digest: new Uint8Array(32) })).length).toBe(64)
    await operation.pairing.setAccountSync(true)
    await account.boundary(() => renameSync(pinFrom, join(f.home, "pin")))
    expect(served).toEqual(["/v1/account/sync"])
    expect(existsSync(join(f.home, "pin"))).toBe(true)
    await operation.close()
  }, 30_000)
})

describe("legacy credential capture", () => {
  for (const reply of ["the replacement's device", "the restored device"] as const) {
    test(`#given legacy A replaced by B while B's identity reply is held, then A restored #when the reply names ${reply} #then no capability is issued and A keeps no account`, async () => {
      const f = await fixture()
      const a = credential("device-a")
      await writeFile(f.secretFile, JSON.stringify(a))
      const other = createCredentialStore(ORIGIN, { platform: "darwin", home: f.home, lockProbe: async () => "unlocked", secrets: {
        get: async () => readFile(f.secretFile, "utf8").catch(() => null),
        set: async ({ value }) => { await writeFile(f.secretFile, value) },
        delete: async () => { await rm(f.secretFile, { force: true }); return true },
      } })
      let device = "device-a"
      const doFetch: typeof fetch = Object.assign(async (input: Parameters<typeof fetch>[0]) => {
        const path = new URL(String(input)).pathname
        if (path === "/v1/me") {
          const stamped = await other.read()
          if (stamped === null) throw new Error("missing stamped A")
          await other.write({ ...credential("device-b"), accountId: "account-b" })
          await other.write(stamped)
          if (reply === "the replacement's device") device = "device-b"
          return Response.json({ account: { id: "account-b" } })
        }
        if (path === "/v1/devices") return Response.json({ devices: [{ id: device, current: true, revokedAt: null }] })
        return Response.json({})
      }, { preconnect: fetch.preconnect })
      expect(await createCliAccountSource({ api: ORIGIN, store: f.store, home: f.home, fetch: doFetch })()).toBeNull()
      const stored = await f.store.read()
      expect(stored?.device.id).toBe("device-a")
      expect(stored?.accountId).toBeUndefined()
    }, 30_000)
  }
})
