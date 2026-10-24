import { afterEach, describe, expect, onTestFinished, spyOn, test } from "bun:test"
import { execFileSync } from "node:child_process"
import { createPrivateKey, createPublicKey, generateKeyPairSync } from "node:crypto"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { buildIdentityPaths } from "@oh-my-opencode/memory-core"
import { createDeviceKeyring } from "@oh-my-opencode/memory-core/keyring"
import { deviceKeyringFromMaterial } from "@oh-my-opencode/memory-core/sync-engine"
import type { AccountSessionOptions, SyncSession } from "@oh-my-opencode/memory-core/sync-engine"
import { type CredentialStore, type Credentials, SignInError } from "@oh-my-opencode/omo-opencode/service-auth"

import * as syncRuntime from "../sync-runtime"
import { createCliAccountSource, type DeviceAccount } from "./account-source"
import { createDeviceSessionResolver } from "./resolver"

const dirs: string[] = []
afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true })
})

function credentials(): Credentials {
  const signing = generateKeyPairSync("ed25519")
  const sealing = generateKeyPairSync("x25519")
  return {
    accessToken: "access-1",
    accessTokenExpiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    refreshToken: "refresh-1",
    device: { id: "dev_service_row", name: "laptop" },
    signingPrivateKey: signing.privateKey.export({ format: "der", type: "pkcs8" }).toString("base64"),
    sealingPrivateKey: sealing.privateKey.export({ format: "der", type: "pkcs8" }).toString("base64"),
  }
}

function memoryStore(initial: Credentials | null): CredentialStore & { clear(): Promise<void> } {
  let value = initial
  return {
    read: async () => value,
    write: async (next) => {
      value = next
    },
    clear: async () => {
      value = null
    },
  }
}

function sealedAuthority(store: CredentialStore): void {
  const get = spyOn(Bun.secrets, "get").mockImplementation(async ({ service }) => {
    if (service !== "omo-cli-v2") return null
    const current = await store.read()
    return current === null ? null : JSON.stringify({ version: 2, active: {
      ...current, writerFloor: 2, owner: {
        accountId: "acct_42", deviceId: current.device.id, familyId: `family-${current.device.id}`,
        generation: 1, ownerHandle: `owner-${current.device.id}`,
      },
    } })
  })
  const set = spyOn(Bun.secrets, "set").mockImplementation(async () => { throw new Error("Unexpected native write") })
  const remove = spyOn(Bun.secrets, "delete").mockImplementation(async () => { throw new Error("Unexpected native delete") })
  onTestFinished(() => { get.mockRestore(); set.mockRestore(); remove.mockRestore() })
}

const meReply = (accountId: string): typeof fetch =>
  Object.assign(async (input: Parameters<typeof fetch>[0]) => {
    if (!String(input).endsWith("/v1/me")) return new Response("{}", { status: 404 })
    return Response.json({ user: { id: "u" }, account: { id: accountId }, deviceId: "dev_service_row" })
  }, { preconnect: fetch.preconnect })

describe("the CLI device account source", () => {
  test("a signed-out device answers null", async () => {
    const store = memoryStore(null)
    sealedAuthority(store)
    expect(await createCliAccountSource({ api: "http://127.0.0.1:9", store, fetch: meReply("acct") })()).toBeNull()
  })

  test("a host whose OS credential store cannot be used reads as signed out, not as a failure", async () => {
    const locked: CredentialStore = {
      read: async () => {
        throw new SignInError("Cannot access the OS credential store.")
      },
      write: async () => undefined,
      clear: async () => undefined,
    }
    sealedAuthority(locked)
    expect(await createCliAccountSource({ api: "http://127.0.0.1:9", store: locked, fetch: meReply("acct") })()).toBeNull()
  })

  test("a signed-in device names its account and builds its keyring from the keys it registered at sign-in", async () => {
    const stored = credentials()
    const store = memoryStore(stored)
    sealedAuthority(store)
    const account = await createCliAccountSource({ api: "http://127.0.0.1:9", store, fetch: meReply("acct_42") })()
    if (account === null) throw new Error("signed in, yet no account")
    expect(account.accountId).toBe("acct_42")
    expect(await account.accessToken()).toBe("access-1")
    const keyring = await account.keyring(deviceKeyringFromMaterial)
    const registered = createPublicKey(createPrivateKey({ key: Buffer.from(stored.signingPrivateKey, "base64"), format: "der", type: "pkcs8" })).export({ format: "jwk" }).x
    if (registered === undefined) throw new Error("the registered key has no public half")
    expect(keyring.publicKeys().signing).toBe(registered)
    expect(keyring.principal().id).not.toBe(stored.device.id)
    expect(await account.signedOut()).toBe(false)
    await store.write({ ...stored, device: { id: "another-device", name: "another" } })
    expect(await account.signedOut()).toBe(true)
    await expect(account.accessToken()).rejects.toBeInstanceOf(SignInError)
    await store.clear()
    expect(await account.signedOut()).toBe(true)
  })
})

