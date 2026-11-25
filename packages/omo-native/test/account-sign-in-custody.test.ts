import { describe, expect, test } from "bun:test"

import type { CustodyLog } from "../../account-core/src/calls/custody-log"
import { createSession } from "../../account-core/src/session"
import { clock, fakeApi, grant, memorySecrets, minted, temporaryHome } from "../../account-core/src/test-support"
import { ACCOUNT_EXIT } from "../account-cli"
import { runSignInVerb } from "../account-sign-in"

// Security design 8.2 for `omo account sign-in` (review 6065710236 N3): run by a person or a script it records the
// sign-in in the custody log; started by the omo SDK root, which records the call itself, it records nothing.

function recorder() {
  const records: string[] = []
  const log: CustodyLog = {
    begin: async (capability) => {
      records.push(`started ${capability}`)
      return {
        recorded: true,
        end: async (outcome) => {
          records.push(`${outcome} ${capability}`)
          return true
        },
      }
    },
    refused: async (capability, code) => {
      records.push(`refused ${capability} ${code}`)
      return true
    },
  }
  return { records, log }
}

async function signIn(stdin: string) {
  const api = fakeApi(async (request) => {
    const path = new URL(request.url).pathname
    if (path === "/v1/health") return Response.json({ ok: true })
    if (path === "/v1/device/code") return Response.json(minted)
    if (path === "/v1/device/token") return Response.json(grant)
    return new Response("", { status: 404 })
  })
  const store = memorySecrets().store(api)
  const { records, log } = recorder()
  const code = await runSignInVerb(
    {
      api,
      store,
      session: createSession({ api, store, home: await temporaryHome(), beforeKeysDiscarded: async () => undefined }),
      setUpDeviceService: async () => "on",
      readStdin: async () => stdin,
      output: () => undefined,
      error: () => undefined,
      custody: log,
      ...clock(),
    },
    ["--stdin"],
  )
  return { code, records }
}

describe("omo account sign-in and the custody log", () => {
  test("#given the verb run directly #then the sign-in is recorded, started then ok", async () => {
    expect(await signIn("")).toEqual({
      code: ACCOUNT_EXIT.ok,
      records: ["started account.signIn", "ok account.signIn"],
    })
  })

  test("#given the verb started by the omo SDK root, which records the call #then the verb records nothing", async () => {
    expect(await signIn(JSON.stringify({ custodyRecordedByCaller: true }))).toEqual({
      code: ACCOUNT_EXIT.ok,
      records: [],
    })
  })
})
