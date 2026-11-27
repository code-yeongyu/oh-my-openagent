import { describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type { OmoPrincipal } from "../contract"
import { createOmoSdk } from ".."
import { isPrincipal } from "../contract/validate"
import { assembleThreadFacade } from "../thread-assembly"

// Design lane ruling (P1b, point 4): a root built for a session or a connector serves no thread cell the matrix
// allows it until the slice that moves that authority under the root (T2, X1b); those cells answer not_implemented,
// before any thread core is built. A script's root serves them.
const cells: readonly {
  readonly principal: OmoPrincipal
  readonly call: (root: ReturnType<typeof createOmoSdk>) => Promise<unknown>
}[] = [
  { principal: { kind: "session", session_id: "session-1" }, call: (root) => root.threads.read({ thread: "dur-1" }) },
  { principal: { kind: "connector", binding: "binding-1" }, call: (root) => root.threads.create({ name: "lane" }) },
]

describe("thread cells by principal", () => {
  for (const { principal, call } of cells)
    test(`#given a ${principal.kind} root #when it makes a thread call the matrix allows it #then that cell answers not_implemented`, async () => {
      const agentDir = join(tmpdir(), `principals-${principal.kind}-absent`)
      const root = createOmoSdk({ env: {}, cwd: tmpdir(), principal, agentDir } as never)
      expect(await call(root)).toMatchObject({
        kind: "error",
        error: { code: "not_implemented" },
      })
      await root.dispose()
    })

  test("#given a script root over an empty agent dir #when it lists threads #then the thread core answers", async () => {
    const agentDir = mkdtempSync(join(tmpdir(), "principals-script-"))
    const root = createOmoSdk({ env: { OMO_CODING_AGENT_DIR: agentDir }, cwd: tmpdir(), agentDir } as never)
    const listed = await root.threads.list({})
    expect(listed.kind === "error" ? listed.error.code : listed.kind).not.toBe("not_implemented")
    await root.dispose()
    rmSync(agentDir, { recursive: true, force: true })
  })
})

// Review of #14983 at 699c480398 (MEDIUM 1, security): a root is built for exactly one of the five principals of the
// security design's section 3. Any other value is refused when the root is built, on both entries, never served.
describe("a root built for a value that is not one of the five principals", () => {
  const invalid: readonly unknown[] = [
    { kind: "__proto__" },
    { kind: "constructor" },
    { kind: "person", uid: -5 },
    { kind: "service", extra: true },
  ]
  // The construction check runs without the schema validator (size ruling); it must accept exactly what the schema does.
  test("#given each principal and each near miss #when a root is built #then it accepts exactly what the Principal schema accepts", () => {
    const candidates: readonly unknown[] = [
      ...invalid,
      { kind: "person", uid: 0 },
      { kind: "script", uid: 501 },
      { kind: "connector", binding: "b-1" },
      { kind: "session", session_id: "s-1" },
      { kind: "service" },
      { kind: "script", uid: 1.5 },
      { kind: "connector", binding: "" },
      { kind: "session" },
      { kind: "person", uid: 1, session_id: "s" },
      ["kind"],
      null,
    ]
    const accepts = (principal: unknown) => {
      try {
        assembleThreadFacade({ env: {}, cwd: tmpdir(), principal } as never)
        return true
      } catch {
        return false
      }
    }
    expect(candidates.filter((principal) => accepts(principal) !== isPrincipal(principal))).toEqual([])
  })
  for (const principal of invalid)
    test(`#given ${JSON.stringify(principal)} #when either root is built #then it throws a TypeError`, () => {
      expect(() => createOmoSdk({ env: {}, cwd: tmpdir(), principal } as never)).toThrow(TypeError)
      expect(() => assembleThreadFacade({ env: {}, cwd: tmpdir(), principal } as never)).toThrow(TypeError)
    })
})

// Review of #14983 at 699c480398 (LOW 1): the account service origin is the caller's to change only for a person or a
// script (security design 4.2). A session root that names one through `accounts` is refused, as it is through `api`. The
// environment the root is built with is the configured origin, which a session's call uses, so it is not refused.
describe("a session root that names an account service origin", () => {
  const session = { kind: "session", session_id: "session-1" } as const
  const whoami = async (options: Record<string, unknown>) => {
    const root = createOmoSdk({
      cwd: tmpdir(),
      principal: session,
      ports: {
        session: {
          accessToken: async () => null,
          request: async () => {
            throw new Error("no network in this test")
          },
        },
      },
      ...options,
    } as never)
    const answer = (await root.account.whoami({})) as { kind: string; error?: { code?: string; message?: string } }
    await root.dispose()
    return answer
  }
  const originRefused = (answer: { error?: { code?: string; message?: string } }) =>
    answer.error?.code === "sender_not_allowed" && (answer.error.message ?? "").includes("security design 4.2")
  for (const [label, options] of [
    ["the api option", { env: {}, api: "https://api.example.test" }],
    ["the accounts option", { env: {}, accounts: "https://accounts.example.test" }],
  ] as const)
    test(`#given ${label} #when it asks account.whoami #then the origin refusal answers`, async () => {
      expect(originRefused(await whoami(options))).toBe(true)
    })
  test("#given the configured origin in the environment the root is built with #when it asks account.whoami #then the origin refusal does not answer", async () => {
    expect(originRefused(await whoami({ env: { OMO_SERVICE_API_URL: "https://api.example.test" } }))).toBe(false)
  })
})