async function repoWithRemote(): Promise<{ readonly paths: ReturnType<typeof buildIdentityPaths>; readonly project: string }> {
  const root = await mkdtemp(join(tmpdir(), "omo-device-session-"))
  dirs.push(root)
  const paths = buildIdentityPaths(join(root, "memory"), "agent")
  const project = join(root, "project")
  for (const dir of [paths.repo, project]) execFileSync("git", ["init", "-q", dir], { windowsHide: true })
  execFileSync("git", ["-C", project, "remote", "add", "origin", "git@github.com:acme/widgets.git"], { windowsHide: true })
  return { paths, project }
}

function fakeAccount(overrides: Partial<DeviceAccount> = {}): DeviceAccount {
  const material = credentials()
  return {
    api: "http://127.0.0.1:9",
    accountId: "acct_7",
    keyring: async () => createDeviceKeyring("principal", { signingPrivatePkcs8: Buffer.from(material.signingPrivateKey, "base64").toString("base64url"), sealingPrivatePkcs8: Buffer.from(material.sealingPrivateKey, "base64").toString("base64url") }),
    accessToken: async () => "token",
    signedOut: async () => false,
    ...overrides,
  }
}

describe("the device session resolver", () => {
  const resolverWith = (account: DeviceAccount | null, opened: { ok: true; session: SyncSession } | { ok: false; reason: "no_pin" | "not_member" | "corrupt_pin" }) => {
    const calls: AccountSessionOptions[] = []
    const resolve = createDeviceSessionResolver({
      source: async () => account,
      pinDir: "/pins",
      loadRuntime: async () => ({
        ...syncRuntime,
        openAccountSession: async (options) => {
          calls.push(options)
          return opened
        },
      }),
    })
    return { resolve, calls }
  }

  test("a project memory resolves to the same space on every device: the one its git remote names", async () => {
    const { paths, project } = await repoWithRemote()
    const { resolve, calls } = resolverWith(fakeAccount(), { ok: false, reason: "no_pin" })
    expect(await resolve({ identity: "agent", paths, space: { profile: "auto", projectDir: project } })).toEqual({ idle: "no_pin" })
    const expected = syncRuntime.resolveSpace({ get: () => null, set: () => undefined }, { remotes: [{ name: "origin", url: "https://github.com/acme/widgets" }] }).spaceId
    expect(Buffer.from(calls[0]?.spaceId ?? []).toString("hex")).toBe(expected)
    expect(calls[0]).toMatchObject({ account: "acct_7", pinDir: "/pins" })
  })

  test("a signed-out device opens nothing", async () => {
    const { paths, project } = await repoWithRemote()
    const { resolve, calls } = resolverWith(null, { ok: false, reason: "no_pin" })
    expect(await resolve({ identity: "agent", paths, space: { profile: "auto", projectDir: project } })).toBeNull()
    expect(calls).toEqual([])
  })

  test("a token request failing after sign-out ends the session; one failing while still signed in does not", async () => {
    const { paths, project } = await repoWithRemote()
    let signedOut = false
    const account = fakeAccount({
      accessToken: async () => {
        throw new Error("Not signed in. Run omo login.")
      },
      signedOut: async () => signedOut,
    })
    const session = { transport: {}, verifier: {}, sealer: {} } as unknown as SyncSession
    const { resolve, calls } = resolverWith(account, { ok: true, session })
    const resolved = await resolve({ identity: "agent", paths, space: { profile: "auto", projectDir: project } })
    if (resolved === null || "idle" in resolved) throw new Error("expected a session")
    let ended = 0
    resolved.onEnded?.(() => {
      ended += 1
    })
    const token = calls[0]?.token
    if (token === undefined) throw new Error("no token callback")
    await expect(Promise.resolve(token())).rejects.toThrow("Not signed in")
    expect(ended).toBe(0)
    signedOut = true
    await expect(Promise.resolve(token())).rejects.toThrow("Not signed in")
    expect(ended).toBe(1)
  })
})
