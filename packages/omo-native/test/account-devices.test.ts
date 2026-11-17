import { describe, expect, test } from "bun:test"
import { join } from "node:path"
import {
  fakeApi,
  grant,
  memorySecrets,
  privateKeys,
  refusal,
  temporaryHome,
} from "../../omo-opencode/src/cli/service-auth/test-support"
import { ACCOUNT_EXIT, runAccountVerb } from "../account-cli"

type Row = { id: string; name: string; current: boolean; revokedAt: string | null; lastSeenAt: string }

const row = (id: string, name: string, current = false): Row => ({
  id,
  name,
  current,
  revokedAt: null,
  lastSeenAt: "2026-11-12T00:00:00.000Z",
})

function account(rows: Row[], options: { readonly deleteStatus?: number; readonly keepAfterDelete?: boolean } = {}) {
  const calls: string[] = []
  const api = fakeApi((request) => {
    const { pathname } = new URL(request.url)
    calls.push(`${request.method} ${pathname} ${request.headers.get("authorization") ?? ""}`)
    if (request.method === "GET" && pathname === "/v1/devices") return Response.json({ devices: rows })
    if (request.method === "DELETE" && pathname.startsWith("/v1/devices/")) {
      const id = decodeURIComponent(pathname.slice("/v1/devices/".length))
      const target = rows.find((device) => device.id === id)
      if (target !== undefined && options.keepAfterDelete !== true) target.revokedAt = "2026-11-17T00:00:00.000Z"
      return options.deleteStatus === 404
        ? refusal("not_found", undefined, 404)
        : new Response(null, { status: options.deleteStatus ?? 204 })
    }
    return new Response("unexpected", { status: 500 })
  })
  return { api, calls }
}

async function run(api: string, args: string[], stored: object | null = { ...grant, ...privateKeys }) {
  const store = memorySecrets().store(api)
  if (stored !== null) await store.write(stored as typeof grant & typeof privateKeys)
  const home = await temporaryHome()
  const out: unknown[] = []
  const err: string[] = []
  const code = await runAccountVerb(
    {
      api,
      store,
      home,
      pinDir: () => join(home, "sync-device"),
      readStdin: async () => "",
      output: (line) => out.push(JSON.parse(line)),
      error: (line) => err.push(line),
    },
    args,
  )
  return { code, out, err, stored: await store.read() }
}

