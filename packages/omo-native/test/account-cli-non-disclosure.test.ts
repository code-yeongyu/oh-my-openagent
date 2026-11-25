import { afterAll, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  type CredentialStore,
  KeychainLockedError,
  SecretServiceUnavailableError,
} from "../../account-core/src/keystore"
import { CANARIES } from "../../omo-senpi/src/components/omo-sdk/root/account-canaries.test-support"
import { leaked } from "../../omo-senpi/src/components/omo-sdk/root/account-canary-scan.test-support"
import { runAccountVerb } from "../account-cli"

// Security design section 6 on the production CLI adapter (review 6065026586, L7): what `omo account` prints on stdout
// and stderr, rendered by the real verbs over a store and an account service whose secrets are canaries, holds none of
// them, on the ok paths, the refusals and each fault the verbs meet. A store fault carries the store's own fixed words,
// as the real store's errors do.

const homes: string[] = []
afterAll(() => {
  for (const home of homes) rmSync(home, { recursive: true, force: true })
})

const canaryCredential = {
  accessToken: CANARIES.accessToken,
  accessTokenExpiresAt: "2099-01-01T00:00:00.000Z",
  refreshToken: CANARIES.refreshToken,
  offlineGrant: CANARIES.offlineGrant,
  device: { id: "canary-device", name: "Canary CLI" },
  signingPrivateKey: CANARIES.signingPrivateKey,
  sealingPrivateKey: CANARIES.sealingPrivateKey,
}

type Fault = "none" | "service_error_body" | "unauthorized" | "store_locked" | "store_unavailable"

function storeFor(fault: Fault): CredentialStore {
  let value: typeof canaryCredential | null = canaryCredential
  const read = async () => {
    if (fault === "store_locked") throw new KeychainLockedError("The login keychain is locked.")
    if (fault === "store_unavailable") throw new SecretServiceUnavailableError("No system keychain is available.")
    return value
  }
  return {
    read,
    readAuthoritative: read,
    write: async (next) => {
      value = next as typeof canaryCredential
    },
    clear: async () => {
      value = null
    },
  }
}

function serviceFor(fault: Fault): string {
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch(request) {
      const path = new URL(request.url).pathname
      if (fault === "service_error_body")
        return Response.json({ error: { message: `upstream ${CANARIES.accessToken}` } }, { status: 500 })
      if (fault === "unauthorized") return Response.json({ error: { code: "invalid_token" } }, { status: 401 })
      if (path === "/v1/me") return Response.json({ user: { email: "canary@example.com" }, account: { id: "acct-1" } })
      if (path === "/v1/devices") return Response.json({ devices: [], browsers: [] })
      return new Response(null, { status: 204 })
    },
  })
  afterAll(() => server.stop(true))
  return server.url.origin
}

async function render(fault: Fault, args: readonly string[]) {
  const home = mkdtempSync(join(tmpdir(), "omo-account-canary-"))
  homes.push(home)
  const out: string[] = []
  const err: string[] = []
  const code = await runAccountVerb(
    {
      api: serviceFor(fault),
      store: storeFor(fault),
      home,
      pinDir: () => join(home, "sync-device"),
      readStdin: async () => "",
      output: (line) => out.push(line),
      error: (line) => err.push(line),
    },
    args,
  )
  return { code, out, err }
}

const VERBS: readonly (readonly string[])[] = [
  ["show"],
  ["show", "--account", "acct-1"],
  ["forget", "--device", "other-device"],
  ["forget", "--device", ""],
  ["sign-in", "--check"],
  ["devices"],
  ["forget"],
]

describe("omo account prints no planted secret (#14945 section 6, #14364)", () => {
  for (const fault of ["none", "service_error_body", "unauthorized", "store_locked", "store_unavailable"] as const)
    for (const args of VERBS)
      test(`#given ${fault} #when omo account ${args.join(" ")} runs #then stdout and stderr hold no canary`, async () => {
        const { out, err } = await render(fault, args)
        expect(leaked([out, err])).toEqual([])
      })

  test("#given a canary printed on stderr #then the scan names it", () => {
    expect(leaked([[], [`token ${CANARIES.refreshToken}`]])).toEqual(["refreshToken"])
  })
})
