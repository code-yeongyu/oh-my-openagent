import { describe, expect, test } from "bun:test"
import { tmpdir } from "node:os"

import { assembleOmoSdk } from "../assembly"
import { PRINCIPAL_KINDS, PRINCIPAL_MATRIX, ROOT_CALLS, type OmoPrincipal, type RootCallKey } from "../contract"
import { boundaryRefusals, UNLINED_CALLS } from "./authority"
import { HELD_ALLOWS } from "./held-allows"
import { PENDING_CELLS } from "./pending-cells"

// Security design 4 is default deny (design lane ruling on 14996's custody review): a (call, principal) pair with no line
// in the matrix is refused at the boundary, before any port, unless a shipped entry serves it today and it waits in the
// closed PENDING_CELLS record for its cell. Every pair refused only by default is listed here, so each missing cell is
// visible and has an owner.
const PRINCIPALS: Readonly<Record<(typeof PRINCIPAL_KINDS)[number], OmoPrincipal>> = {
  person: { kind: "person", uid: 501 },
  script: { kind: "script", uid: 501 },
  connector: { kind: "connector", binding: "b-1" },
  session: { kind: "session", session_id: "s-1" },
  service: { kind: "service" },
}

const pending = (call: string, kind: string) =>
  PENDING_CELLS.some((cell) => cell.call === call && cell.principal === kind)

describe("default deny at the root's boundary", () => {
  test("#given every root call crossed with every principal #then each pair has a matrix cell, a pending cell, or a default refusal, and the default refusals are exactly these", () => {
    const lined = new Set(PRINCIPAL_MATRIX.flatMap((line) => line.rows as readonly string[]))
    const byDefault = (Object.keys(ROOT_CALLS) as RootCallKey[]).flatMap((call) =>
      lined.has(call) ? [] : PRINCIPAL_KINDS.filter((kind) => !pending(call, kind)).map((kind) => `${call} ${kind}`),
    )
    expect(UNLINED_CALLS.filter((call) => lined.has(call))).toEqual([])
    expect(byDefault).toEqual(
      UNLINED_CALLS.flatMap((call) =>
        PRINCIPAL_KINDS.filter((kind) => !pending(call, kind)).map((kind) => `${call} ${kind}`),
      ),
    )
    expect(byDefault.filter((pair) => pair.startsWith("install.sdkRoot "))).toEqual(
      PRINCIPAL_KINDS.map((kind) => `install.sdkRoot ${kind}`),
    )
    expect(byDefault.length).toBe(UNLINED_CALLS.length * PRINCIPAL_KINDS.length - PENDING_CELLS.length)
  })

  test("#given the pending record #then it is closed both ways: each entry's call still has no line, no pair repeats, every entry names its proof and owner, and connector and service never wait", () => {
    expect(PENDING_CELLS.filter((cell) => !UNLINED_CALLS.includes(cell.call)).map((cell) => cell.call)).toEqual([])
    const pairs = PENDING_CELLS.map((cell) => `${cell.call} ${cell.principal}`)
    expect(pairs.length).toBe(new Set(pairs).size)
    expect(PENDING_CELLS.filter((cell) => cell.served_by === "" || cell.owner === "")).toEqual([])
    expect(PENDING_CELLS.filter((cell) => cell.principal === "connector" || cell.principal === "service")).toEqual([])
  })

  test("#given the held allows #then each holds a conditional allow or an n/a cell, no pair repeats, and each is refused with its own text", () => {
    const cellOf = (call: RootCallKey, kind: (typeof PRINCIPAL_KINDS)[number]) =>
      PRINCIPAL_MATRIX.find((line) => line.input === undefined && (line.rows as readonly string[]).includes(call))
        ?.cells[kind]
    // Without its entry each pair would be admitted: its line's cell is an allow on a condition its note states, or n/a.
    expect(
      HELD_ALLOWS.filter((entry) => {
        const cell = cellOf(entry.call, entry.principal)
        return cell?.outcome !== "n/a" && (cell?.outcome !== "allow" || cell.note === undefined)
      }),
    ).toEqual([])
    const pairs = HELD_ALLOWS.map((entry) => `${entry.call} ${entry.principal}`)
    expect(pairs.length).toBe(new Set(pairs).size)
    expect(
      HELD_ALLOWS.filter(
        (entry) => entry.condition === "" || entry.owner === "" || entry.message === "" || entry.next_action === "",
      ),
    ).toEqual([])
    for (const entry of HELD_ALLOWS)
      expect(boundaryRefusals(PRINCIPALS[entry.principal], {}).get(entry.call)).toEqual({
        code: "sender_not_allowed",
        message: entry.message,
        next_action: entry.next_action,
        details: { principal: entry.principal, reason: "held" },
      })
  })

  test("#given a principal and a call with no cell #when the root is built #then the call is refused as no_matrix_cell before any port, and a pending pair is not", async () => {
    const touched: string[] = []
    const root = (principal: OmoPrincipal) =>
      assembleOmoSdk(
        {
          env: { OMO_SERVICE_API_URL: "https://accounts.example.test" },
          cwd: tmpdir(),
          agentDir: tmpdir(),
          principal,
          ports: {
            desktopLaunch: () => false,
            session: {
              accessToken: async () => "t",
              request: async (path: string) => {
                touched.push(path)
                return {}
              },
            },
          },
        },
        {},
      )
    // The example pairs are generated: the first call with no line, and the first call with no line that a person may
    // still reach through a pending cell.
    const [unlined] = UNLINED_CALLS
    const waiting = UNLINED_CALLS.find((call) => pending(call, "person"))
    if (unlined === undefined || waiting === undefined) throw new Error("no unlined call left to probe")
    const call = (sdk: ReturnType<typeof root>, key: RootCallKey) =>
      key.split(".").reduce<unknown>((node, part) => (node as Record<string, unknown>)[part], sdk) as (
        input: unknown,
      ) => Promise<unknown>
    for (const kind of ["connector", "service"] as const)
      expect(await call(root(PRINCIPALS[kind]), unlined)({})).toMatchObject({
        kind: "error",
        error: { code: "sender_not_allowed", details: { principal: kind, reason: "no_matrix_cell" } },
      })
    expect(touched).toEqual([])
    expect(boundaryRefusals(PRINCIPALS.person, {}).has(waiting)).toBe(false)
    expect(boundaryRefusals(PRINCIPALS.script, {}).get("install.sdkRoot")).toMatchObject({
      code: "sender_not_allowed",
      details: { reason: "no_matrix_cell" },
    })
  })
})

