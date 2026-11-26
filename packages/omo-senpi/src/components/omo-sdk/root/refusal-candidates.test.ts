import { describe, expect, test } from "bun:test"

import type { TableScenario } from "../../../../../../script/sdk-parity/expectation"
import { scenarioSetup } from "../../../../../../script/sdk-parity/fakes/setup"
import { listProjectedCandidates } from "./refusal-candidates"

// The owner's ruling B2: a resolution call's refusal candidates carry the caller's own threads.list fields for the same
// rows plus the preview of a row it may read, and no candidate is a row the caller's list would not return.
const PRINCIPALS = {
  person: { kind: "person", platform_user_id: "u1" },
  script: undefined,
  session: { kind: "session", session_id: "session-1" },
} as const
// Two threads share the name "lane t-1": t-1 on this device and b's thread, renamed to it.
const SHARED = [{ port: "remote", state: { title: "lane t-1" } }]

async function call(row: string, principal: unknown, input: object): Promise<unknown> {
  const scenario = {
    id: `candidates/${row}`,
    row,
    kind: "effect",
    input,
    expect: [],
    target: "this_device",
    given: SHARED,
    ...(principal === undefined ? {} : { principal }),
  } as unknown as TableScenario
  const { root } = scenarioSetup(scenario)
  const [namespace, member] = row.split(".") as [string, string]
  const run = Reflect.get(Object(Reflect.get(Object(root), namespace)), member) as (input: object) => Promise<unknown>
  return await run(input)
}

// Each setup has its own temporary home, so a cwd under it is compared without that per-setup prefix.
const sameHome = (row: Readonly<Record<string, unknown>>) =>
  JSON.parse(JSON.stringify(row).replace(/sdk-parity-fakes-[0-9a-f-]+/g, "sdk-parity-fakes"))

const candidatesOf = (answer: unknown): readonly Record<string, unknown>[] => {
  const details = Reflect.get(Object(Reflect.get(Object(answer), "error")), "details")
  return (Reflect.get(Object(details), "candidates") as readonly Record<string, unknown>[] | undefined) ?? []
}

describe("refusal candidates are the caller's list rows (ruling B2)", () => {
  for (const [kind, principal] of Object.entries(PRINCIPALS))
    for (const [row, input] of [
      ["threads.resolve", { address: "lane t-1", all_scope: true }],
      ["threads.locate", { thread: "lane t-1", all_scope: true }],
    ] as const)
      test(`#given a ${kind} #when ${row} is ambiguous #then every candidate field is a field its list returns for that row, or the preview`, async () => {
        const refused = await call(row, principal, input)
        expect(Reflect.get(Object(Reflect.get(Object(refused), "error")), "code")).toBe("ambiguous_target")
        const candidates = candidatesOf(refused)
        expect(candidates.length).toBe(2)
        // The list rows under the same scope; a session's list cells equal a script's in 4.1, which its root does not
        // serve yet, so the script's list stands for the caller's.
        const listed = (Reflect.get(Object(await call("threads.list", undefined, { all_scope: true })), "threads") ??
          []) as readonly Record<string, unknown>[]
        for (const candidate of candidates) {
          const own = listed.find((listRow) => listRow["thread"] === candidate["thread"])
          expect(own).toBeDefined()
          const { preview, ...rest } = candidate
          expect(sameHome(rest)).toEqual(sameHome({ ...own }))
          expect(typeof preview).toBe("string")
        }
      })
})

describe("the projection itself", () => {
  const rows = [{ thread: "t-1", name: "lane", cwd: "/w", state: "idle" }]
  const candidates = [
    { thread: "t-1", name: "lane", cwd: "/w", preview: "last words", updatedAt: null, address: "here/t-1" },
    { thread: "t-9", name: "lane", cwd: "/elsewhere", preview: "hidden" },
  ]

  test("#given a row the caller may read #when projected #then the list row plus the preview", () => {
    expect(listProjectedCandidates(candidates, rows, () => true)).toEqual([{ ...rows[0], preview: "last words" }])
  })

  test("#given a row the caller may list but not read #when projected #then the list row without a preview", () => {
    expect(listProjectedCandidates(candidates, rows, () => false)).toEqual([{ ...rows[0] }])
  })

  test("#given a candidate whose thread the caller's list does not return #when projected #then it is not a candidate", () => {
    expect(listProjectedCandidates(candidates, rows, () => true).map((candidate) => candidate["thread"])).toEqual([
      "t-1",
    ])
  })

  test("#given device candidates #when projected #then each keeps its device id and name only", () => {
    expect(listProjectedCandidates([{ device: "b", name: "studio", online: true }], [], () => true)).toEqual([
      { device: "b", name: "studio" },
    ])
  })
})
