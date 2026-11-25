import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

import { assembleOmoSdk } from "../../packages/omo-senpi/src/components/omo-sdk/assembly"
import type { OmoPrincipal } from "../../packages/omo-senpi/src/components/omo-sdk/contract"

// Architecture contract (design lane ruling on slice A1b, 2026-11-26): the closed, self-retiring list of root members
// that still run through the omo launcher as a child for one principal, each with the slice that retires it. A listed
// member must really go through the child for that principal, and an entry whose member no longer does is stale.

type Entry = {
  readonly member: string
  readonly principal: OmoPrincipal["kind"]
  readonly reason: string
  readonly retires_with: string
}

const LIST = JSON.parse(readFileSync(join(import.meta.dir, "child-backed-members.json"), "utf8")) as {
  readonly entries: readonly Entry[]
}

const PRINCIPALS: Readonly<Record<string, OmoPrincipal>> = {
  person: { kind: "person", uid: 501 },
  script: { kind: "script", uid: 501 },
  session: { kind: "session", session_id: "01-child-backed" },
}

const INPUTS: Readonly<Record<string, unknown>> = {
  "account.signIn": { method: "device_code", onUserCode: () => undefined },
  "account.signInCheck": {},
}

// The entry configurations a root is built in: the session's provisioned entry (no in-process sign-in) and the
// omo-ai/sdk entry (with one). A listed member must reach the child in both.
const CONFIGURATIONS = ["provisioned", "omo-ai/sdk"] as const
type Configuration = (typeof CONFIGURATIONS)[number]

async function reachesChild(
  entry: Pick<Entry, "member" | "principal">,
  configuration: Configuration = "provisioned",
): Promise<{ readonly child: boolean; readonly inProcess: boolean }> {
  let spawned = false
  let inProcess = false
  const principal = PRINCIPALS[entry.principal]
  if (principal === undefined) return { child: false, inProcess: false }
  const sdk = assembleOmoSdk(
    {
      principal,
      env: { OMO_SERVICE_API_URL: "https://api.example.test" },
      cwd: "/work",
      ports: {
        desktopLaunch: () => false,
        signInProcess: async () => {
          spawned = true
          return { code: 0 }
        },
      },
    },
    configuration === "provisioned"
      ? {}
      : {
          signIn: async () => {
            inProcess = true
            return { kind: "refused", code: "cancelled" }
          },
        },
  )
  const member = entry.member.split(".").reduce<unknown>((node, key) => Reflect.get(Object(node), key), sdk)
  await (member as (input: unknown) => Promise<unknown>)(INPUTS[entry.member] ?? {})
  return { child: spawned, inProcess }
}

const stale = async (entries: readonly Pick<Entry, "member" | "principal">[]): Promise<string[]> => {
  const found: string[] = []
  for (const entry of entries)
    for (const configuration of CONFIGURATIONS) {
      const reached = await reachesChild(entry, configuration)
      if (!reached.child || reached.inProcess) found.push(`${entry.member} (${entry.principal}, ${configuration})`)
    }
  return found
}

describe("child-backed root members", () => {
  test("#given the list #then every entry names its reason and the slice that retires it", () => {
    for (const entry of LIST.entries) {
      expect(entry.reason.length).toBeGreaterThan(0)
      expect(entry.retires_with).toMatch(/^[A-Z][0-9A-Za-z-]+$/)
    }
  })

  test("#given the list #when each member runs for its principal #then it goes through the launcher child", async () => {
    expect(await stale(LIST.entries)).toEqual([])
  })

  test("#given an entry whose member does not start the child #then it is reported stale", async () => {
    expect(await stale([{ member: "account.signInCheck", principal: "session" }])).toEqual([
      "account.signInCheck (session, provisioned)",
      "account.signInCheck (session, omo-ai/sdk)",
    ])
  })

  test("#given the omo-ai/sdk entry #when a script signs in #then it runs in process and never starts the child", async () => {
    expect(await reachesChild({ member: "account.signIn", principal: "script" }, "omo-ai/sdk")).toEqual({
      child: false,
      inProcess: true,
    })
  })
})
