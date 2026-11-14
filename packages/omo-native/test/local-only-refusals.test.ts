// Security contract (omo#13440, design v7 section 9): while a process is marked local-only, each of the four network
// call sites this repo owns on the `omo remote` path refuses with LocalOnlyNetworkRefused naming its site, BEFORE any
// I/O (no request, no credential-store write, no download), and an unmarked process is untouched. Each site is driven
// through its real entry point with the I/O it would perform observed, so a refusal moved after the I/O fails here.
import { afterEach, describe, expect, mock, onTestFinished, spyOn, test } from "bun:test"
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { deviceServiceEndpointPath } from "../../device-service-core/src/device-service.ts"
import { LocalOnlyNetworkRefused, markLocalOnlyProcess } from "../../device-service-core/src/local-only.ts"
import { acquireDeviceService } from "../../device-service-core/src/release/acquire.ts"
import { ENGINE_VERSION, PIN_VERSION, RELEASE_ORIGIN } from "../../device-service-core/test/release-fixture.ts"
import type { CredentialStore } from "../../omo-opencode/src/cli/service-auth/keystore"
import type { Credentials } from "../../omo-opencode/src/cli/service-auth/protocol"
import { requestApi } from "../../omo-opencode/src/cli/service-auth/protocol-request"
import { createSession } from "../../omo-opencode/src/cli/service-auth/session"
import { fakeApi, grant, privateKeys, temporaryHome } from "../../omo-opencode/src/cli/service-auth/test-support"
import { cliDeviceServiceHandoff } from "../device-service-handoff"

const dirs: string[] = []
afterEach(() => {
  const holder = globalThis as { [key: symbol]: { marked: boolean } | undefined }
  const mark = holder[Symbol.for("omo.local-only-process.v1")]
  if (mark !== undefined) mark.marked = false
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

const privateDir = (): string => {
  const dir = mkdtempSync(join(tmpdir(), "omo-local-only-"))
  chmodSync(dir, 0o700)
  dirs.push(dir)
  return dir
}

async function refusal(run: () => Promise<unknown>): Promise<unknown> {
  try {
    await run()
  } catch (error) {
    return error
  }
  return undefined
}

const NOW = Date.parse("2030-01-01T00:00:00Z")
const expired: Credentials = {
  ...grant,
  ...privateKeys,
  accountId: "account-a",
  credentialGeneration: "generation-a",
  accessTokenExpiresAt: new Date(NOW - 1).toISOString(),
}

async function refreshHarness() {
  let current: Credentials | null = expired
  const refresh = mock(async () => Response.json({ ...grant, accessToken: "refreshed-access" }))
  const store = {
    read: mock(async () => current),
    readAuthoritative: mock(async () => current),
    write: mock(async (value: Credentials) => {
      current = value
    }),
    clear: mock(async () => {
      current = null
    }),
  } satisfies CredentialStore
  const session = createSession({
    beforeKeysDiscarded: async () => undefined,
    api: fakeApi(refresh),
    store,
    home: await temporaryHome(),
    now: () => NOW,
  })
  return { session, store, refresh }
}

describe("local-only refusals at the owned network call sites", () => {
  test("#given a marked process #when requestApi is called #then it refuses before fetching", async () => {
    // given
    const fetched = spyOn(globalThis, "fetch")
    onTestFinished(() => fetched.mockRestore())
    markLocalOnlyProcess()

    // when
    const error = await refusal(() => requestApi("https://api.example.test", "/v1/me", { method: "GET" }))

    // then
    expect(error).toBeInstanceOf(LocalOnlyNetworkRefused)
    expect(error).toMatchObject({ site: "service-auth/protocol-request.ts requestApi" })
    expect(fetched).not.toHaveBeenCalled()
  })

  test("#given an unmarked process #when requestApi is called #then the request is sent", async () => {
    // given
    const fetched = spyOn(globalThis, "fetch").mockResolvedValue(Response.json({}))
    onTestFinished(() => fetched.mockRestore())

    // when
    const error = await refusal(() => requestApi("https://api.example.test", "/v1/me", { method: "GET" }))

    // then
    expect(error).not.toBeInstanceOf(LocalOnlyNetworkRefused)
    expect(fetched).toHaveBeenCalledTimes(1)
  })

  test("#given a marked process and an expired token #when the session refreshes #then it refuses before the store write and the request", async () => {
    // given
    const h = await refreshHarness()
    markLocalOnlyProcess()

    // when
    const error = await refusal(() => h.session.accessToken(() => true))

    // then
    expect(error).toBeInstanceOf(LocalOnlyNetworkRefused)
    expect(error).toMatchObject({ site: "service-auth/session.ts refresh" })
    expect(h.store.write).not.toHaveBeenCalled()
    expect(h.refresh).not.toHaveBeenCalled()
  })

  test("#given an unmarked process and an expired token #when the session refreshes #then it refreshes", async () => {
    // given
    const h = await refreshHarness()

    // when
    const token = await h.session.accessToken(() => true)

    // then
    expect(token).toBe("refreshed-access")
    expect(h.refresh).toHaveBeenCalledTimes(1)
  })

  for (const marked of [true, false])
    test(`#given a ${marked ? "marked" : "unmarked"} process #when a device service release is acquired #then ${marked ? "it refuses before any download" : "the download is attempted"}`, async () => {
      // given
      const fetched = mock(async () => new Response("", { status: 404 }))
      if (marked) markLocalOnlyProcess()

      // when
      const error = await refusal(() =>
        acquireDeviceService({
          version: PIN_VERSION,
          host: "linux-x64",
          stateDir: join(privateDir(), "device-service"),
          engineVersion: ENGINE_VERSION,
          origin: RELEASE_ORIGIN,
          fetch: fetched,
        }),
      )

      // then
      if (marked) {
        expect(error).toBeInstanceOf(LocalOnlyNetworkRefused)
        expect(error).toMatchObject({ site: "device-service-core/release/acquire.ts acquireDeviceService" })
        expect(fetched).not.toHaveBeenCalled()
      } else {
        expect(error).toBeUndefined()
        expect(fetched).toHaveBeenCalled()
      }
    })

  for (const marked of [true, false])
    test(`#given a ${marked ? "marked" : "unmarked"} process and a running service #when a sign-in without an account id is handed over #then ${marked ? "the account read refuses before fetching" : "the account is fetched"}`, async () => {
      // given
      const stateDir = join(privateDir(), "device-service")
      const endpoint = deviceServiceEndpointPath(stateDir)
      mkdirSync(dirname(endpoint), { recursive: true, mode: 0o700 })
      writeFileSync(endpoint, "")
      const fetched = mock(async () => new Response("", { status: 500 }))
      const lines: string[] = []
      const handoff = cliDeviceServiceHandoff({
        api: "https://api.example.test",
        log: (line) => lines.push(line),
        stateDir,
        connect: async () => {
          throw new Error("not reached in this test")
        },
        fetch: Object.assign(fetched, { preconnect: fetch.preconnect }),
      })
      if (marked) markLocalOnlyProcess()

      // when
      await handoff.adopt({ ...expired, accountId: undefined })

      // then
      if (marked) {
        expect(fetched).not.toHaveBeenCalled()
        expect(lines.join("\n")).toContain("omo-native/device-service-handoff.ts accountOf")
      } else expect(fetched).toHaveBeenCalledTimes(1)
    })
})