describe("omo account devices", () => {
  test("#given live and revoked devices #when listing #then only live devices are printed with ids", async () => {
    const revoked = { ...row("dev-old", "old"), revokedAt: "2026-11-01T00:00:00.000Z" }
    const { api } = account([row(grant.device.id, grant.device.name, true), row("dev-twin", "twin"), revoked])

    const result = await run(api, ["devices"])

    expect(result.code).toBe(ACCOUNT_EXIT.ok)
    expect(result.out).toEqual([
      {
        devices: [
          { id: grant.device.id, name: grant.device.name, lastSeenAt: "2026-11-12T00:00:00.000Z", current: true },
          { id: "dev-twin", name: "twin", lastSeenAt: "2026-11-12T00:00:00.000Z", current: false },
        ],
      },
    ])
  })

  test("#given another live device #when revoking it by id #then the account deletes it and the read-back confirms", async () => {
    const { api, calls } = account([row(grant.device.id, grant.device.name, true), row("dev-twin", "twin")])

    const result = await run(api, ["devices", "revoke", "dev-twin"])

    expect(result.code).toBe(ACCOUNT_EXIT.ok)
    expect(result.out).toEqual([
      {
        revoked: true,
        device: { id: "dev-twin", name: "twin", lastSeenAt: "2026-11-12T00:00:00.000Z", current: false },
      },
    ])
    expect(calls).toEqual([
      `GET /v1/devices Bearer ${grant.accessToken}`,
      `DELETE /v1/devices/dev-twin Bearer ${grant.accessToken}`,
      `GET /v1/devices Bearer ${grant.accessToken}`,
    ])
    expect(result.stored?.device.id).toBe(grant.device.id)
  })

  test("#given the caller's own id #when revoking #then it refuses and deletes nothing", async () => {
    const { api, calls } = account([row(grant.device.id, grant.device.name, true)])

    const result = await run(api, ["devices", "revoke", grant.device.id])

    expect(result.code).toBe(ACCOUNT_EXIT.invalid)
    expect(result.out).toMatchObject([{ revoked: false, error: "this_device" }])
    expect(calls.some((call) => call.startsWith("DELETE"))).toBe(false)
    expect(result.stored?.device.id).toBe(grant.device.id)
  })

  test("#given a list without the current flag #when revoking the stored device's id #then it refuses and deletes nothing", async () => {
    const { current: _current, ...own } = row(grant.device.id, grant.device.name)
    const { api, calls } = account([own as Row, row("dev-twin", "twin")])

    const result = await run(api, ["devices", "revoke", grant.device.id])

    expect(result.code).toBe(ACCOUNT_EXIT.invalid)
    expect(result.out).toMatchObject([{ revoked: false, error: "this_device" }])
    expect(calls.some((call) => call.startsWith("DELETE"))).toBe(false)
  })

  test("#given no stored sign-in #when listing #then it reports signed out with its own exit code", async () => {
    const { api, calls } = account([])

    const result = await run(api, ["devices"], null)

    expect(result.code).toBe(ACCOUNT_EXIT.signedOut)
    expect(result.out).toEqual([{ signedIn: false }])
    expect(calls).toEqual([])
  })

  test("#given a sign-in the service ended #when listing #then it reports ended like account token", async () => {
    const api = fakeApi((request) =>
      new URL(request.url).pathname === "/v1/session/refresh"
        ? refusal("device_revoked", undefined, 401)
        : new Response("unexpected", { status: 500 }),
    )

    const result = await run(api, ["devices"], {
      ...grant,
      ...privateKeys,
      accessTokenExpiresAt: "2000-01-01T00:00:00Z",
    })

    expect(result.code).toBe(ACCOUNT_EXIT.ended)
    expect(result.out).toEqual([{ ended: { code: "device_revoked" } }])
  })

  test("#given an id that is not a live device of this account #when revoking #then it refuses without a delete", async () => {
    const { api, calls } = account([row(grant.device.id, grant.device.name, true)])

    const result = await run(api, ["devices", "revoke", "dev-elsewhere"])

    expect(result.code).toBe(ACCOUNT_EXIT.failed)
    expect(result.out).toEqual([{ revoked: false, error: "not_found" }])
    expect(calls.some((call) => call.startsWith("DELETE"))).toBe(false)
  })

  test("#given a delete the account does not apply #when reading back #then the revoke is reported as failed", async () => {
    const { api } = account([row(grant.device.id, grant.device.name, true), row("dev-twin", "twin")], {
      keepAfterDelete: true,
    })

    const result = await run(api, ["devices", "revoke", "dev-twin"])

    expect(result.code).toBe(ACCOUNT_EXIT.failed)
    expect(result.out).toMatchObject([{ revoked: false, error: "still_live" }])
  })

  test("#given a device revoked concurrently #when the delete answers 404 #then the read-back still settles it", async () => {
    const rows = [row(grant.device.id, grant.device.name, true), row("dev-twin", "twin")]
    const { api } = account(rows, { deleteStatus: 404 })

    const result = await run(api, ["devices", "revoke", "dev-twin"])

    expect(result.code).toBe(ACCOUNT_EXIT.ok)
    expect(result.out).toMatchObject([{ revoked: true }])
  })

  test.each([
    [["devices", "revoke"]],
    [["devices", "revoke", ""]],
    [["devices", "revoke", "--x"]],
    [["devices", "drop", "a"]],
    [["devices", "revoke", "a", "b"]],
  ])("#given malformed arguments %p #then usage exits invalid before any request", async (args) => {
    const { api, calls } = account([])
    const result = await run(api, args)
    expect(result.code).toBe(ACCOUNT_EXIT.invalid)
    expect(calls).toEqual([])
  })

  test("#given forget --device naming another device #then it says the revoke command acts on other devices", async () => {
    const { api, calls } = account([])

    const result = await run(api, ["forget", "--device", "dev-twin"])

    expect(result.code).toBe(ACCOUNT_EXIT.conflict)
    expect(result.err).toHaveLength(1)
    expect(result.err[0]).toContain("omo account devices revoke dev-twin")
    expect(calls).toEqual([])
  })
})
