import { describe, expect, test } from "bun:test"
import { join } from "node:path"

import type { CustodyLog } from "@oh-my-opencode/account-core/calls/custody-log"
import type { AccountAccess } from "../access"
import { accountNamespace, rootCustodyLog } from "./account"
import type { NamespaceServing } from "./members"

// The account call bodies load on the first account call that runs (P1b cold-import decision, #14950): a call the root
// boundary refuses writes its one record and never loads them; a call that runs does. Each case is its own process, so
// no other test has loaded the module first; a runtime loader hook records whether the bodies module was read.

const ASSEMBLY = join(import.meta.dir, "..", "assembly.ts")

function probe(principal: string, key: string): string {
  return `
let loaded = false
Bun.plugin({ name: "watch", setup(build) { build.onLoad({ filter: /root[\\\\/]account-members\\.ts$/ }, (args) => { loaded = true; return undefined }) } })
const { assembleOmoSdk } = await import(${JSON.stringify(ASSEMBLY)})
const records = []
const custody = {
  begin: async () => ({ recorded: true, end: async () => true }),
  refused: async (capability, code) => { records.push(capability + " " + code); return true },
}
const sdk = assembleOmoSdk({ principal: ${principal}, env: { OMO_SERVICE_API_URL: "https://accounts.example.test" }, cwd: process.cwd(), ports: { desktopLaunch: () => false, custody } }, {})
const call = ${JSON.stringify(key)}.split(".").reduce((node, part) => node[part], sdk)
const answer = await call({}).catch((error) => ({ thrown: String(error) }))
console.log(JSON.stringify({ loaded, records, code: answer?.error?.code ?? answer?.kind }))
`
}

async function run(principal: string, key: string) {
  const child = Bun.spawn([process.execPath, "-e", probe(principal, key)], {
    cwd: import.meta.dir,
    env: process.env,
    stdout: "pipe",
    stderr: "pipe",
  })
  const [out, err, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  if (code !== 0) throw new Error(err)
  return JSON.parse(out.trim().split("\n").at(-1) ?? "{}") as unknown
}

describe("the account call bodies load lazily", () => {
  test("#given a connector root #when account.signOut is refused at the boundary #then the refusal is recorded and the bodies never load", async () => {
    expect(await run(`{ kind: "connector", binding: "b-1" }`, "account.signOut")).toMatchObject({
      loaded: false,
      records: [expect.stringMatching(/^account\.signOut /)],
    })
  })

  test("#given a person root #when account.signInCheck runs #then the bodies load", async () => {
    expect(await run(`{ kind: "person", uid: 501 }`, "account.signInCheck")).toMatchObject({ loaded: true })
  })
})

// Review 6072727240: a load of the bodies that fails answers a typed refusal with fixed words (no loader text, no
// path), a boundary refusal never attempts it, and the failure is not kept: the next call loads again.
describe("a failed load of the account call bodies", () => {
  const SECRET = "/private/module/path/account-members.ts: canary-load-failure"

  function namespaceWith(load: () => Promise<{ accountMembers: () => NamespaceServing["members"] }>) {
    const refusals: string[] = []
    const custody: CustodyLog = {
      begin: async () => ({ recorded: true, end: async () => true }),
      refused: async (capability, code) => {
        refusals.push(`${capability} ${code}`)
        return true
      },
    }
    const namespace = accountNamespace({
      custody,
      access: {} as AccountAccess,
      env: {},
      cwd: "/work",
      load: load as never,
    })
    return { namespace, refusals }
  }

  test("#given a load that rejects #when an account call runs #then it answers internal_error with fixed words and no loader text", async () => {
    const { namespace } = namespaceWith(async () => {
      throw new Error(SECRET)
    })
    const answer = await (namespace.members["account.signOut"] as (input: unknown) => Promise<unknown>)({})
    expect(answer).toMatchObject({
      kind: "error",
      error: { code: "internal_error", message: "the account calls could not be loaded" },
    })
    expect(JSON.stringify(answer)).not.toContain("canary-load-failure")
    expect(JSON.stringify(answer)).not.toContain("/private/module")
  })

  test("#given a load that rejects #when the boundary refuses a call #then its record is written and no load is attempted", async () => {
    let attempts = 0
    const { namespace, refusals } = namespaceWith(async () => {
      attempts++
      throw new Error(SECRET)
    })
    await namespace.recordRefusal?.("account.signOut", "sender_not_allowed")
    expect({ attempts, refusals }).toEqual({ attempts: 0, refusals: ["account.signOut sender_not_allowed"] })
  })

  test("#given a load that fails once #when the next call runs #then it loads again and answers from the bodies", async () => {
    let attempts = 0
    const { namespace } = namespaceWith(async () => {
      attempts++
      if (attempts === 1) throw new Error(SECRET)
      return {
        accountMembers: () =>
          ({ "account.signInCheck": async () => ({ kind: "ok", value: { from: "bodies" } }) }) as never,
      }
    })
    const check = namespace.members["account.signInCheck"] as (input: unknown) => Promise<unknown>
    const first = await check({})
    const second = await check({})
    expect({ attempts, first: (first as { kind: string }).kind, second }).toEqual({
      attempts: 2,
      first: "error",
      second: { kind: "ok", value: { from: "bodies" } },
    })
  })
})

// The same for the custody log the root loads on its first record: a failed load writes nothing and says so, never
// throws, and the next record loads again.
describe("a failed load of the root's custody log", () => {
  const principal = { kind: "person", uid: 501 } as const

  test("#given a load that rejects #when an operation begins and a refusal is recorded #then both answer unwritten and nothing throws", async () => {
    const log = rootCustodyLog(principal, async () => {
      throw new Error("/private/custody-log.ts: canary-load-failure")
    })
    const operation = await log.begin("account.signOut")
    expect({
      recorded: operation.recorded,
      ended: await operation.end("ok"),
      refused: await log.refused("account.forget", "sender_not_allowed"),
    }).toEqual({ recorded: false, ended: false, refused: false })
  })

  test("#given a load that fails once #when the next record is written #then it loads again and writes", async () => {
    let attempts = 0
    const written: string[] = []
    const log = rootCustodyLog(principal, async () => {
      attempts++
      if (attempts === 1) throw new Error("canary-load-failure")
      return {
        begin: async () => ({ recorded: true, end: async () => true }),
        refused: async (capability, code) => {
          written.push(`${capability} ${code}`)
          return true
        },
      }
    })
    const first = await log.refused("account.signOut", "sender_not_allowed")
    const second = await log.refused("account.signOut", "sender_not_allowed")
    expect({ attempts, first, second, written }).toEqual({
      attempts: 2,
      first: false,
      second: true,
      written: ["account.signOut sender_not_allowed"],
    })
  })

  test("#given a custody log whose load rejects #when the boundary refuses a call #then the refusal still answers", async () => {
    const namespace = accountNamespace({
      custody: rootCustodyLog(principal, async () => {
        throw new Error("canary-load-failure")
      }),
      access: {} as AccountAccess,
      env: {},
      cwd: "/work",
    })
    await expect(namespace.recordRefusal?.("account.signOut", "sender_not_allowed")).resolves.toBeUndefined()
  })
})
