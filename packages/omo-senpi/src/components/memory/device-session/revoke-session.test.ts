// #12280 R-B1: a CLI device whose sign-in ends on the service retires its memory-sync trust pin when
// its keys are discarded, so a later join pins only through a ceremony. The production chain: the real
// createCliAccountSource -> createDeviceSessionResolver -> createSyncRunner, a fake credential store,
// and the service on a real socket answering the refresh.

import { expect, test } from "bun:test"
import { execFileSync } from "node:child_process"
import { createHash, generateKeyPairSync } from "node:crypto"
import { chmod, type FileHandle, mkdir, mkdtemp, open, readdir, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { buildIdentityPaths } from "@oh-my-opencode/memory-core"
import type { SyncSession } from "@oh-my-opencode/memory-core/sync-engine"
import type { CredentialStore, Credentials } from "@oh-my-opencode/omo-opencode/service-auth"

import * as syncRuntime from "../sync-runtime"
import { createSyncRunner } from "../sync-runner"
import { createCliAccountSource } from "./account-source"
import { createDeviceSessionResolver } from "./resolver"

const ACCOUNT = "acct_revoked"

const refusal = (code: string, onContract: boolean) =>
  Response.json(
    { error: { code, message: code, retryable: false, ...(onContract ? { requestId: "req_r_b1" } : {}) } },
    { status: 401 },
  )

/** A bound device whose next token read meets `code` at refresh; returns what it kept afterwards. */
async function revokedDevice(
  code: string,
  options: { readonly onContract?: boolean; readonly lockPinRoot?: boolean } = {},
) {
  const root = await mkdtemp(join(tmpdir(), "r-b1-"))
  const signing = generateKeyPairSync("ed25519")
  const sealing = generateKeyPairSync("x25519")
  let value: Credentials | null = {
    accessToken: "access-1",
    accessTokenExpiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    refreshToken: "refresh-1",
    device: { id: "dev_b1", name: "b1" },
    signingPrivateKey: signing.privateKey.export({ format: "der", type: "pkcs8" }).toString("base64"),
    sealingPrivateKey: sealing.privateKey.export({ format: "der", type: "pkcs8" }).toString("base64"),
  }
  const store: CredentialStore = {
    read: async () => value,
    readAuthoritative: async () => value,
    write: async (next) => {
      value = next
    },
    clear: async () => {
      value = null
    },
  }
  const http = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(req) {
      const path = new URL(req.url).pathname
      if (path === "/v1/me") return Response.json({ user: { id: "u" }, account: { id: ACCOUNT } })
      if (path === "/v1/devices") return Response.json({ devices: [{ id: "dev_b1", current: true, revokedAt: null }] })
      if (path === "/v1/session/refresh") return refusal(code, options.onContract ?? true)
      return new Response("{}", { status: 404 })
    },
  })
  const pinDir = join(root, "memory", "sync-device")
  const pinParent = join(pinDir, "trust-anchor")
  const pinFile = join(pinParent, createHash("sha256").update(ACCOUNT, "utf8").digest("base64url"), "pin.json")
  await mkdir(join(pinFile, ".."), { recursive: true })
  await writeFile(
    pinFile,
    `${JSON.stringify({ version: 1, account: ACCOUNT, genesis_digest: "x", pinned_by: "pairing", pinned_at: { seq: 2, keyring_link: "y" } })}\n`,
  )
  const logs: string[] = []
  const source = createCliAccountSource({
    api: `http://127.0.0.1:${http.port}`,
    store,
    home: join(root, "home"),
    pinDir,
    logger: { warn: (line) => logs.push(line) },
    fetch: Object.assign((input: Parameters<typeof fetch>[0], init?: RequestInit) => fetch(input, init), {
      preconnect: fetch.preconnect,
    }),
  })
  let tokenFn: (() => Promise<string>) | undefined
  const closed = Promise.withResolvers<void>()
  const runner = createSyncRunner({
    logger: { info: () => undefined, warn: () => undefined, error: () => undefined },
    resolveSession: createDeviceSessionResolver({
      source,
      pinDir,
      loadRuntime: async () => ({
        ...syncRuntime,
        openAccountSession: async (o) => ({ ok: true, session: { token: o.token } as unknown as SyncSession }),
      }),
    }),
    open: async (o) => {
      tokenFn = (o.session as unknown as { token: () => Promise<string> }).token
      return {
        engine: { start: () => undefined },
        notifyLocalCommit: () => undefined,
        close: async () => closed.resolve(),
      } as never
    },
    watchHead: () => () => undefined,
  })
  const paths = buildIdentityPaths(join(root, "memory"), "agent")
  const project = join(root, "project")
  for (const dir of [paths.repo, project]) execFileSync("git", ["init", "-q", dir])
  try {
    await runner.acquire("agent", paths, { enabled: true }, { profile: "auto", projectDir: project })
    expect(tokenFn).toBeDefined()
    if (value !== null) value = { ...value, accessTokenExpiresAt: new Date(Date.now() - 1_000).toISOString() }
    // A pin that cannot be renamed: POSIX refuses the rename in a read-only parent; Windows ignores those
    // mode bits but refuses to rename a directory while a file inside it is open.
    let held: FileHandle | undefined
    if (options.lockPinRoot === true) {
      if (process.platform === "win32") held = await open(pinFile, "r")
      else await chmod(pinParent, 0o500)
    }
    const token = await tokenFn?.().then(
      () => "token",
      (error: unknown) => (error instanceof Error ? error.name : "thrown"),
    )
    if (options.lockPinRoot === true) {
      if (held !== undefined) await held.close()
      else await chmod(pinParent, 0o700)
    }
    const pinKept = await readFile(pinFile, "utf8").then(
      () => true,
      () => false,
    )
    const retired = (await readdir(pinParent)).filter((name) => name.includes(".retired-"))
    return { token, keysKept: value !== null, pinKept, retired: retired.length, logs }
  } finally {
    http.stop(true)
    await rm(root, { recursive: true, force: true })
  }
}

for (const code of ["device_revoked", "account_deleted", "reauth_required", "unauthorized", "invalid_grant"]) {
  test(`#given a bound CLI device #when its refresh is refused ${code} #then its keys are discarded and its pin is retired by rename`, async () => {
    expect(await revokedDevice(code)).toMatchObject({ keysKept: false, pinKept: false, retired: 1 })
  }, 30_000)
}

test("#given an off-contract 401 without a requestId #when the refresh meets it #then keys and pin are both kept", async () => {
  expect(await revokedDevice("device_revoked", { onContract: false })).toMatchObject({
    keysKept: true,
    pinKept: true,
    retired: 0,
  })
}, 30_000)

test("#given a pin that cannot be renamed #when the refresh is refused #then the sign-in still ends and the keys are still discarded, with one log line", async () => {
  const outcome = await revokedDevice("device_revoked", { lockPinRoot: true })
  expect(outcome).toMatchObject({ token: "SignInError", keysKept: false, pinKept: true, retired: 0 })
  expect(outcome.logs.filter((line) => line.includes("sync pin could not be retired"))).toHaveLength(1)
}, 30_000)
