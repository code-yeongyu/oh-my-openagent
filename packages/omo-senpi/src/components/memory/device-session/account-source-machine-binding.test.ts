// #6503 held-device binding on the memory-sync path: on a computer with only the CLI, the sync session is what refreshes
// the stored sign-in, so a refresh there binds the device to this machine. The binding goes through the fetch the
// source was given, the same one its own /v1/me and /v1/devices reads use.

import { expect, test } from "bun:test"
import { generateKeyPairSync, verify } from "node:crypto"
import { watch } from "node:fs"
import { mkdir, mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type { CredentialStore, Credentials } from "@oh-my-opencode/omo-opencode/service-auth"

import { createCliAccountSource } from "./account-source"

const DIGEST = "3c".repeat(32)
const ACCOUNT = "acct_ms"
const DEVICE = "dev_ms"

test("a sync refresh binds the CLI device to this machine once, through the source's own fetch", async () => {
  const root = await mkdtemp(join(tmpdir(), "ms-bind-"))
  const signing = generateKeyPairSync("ed25519")
  let refreshes = 0
  let value: Credentials | null = {
    accessToken: "access-0",
    accessTokenExpiresAt: "2000-01-01T00:00:00.000Z",
    refreshToken: "refresh-0",
    device: { id: DEVICE, name: "ms" },
    accountId: ACCOUNT,
    signingPrivateKey: signing.privateKey.export({ format: "der", type: "pkcs8" }).toString("base64"),
    sealingPrivateKey: generateKeyPairSync("x25519")
      .privateKey.export({ format: "der", type: "pkcs8" })
      .toString("base64"),
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
  const binds: { machineDigest: string; issuedAt: number; signature: string }[] = []
  const http = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      const path = new URL(request.url).pathname
      if (path === "/v1/session/refresh") {
        refreshes += 1
        // Every token is already expired, so the next resolve refreshes again.
        return Response.json({
          accessToken: `access-${refreshes}`,
          accessTokenExpiresAt: "2000-01-01T00:00:00.000Z",
          refreshToken: `refresh-${refreshes}`,
        })
      }
      if (path === "/v1/health")
        return Response.json({ status: "ok", capabilities: { machineIdentity: "hardware-digest-v1" } })
      if (path === "/v1/devices/current/machine" && request.method === "PUT") {
        binds.push((await request.json()) as (typeof binds)[number])
        return Response.json({ deviceId: DEVICE })
      }
      if (path === "/v1/me") return Response.json({ user: { id: "u" }, account: { id: ACCOUNT } })
      if (path === "/v1/devices") return Response.json({ devices: [{ id: DEVICE, current: true, revokedAt: null }] })
      return Response.json(
        { error: { code: "not_found", message: "x", retryable: false, requestId: "r" } },
        { status: 404 },
      )
    },
  })
  const viaSourceFetch: string[] = []
  const sourceFetch: typeof fetch = Object.assign(
    (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      viaSourceFetch.push(`${init?.method ?? "GET"} ${new URL(input instanceof Request ? input.url : input).pathname}`)
      return fetch(input, init)
    },
    { preconnect: fetch.preconnect },
  )
  const api = `http://127.0.0.1:${http.port}`
  // The binding runs after the token read answers; its recorded answer is the signal that it finished. The watch is
  // armed before the first resolve so the answer cannot land unseen.
  const home = join(root, "home")
  const accountState = join(home, ".omo", "account-state")
  await mkdir(accountState, { recursive: true })
  const watcher = watch(accountState)
  let timer: ReturnType<typeof setTimeout> | undefined
  const answered = new Promise<void>((resolve, reject) => {
    timer = setTimeout(() => reject(new Error("the machine binding answer was not recorded in 4 s")), 4_000)
    watcher.on("change", (_event, name) => {
      if (String(name).endsWith(".machine-binding.json")) {
        clearTimeout(timer)
        resolve()
      }
    })
  })
  try {
    const source = createCliAccountSource({
      api,
      store,
      home,
      logger: { warn: () => undefined },
      fetch: sourceFetch,
      machineDigest: async () => DIGEST,
    })

    expect((await source())?.serviceDeviceId).toBe(DEVICE)
    await answered
    expect(viaSourceFetch).toContain("PUT /v1/devices/current/machine")
    expect(binds).toHaveLength(1)
    const [bind] = binds
    expect(bind?.machineDigest).toBe(DIGEST)
    const bytes = new TextEncoder().encode(
      ["omo-machine-bind-v1", api, ACCOUNT, DEVICE, DIGEST, String(bind?.issuedAt)].join("\n"),
    )
    expect(verify(null, bytes, signing.publicKey, Buffer.from(bind?.signature ?? "", "base64url"))).toBe(true)

    // The next resolve refreshes again; the device is bound, so nothing more is sent about it.
    expect((await source())?.serviceDeviceId).toBe(DEVICE)
    expect(refreshes).toBeGreaterThanOrEqual(2)
    expect(binds).toHaveLength(1)
  } finally {
    clearTimeout(timer)
    watcher.close()
    http.stop(true)
    await rm(root, { recursive: true, force: true })
  }
})