// One case per held pair through a built root (design lane ruling on held cells' text): the call answers its entry's own
// code, message, next_action and reason, generated from the entry, before any core or port.
describe("a held pair answers its own refusal through the root", () => {
  for (const entry of HELD_ALLOWS)
    test(`#given a ${entry.principal} root #when ${entry.call} is called #then it answers the held refusal`, async () => {
      const root = assembleOmoSdk(
        {
          env: { OMO_SERVICE_API_URL: "https://accounts.example.test" },
          cwd: tmpdir(),
          agentDir: tmpdir(),
          principal: PRINCIPALS[entry.principal],
        },
        {},
      )
      const member = entry.call.split(".").reduce<unknown>((node, part) => Reflect.get(Object(node), part), root) as (
        input: unknown,
      ) => Promise<unknown>
      expect(await member({})).toEqual({
        kind: "error",
        error: {
          code: "sender_not_allowed",
          message: entry.message,
          next_action: entry.next_action,
          details: { principal: entry.principal, reason: "held" },
        },
      })
      await root.dispose()
    })
})

// The held pairs, enumerated (LEAD rulings: the session's account reads and config.status for a session and a service): a
// removed entry would let its pair fall to its line's conditional allow, so the list itself is pinned (review 6084226979, L1).
// The structural check (no allow whose condition is unmet) is the first commit of omo#15015.
test("#given the held list #then it holds exactly the four ruled pairs", () => {
  expect(HELD_ALLOWS.map((entry) => `${entry.call} ${entry.principal}`).toSorted()).toEqual([
    "account.show session",
    "account.signInCheck session",
    "config.status service",
    "config.status session",
  ])
})

// A held next step asks the person; it names no command of the CLI and no flag (review 6084226979, L2).
test("#given every held entry #then its next_action names no omo command, verb or flag", () => {
  expect(
    HELD_ALLOWS.filter((entry) => /`|\bomo\s+[a-z]|--[a-z]/i.test(entry.next_action)).map(
      (entry) => `${entry.call} ${entry.principal}: ${entry.next_action}`,
    ),
  ).toEqual([])
})
