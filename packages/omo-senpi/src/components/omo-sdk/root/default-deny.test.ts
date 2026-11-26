import { describe, expect, test } from "bun:test"
import { tmpdir } from "node:os"

import { assembleOmoSdk } from "../assembly"
import { PRINCIPAL_KINDS, PRINCIPAL_MATRIX, ROOT_CALLS, type OmoPrincipal, type RootCallKey } from "../contract"
import { boundaryRefusals, UNLINED_CALLS } from "./authority"
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
    for (const kind of ["connector", "service"] as const)
      expect(await root(PRINCIPALS[kind]).account.show({})).toMatchObject({
        kind: "error",
        error: { code: "sender_not_allowed", details: { principal: kind, reason: "no_matrix_cell" } },
      })
    expect(touched).toEqual([])
    expect(boundaryRefusals(PRINCIPALS.person, {}).has("account.show")).toBe(false)
    expect(boundaryRefusals(PRINCIPALS.script, {}).get("install.sdkRoot")).toMatchObject({
      code: "sender_not_allowed",
      details: { reason: "no_matrix_cell" },
    })
  })
})
