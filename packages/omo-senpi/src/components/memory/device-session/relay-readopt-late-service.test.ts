import { afterEach, expect, test } from "bun:test"
import { generateKeyPairSync } from "node:crypto"
import { chmodSync, mkdirSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { connectDeviceService } from "@oh-my-opencode/device-service-core"
import type { CredentialStore, Credentials } from "@oh-my-opencode/omo-opencode/service-auth"

import { startFakeOwner, type FakeOwner } from "../../../../../device-service-core/test/local-api/conformance/fake-owner.ts"
import { defaultWorld } from "../../../../../device-service-core/test/local-api/conformance/world.ts"
import { createCliAccountSource } from "./account-source"
import { engineDeviceService } from "./account-runtime"

// Design D r9 section 3: a check that finds no running relayd is not a hand-over. The engine's device service relay
// re-adopts on the next resolve after relayd starts, once, from the credential the session already holds.

const owners: FakeOwner[] = []
const dirs: string[] = []
afterEach(async () => {
  for (const owner of owners.splice(0)) await owner.stop()
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

const stored: Credentials = {
  accessToken: "access-1",
  accessTokenExpiresAt: new Date(Date.now() + 3_600_000).toISOString(),
  refreshToken: "refresh-1",
  device: { id: "dev_service_row", name: "laptop" },
  signingPrivateKey: generateKeyPairSync("ed25519").privateKey.export({ format: "der", type: "pkcs8" }).toString("base64"),
  sealingPrivateKey: generateKeyPairSync("x25519").privateKey.export({ format: "der", type: "pkcs8" }).toString("base64"),
  accountId: "acct_42",
  credentialGeneration: "gen-a",
}

const store: CredentialStore = {
  read: async () => stored,
  readAuthoritative: async () => stored,
  write: async () => undefined,
  clear: async () => undefined,
}

const service: typeof fetch = Object.assign(async (input: Parameters<typeof fetch>[0]) => {
  if (String(input).endsWith("/v1/devices")) return Response.json({ devices: [{ id: "dev_service_row", current: true, revokedAt: null }] })
  if (String(input).endsWith("/v1/me")) return Response.json({ user: { id: "u" }, account: { id: "acct_42" } })
  return new Response("{}", { status: 404 })
}, { preconnect: fetch.preconnect })

test("no relayd at the first resolve: the next resolve after it starts re-adopts once", async () => {
  const dir = mkdtempSync(join(tmpdir(), "omo-late-relayd-"))
  chmodSync(dir, 0o700)
  dirs.push(dir)
  const stateDir = join(dir, "ds")
  const relay = engineDeviceService(stateDir, () => connectDeviceService({ version: "5.1.60", stateDir }))
  const source = createCliAccountSource({ api: "http://127.0.0.1:9", store, fetch: service, relay, logger: { warn: () => undefined } })

  expect((await source())?.accountId).toBe("acct_42")

  mkdirSync(stateDir, { recursive: true, mode: 0o700 })
  const world = defaultWorld()
  const owner = await startFakeOwner({
    stateDir,
    world: { ...world, service_version: "0.1.3", status: { ...world.status, device: null, state: "sign_in_required" } },
  })
  owners.push(owner)

  await source()
  expect(owner.state.log).toEqual(["status.get", "device.adopt"])
  expect(owner.state.adoptRequests.map(request => request["account"])).toEqual(["acct_42"])

  await source()
  expect(owner.state.log).toEqual(["status.get", "device.adopt"])
})
