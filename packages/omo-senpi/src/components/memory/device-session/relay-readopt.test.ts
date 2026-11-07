import { describe, expect, test } from "bun:test"
import { generateKeyPairSync } from "node:crypto"

import type { HeldDeviceCredential } from "@oh-my-opencode/device-service-core"
import type { CredentialStore, Credentials } from "@oh-my-opencode/omo-opencode/service-auth"

import { createCliAccountSource, type HeldCredentialRelay } from "./account-source"

// Design D r9 section 3 (r7 N8r, r8): the memory device session already reads the credential for its own sync work;
// when the device service reports no adopted device it re-sends device.adopt from THAT in-memory credential. The
// relay path adds zero credential store reads of its own.

function credentials(generation: string): Credentials {
  return {
    accessToken: "access-1",
    accessTokenExpiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    refreshToken: "refresh-1",
    device: { id: "dev_service_row", name: "laptop" },
    signingPrivateKey: generateKeyPairSync("ed25519").privateKey.export({ format: "der", type: "pkcs8" }).toString("base64"),
    sealingPrivateKey: generateKeyPairSync("x25519").privateKey.export({ format: "der", type: "pkcs8" }).toString("base64"),
    accountId: "acct_42",
    credentialGeneration: generation,
  }
}

/** Counts every store read: the instrumented credential store of design D's PR 4 test. */
function countingStore(initial: Credentials | null) {
  let value = initial
  const reads = { count: 0 }
  const store: CredentialStore = {
    read: async () => { reads.count += 1; return value },
    readAuthoritative: async () => { reads.count += 1; return value },
    write: async next => { value = next },
    clear: async () => { value = null },
  }
  return { store, reads }
}

const service: typeof fetch = Object.assign(async (input: Parameters<typeof fetch>[0]) => {
  if (String(input).endsWith("/v1/devices")) return Response.json({ devices: [{ id: "dev_service_row", current: true, revokedAt: null }] })
  if (String(input).endsWith("/v1/me")) return Response.json({ user: { id: "u" }, account: { id: "acct_42" } })
  return new Response("{}", { status: 404 })
}, { preconnect: fetch.preconnect })

function recordingRelay(failure?: Error) {
  const held: HeldDeviceCredential[] = []
  const relay: HeldCredentialRelay = {
    readopt: async credential => {
      held.push(credential)
      if (failure !== undefined) throw failure
      return true
    },
    forget: async () => undefined,
  }
  return { relay, held }
}

describe("the memory device session re-adopts from its held credential", () => {
  test("the held account and keys are handed over with zero extra credential store reads", async () => {
    const stored = credentials("gen-a")
    const baseline = countingStore(stored)
    expect(await createCliAccountSource({ api: "http://127.0.0.1:9", store: baseline.store, fetch: service })()).not.toBeNull()
    const instrumented = countingStore(stored)
    const { relay, held } = recordingRelay()
    expect(await createCliAccountSource({ api: "http://127.0.0.1:9", store: instrumented.store, fetch: service, relay })()).not.toBeNull()
    expect(held).toEqual([{
      device: stored.device, account: "acct_42",
      signingPrivateKey: stored.signingPrivateKey, sealingPrivateKey: stored.sealingPrivateKey,
    }])
    expect(instrumented.reads.count).toBe(baseline.reads.count)
  })

  test("one hand-over per credential generation, not one per resolve", async () => {
    const { store } = countingStore(credentials("gen-a"))
    const { relay, held } = recordingRelay()
    const source = createCliAccountSource({ api: "http://127.0.0.1:9", store, fetch: service, relay })
    await source()
    await source()
    expect(held).toHaveLength(1)
  })

  test("a failed hand-over is retried on the next resolve, then not again once it succeeds", async () => {
    const { store } = countingStore(credentials("gen-a"))
    const attempts: string[] = []
    let down = true
    const relay: HeldCredentialRelay = {
      readopt: async () => {
        attempts.push(down ? "failed" : "adopted")
        if (down) throw new Error("relayd down")
        return true
      },
      forget: async () => undefined,
    }
    const source = createCliAccountSource({ api: "http://127.0.0.1:9", store, fetch: service, relay, logger: { warn: () => undefined } })
    expect((await source())?.accountId).toBe("acct_42")
    down = false
    await source()
    await source()
    expect(attempts).toEqual(["failed", "adopted"])
  })

  test("a signed-out device hands nothing over", async () => {
    const { store } = countingStore(null)
    const { relay, held } = recordingRelay()
    expect(await createCliAccountSource({ api: "http://127.0.0.1:9", store, fetch: service, relay })()).toBeNull()
    expect(held).toEqual([])
  })

  test("a failing device service never fails memory sync, and is reported", async () => {
    const { store } = countingStore(credentials("gen-a"))
    const { relay } = recordingRelay(new Error("relayd refused"))
    const warnings: string[] = []
    const account = await createCliAccountSource({ api: "http://127.0.0.1:9", store, fetch: service, relay, logger: { warn: line => warnings.push(line) } })()
    expect(account?.accountId).toBe("acct_42")
    expect(warnings.some(line => line.includes("relayd refused"))).toBe(true)
  })
})
