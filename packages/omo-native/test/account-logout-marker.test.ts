import { afterAll, describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"

import { credentialId, type CredentialStore } from "../../omo-opencode/src/cli/service-auth/keystore"
import type { Credentials } from "../../omo-opencode/src/cli/service-auth/protocol"
import { createSession } from "../../omo-opencode/src/cli/service-auth/session"
import { signedOutMarkerPath } from "../../omo-opencode/src/cli/service-auth/signed-out-marker"
import { ACCOUNT_EXIT, runAccountVerb } from "../account-cli"

const homes: string[] = []
afterAll(() => {
  for (const home of homes) rmSync(home, { recursive: true, force: true })
})

const credential = (deviceId: string): Credentials => ({
  accessToken: `at-${deviceId}`,
  accessTokenExpiresAt: new Date(Date.now() + 3_600_000).toISOString(),
  refreshToken: `rt-${deviceId}`,
  device: { id: deviceId, name: `device ${deviceId}` },
  signingPrivateKey: "c2lnbmluZw==",
  sealingPrivateKey: "c2VhbGluZw==",
})

function memoryStore(initial: Credentials | null, onClear: () => void): CredentialStore {
  let value = initial
  return {
    read: async () => value,
    readAuthoritative: async () => value,
    write: async next => {
      value = next
    },
    clear: async () => {
      onClear()
      value = null
    },
  }
}

function machine(initial: Credentials | null) {
  const home = mkdtempSync(join(tmpdir(), "omo-logout-marker-"))
  homes.push(home)
  const server = Bun.serve({ port: 0, fetch: () => new Response(null, { status: 204 }) })
  const api = `http://127.0.0.1:${server.port}`
  const markerPath = signedOutMarkerPath(home, credentialId(api))
  const markerAtClear: boolean[] = []
  const store = memoryStore(initial, () => markerAtClear.push(existsSync(markerPath)))
  const account = async (args: string[], stdin = "") => {
    const out: string[] = []
    const code = await runAccountVerb(
      { api, store, home, pinDir: () => join(home, "sync-device"), readStdin: async () => stdin, output: line => out.push(line), error: () => {} },
      args,
    )
    return { code, out: out.map(line => JSON.parse(line) as Record<string, unknown>) }
  }
  const session = createSession({ api, store, home })
  return { account, session, home, markerPath, markerAtClear, stop: () => server.stop(true) }
}

describe("omo logout sign-out marker (#11434)", () => {
  describe("#given a signed-in machine", () => {
    test("#when it logs out #then token and export answer exit 10 and show reports the signed-out device", async () => {
      // given
      const m = machine(credential("dev_a"))
      try {
        // when
        const loggedOut = await m.session.logout()

        // then
        expect(loggedOut).toBe(true)
        const token = await m.account(["token"])
        expect(token.code).toBe(ACCOUNT_EXIT.loggedOut)
        expect(token.out).toEqual([{ signedIn: false, signedOut: { device: "dev_a", at: expect.any(String) } }])
        expect((await m.account(["export"])).code).toBe(ACCOUNT_EXIT.loggedOut)
        const show = await m.account(["show"])
        expect(show.code).toBe(ACCOUNT_EXIT.ok)
        expect(show.out).toEqual([{ signedIn: false, signedOut: { device: "dev_a", at: expect.any(String) } }])
      } finally {
        m.stop()
      }
    })

    test("#when it logs out #then the marker is on disk before the store is cleared", async () => {
      // given
      const m = machine(credential("dev_a"))
      try {
        // when
        await m.session.logout()

        // then
        expect(m.markerAtClear).toEqual([true])
      } finally {
        m.stop()
      }
    })

    test("#when the marker write fails during logout #then logout reports the failure and the credentials stay", async () => {
      // given
      const m = machine(credential("dev_a"))
      mkdirSync(dirname(dirname(m.markerPath)), { recursive: true })
      writeFileSync(dirname(m.markerPath), "not a directory")
      try {
        // when
        const outcome = await m.session.logout().then(
          () => null,
          (error: unknown) => error,
        )

        // then
        expect(outcome).toBeInstanceOf(Error)
        expect(m.markerAtClear).toEqual([])
        expect((await m.account(["token"])).code).toBe(ACCOUNT_EXIT.ok)
      } finally {
        m.stop()
      }
    })
  })

  describe("#given an empty store and no logout recorded", () => {
    test("#when token and show run #then token answers exit 4 and show says signed out", async () => {
      // given
      const m = machine(null)
      try {
        // when
        const token = await m.account(["token"])
        const show = await m.account(["show"])

        // then
        expect(token).toEqual({ code: ACCOUNT_EXIT.signedOut, out: [{ signedIn: false }] })
        expect(show).toEqual({ code: ACCOUNT_EXIT.ok, out: [{ signedIn: false }] })
      } finally {
        m.stop()
      }
    })
  })

  describe("#given an empty store and a marker that cannot be used", () => {
    const corruptions: Array<[string, (path: string) => void]> = [
      ["corrupt JSON", path => writeFileSync(path, "{not json")],
      ["schema-invalid JSON", path => writeFileSync(path, JSON.stringify({ device: 5 }))],
      ["unreadable (a directory)", path => mkdirSync(path)],
    ]

    test.each(corruptions)("#when the marker is %s #then token and export answer exit 4 and show still answers", async (_label, corrupt) => {
      // given
      const m = machine(null)
      mkdirSync(dirname(m.markerPath), { recursive: true })
      corrupt(m.markerPath)
      try {
        // when
        const token = await m.account(["token"])
        const exported = await m.account(["export"])
        const show = await m.account(["show"])

        // then
        expect(token).toEqual({ code: ACCOUNT_EXIT.signedOut, out: [{ signedIn: false }] })
        expect(exported.code).toBe(ACCOUNT_EXIT.signedOut)
        expect(show).toEqual({ code: ACCOUNT_EXIT.ok, out: [{ signedIn: false }] })
      } finally {
        m.stop()
      }
    })
  })

  describe("#given a logged-out machine", () => {
    test("#when it signs in again with save or adopt #then the marker is gone", async () => {
      // given
      const m = machine(credential("dev_a"))
      try {
        await m.session.logout()

        // when
        await m.session.save(credential("dev_b"))
        await m.account(["forget"])

        // then
        expect((await m.account(["token"])).code).toBe(ACCOUNT_EXIT.signedOut)

        // given
        await m.session.logout()

        // when
        expect((await m.account(["adopt"], JSON.stringify(credential("dev_c")))).code).toBe(ACCOUNT_EXIT.ok)

        // then
        expect((await m.account(["token"])).code).toBe(ACCOUNT_EXIT.ok)
        await m.account(["forget"])
        expect((await m.account(["token"])).code).toBe(ACCOUNT_EXIT.signedOut)
      } finally {
        m.stop()
      }
    })
  })
})
