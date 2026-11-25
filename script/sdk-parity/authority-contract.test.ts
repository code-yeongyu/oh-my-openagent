import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

import {
  BEHAVIOUR_CHANGES,
  CUSTODY_RESULTS,
  GATED,
  AUTH_ACCOUNT_CHECK_CODES,
  AUTH_CHECK_FREE_FIELDS,
  type AuthStatusAnswer,
  sessionAnswerAccepts,
  SESSION_RESULTS,
  inputAccepts,
  OMO_CODE_REGISTRY,
  PRINCIPAL_ID,
  PRINCIPAL_KINDS,
  PRINCIPAL_MATRIX,
  REFUSALS,
  type RootAuthorityOptions,
  type RootCallInput,
  SOURCE_CODES,
} from "../../packages/omo-senpi/src/components/omo-sdk/contract"
import {
  behaviourChangeProblems,
  documentRowProblems,
  inventoryProblems,
  matrixProblems,
  refusalScenarioProblems,
  sectionFourRows,
  withoutAwaited,
} from "./authority-check"
import {
  AWAITING_ENGINE_PIN,
  AWAITING_REVISION,
  CALL_ALIASES,
  CUSTODY_FIELDS,
  HELD,
  SESSION_FIELDS,
} from "./authority-expected"
import {
  freeFieldMappingProblems,
  loadSnapshot,
  pinnedEngineExportsContract,
  sessionShapeProblems,
} from "./engine-snapshot-check"
import { REPO_ROOT } from "./registry"
import {
  type AUTHORITY_ROOT_OPTIONS,
  calls,
  files,
  isTyped,
  json,
  rows,
  securityDesign,
  sliceContract,
  sliceInputContract,
  sliceFiles,
  sliceRows,
  contractCalls,
  UNRESOLVED_IDS,
} from "./authority-scope"
import { inputProblems } from "./contract-check"
import { TYPED_AHEAD_INPUTS, typedAheadProblems } from "./typed-ahead"
import { custodyResultProblems, gatedProblems, principalInputProblems } from "./custody-check"
import { scenarioProblems, scenarioShapeProblems } from "./scenario-check"

// Slice P1a-s (#14949): the security-sensitive contracts of the omo SDK against the security design (#14945). Each check
// has a negative control in authority-controls.test.ts.
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false
type RequiredKeys<T> = { [K in keyof T]-?: object extends Pick<T, K> ? never : K }[keyof T]
// Every free (non-literal) string path of an answer type, as "accounts[].check.message".
type FreePaths<T, P extends string = ""> = T extends string
  ? string extends T
    ? P
    : never
  : T extends readonly (infer E)[]
    ? FreePaths<E, `${P}[]`>
    : T extends object
      ? { [K in keyof T & string]-?: FreePaths<NonNullable<T[K]>, P extends "" ? K : `${P}.${K}`> }[keyof T & string]
      : never
type Listed = (typeof AUTH_CHECK_FREE_FIELDS)[number]["field"]
type LeakyAnswer = Omit<AuthStatusAnswer, "accounts"> & {
  readonly accounts: readonly (AuthStatusAnswer["accounts"][number] & { readonly leaked: string })[]
}
const freeFieldTypeChecks: [true, true, true] = [
  // The planted list is every free path of the person's answer, and nothing else (review 6062824873 M1).
  true satisfies Equal<Exclude<FreePaths<AuthStatusAnswer>, Listed>, never>,
  true satisfies Equal<Exclude<Listed, FreePaths<AuthStatusAnswer>>, never>,
  // Control: an answer type with one added free field reports exactly that field as unplanted.
  true satisfies Equal<Exclude<FreePaths<LeakyAnswer>, Listed>, "accounts[].leaked">,
]
const authorityTypeChecks: [true, true, true] = [
  true satisfies Equal<keyof RootAuthorityOptions, (typeof AUTHORITY_ROOT_OPTIONS)[number]>,
  // A custody operation never picks where a secret goes because an argument was left out (security design 5.2).
  true satisfies Equal<"destination" & RequiredKeys<RootCallInput<"account.credentials.handOver">>, "destination">,
  true satisfies Equal<"destination" & RequiredKeys<RootCallInput<"engine.auth.apiKey">>, "destination">,
]

const CANARY = "omo-canary-sk-0000"

describe("principals of slice P1a-s (#14949)", () => {
  test("#given the type-level checks of this file #then each one compiled to true", () => {
    expect([...freeFieldTypeChecks, ...authorityTypeChecks].every((check) => check)).toBe(true)
  })

  test("#given the root #then it has the five principals of section 3, each with its id, and no call takes one", () => {
    expect([...PRINCIPAL_KINDS]).toEqual(["person", "script", "connector", "session", "service"])
    expect(PRINCIPAL_ID).toEqual({
      person: "uid",
      script: "uid",
      connector: "binding",
      session: "session_id",
      service: undefined,
    })
    expect(principalInputProblems(calls)).toEqual([])
  })

  test("#given section 4 #then every refused cell has its code and a scenario answering it before any side effect", () => {
    expect(matrixProblems(PRINCIPAL_MATRIX, rows, securityDesign, SOURCE_CODES)).toEqual([])
    expect(sectionFourRows(securityDesign).length).toBeGreaterThanOrEqual(50)
    expect(documentRowProblems(PRINCIPAL_MATRIX, securityDesign)).toEqual([])
    const ids = new Set(rows.filter((row) => row.kind === "capability").map((row) => row.id))
    const inventory = inventoryProblems(PRINCIPAL_MATRIX, REFUSALS, securityDesign, ids, CALL_ALIASES)
    expect(withoutAwaited(inventory, AWAITING_REVISION)).toEqual([])
    expect(refusalScenarioProblems(REFUSALS, BEHAVIOUR_CHANGES, files)).toEqual([])
  })

  test("#given section 10 #then B1 to B6 are data and each scenario asserts what its evidence flag selects", () => {
    expect(behaviourChangeProblems(BEHAVIOUR_CHANGES, files)).toEqual([])
  })
})

describe("custody of slice P1a-s (#14949)", () => {
  test("#given a credential-bearing call #then its answer is closed and has only its non-secret fields", () => {
    const results = Object.fromEntries(Object.entries(CUSTODY_RESULTS).map(([key, schema]) => [key, json(schema)]))
    expect(custodyResultProblems(results, CUSTODY_FIELDS)).toEqual([])
  })

  test("#given a session's engine.auth.check #then its answer is the engine's option (c) shape and no free string but the provider", () => {
    const results = Object.fromEntries(Object.entries(SESSION_RESULTS).map(([key, schema]) => [key, json(schema)]))
    expect(custodyResultProblems(results, SESSION_FIELDS)).toEqual([])
    const session = json(SESSION_RESULTS["engine.auth.check"])
    expect(stringLeaves(session)).toEqual(["provider"])
  })

  test("#given a canary in every free field of the person's answer #then no field of a session's answer holds it", () => {
    // Security design 4.3 at 137d6b9879, the owner's named RED test at the contract's layer; the engine half is E1a-s's.
    // The planted list is AUTH_CHECK_FREE_FIELDS, which a type check holds equal to every free path of the answer.
    const KEY = "sk-ant-api03-omo-canary-0000"
    const ADDRESS = "sk-ant-api03-omo-canary-0000@leak.test"
    const planted: string[] = AUTH_CHECK_FREE_FIELDS.map((entry) => entry.field)
    expect(planted.toSorted()).toEqual(stringLeaves(json(CUSTODY_RESULTS["engine.auth.check"])).toSorted())
    const valid = { status: "ready", provider: "p", accounts: [{ signed_in: true, check: "auth_error" }] }
    expect(sessionAnswerAccepts("engine.auth.check", valid)).toBe(true)
    const carriers = planted.filter(
      (path) =>
        path !== "provider" &&
        [KEY, ADDRESS].some((canary) => sessionAnswerAccepts("engine.auth.check", plantAt(valid, path, canary))),
    )
    expect(carriers).toEqual([])
    expect(sessionAnswerAccepts("engine.auth.check", plantAt(valid, "accounts[].check", ADDRESS))).toBe(false)
  })

  test("#given the engine's exports at 56cddc3b81 #then omo's table and session answer map to them in both directions", () => {
    const snapshot = loadSnapshot()
    expect(snapshot.source.commit).toBe("56cddc3b8137e0ff6f63975ed6e94fcf63c779e9")
    expect(freeFieldMappingProblems(snapshot.free_fields, AUTH_CHECK_FREE_FIELDS)).toEqual([])
    expect(sessionShapeProblems(snapshot, json(SESSION_RESULTS["engine.auth.check"]))).toEqual([])
    expect<readonly string[]>([...AUTH_ACCOUNT_CHECK_CODES]).toEqual([...snapshot.check_codes])
  })

  test("#given omo's engine pin #then it does not export the contract yet, or the snapshot is stale and must be replaced", () => {
    const manifest = JSON.parse(readFileSync(join(REPO_ROOT, "node_modules/@code-yeongyu/senpi/package.json"), "utf8"))
    // The engine pin's pull request owns the swap: delete the snapshot and import the engine's contract.
    expect({
      exportsContract: pinnedEngineExportsContract(manifest.exports ?? {}),
      why: AWAITING_ENGINE_PIN.why,
    }).toEqual({
      exportsContract: false,
      why: AWAITING_ENGINE_PIN.why,
    })
  })

  test("#given a secret offered as text #then no input takes it, and a hand-over with no destination is refused", () => {
    const peer = { kind: "peer", pid: 4242, started_at: "2026-11-25T00:00:00Z" }
    expect(inputAccepts("account.credentials.handOver", { what: "access_token", destination: peer })).toBe(true)
    expect(inputAccepts("account.credentials.handOver", { what: "access_token", destination: CANARY })).toBe(false)
    expect(inputAccepts("account.credentials.handOver", { what: "access_token" })).toBe(false)
    expect(inputAccepts("engine.auth.apiKey", { provider: "p" })).toBe(false)
    expect(inputAccepts("account.adopt", { credential: CANARY })).toBe(false)
    for (const mode of ["interactive", "rpc", "hand", "headless"])
      expect(inputAccepts(`engine.launch.${mode}`, { api_key: CANARY })).toBe(false)
    expect(inputAccepts("engine.launch.print", { input: {}, mode: "text", api_key: CANARY })).toBe(false)
  })
})

describe("the table P1a held, slice P1a-s (#14949)", () => {
  test("#given P1a's held table #then it is empty and each entry is typed or disposed of with its reason", () => {
    expect(gatedProblems(GATED, HELD, isTyped)).toEqual([])
  })

  test("#given the rows and fields this slice typed #then P1a's input, scenario and code checks hold over them", () => {
    expect(inputProblems(sliceRows, sliceInputContract)).toEqual([])
    expect(typedAheadProblems(TYPED_AHEAD_INPUTS, rows, contractCalls, UNRESOLVED_IDS)).toEqual([])
    expect(scenarioProblems(sliceRows, sliceContract, sliceFiles)).toEqual([])
    const byId = new Map(rows.map((row) => [row.id, row]))
    const elsewhere = files.flatMap((file) =>
      file.scenarios
        .filter((scenario) => !sliceRows.some((row) => row.id === scenario.row))
        .flatMap((scenario) => {
          const row = byId.get(scenario.row)
          if (row === undefined) return [`scenario ${scenario.id}: no row ${scenario.row}`]
          return scenarioShapeProblems(scenario, row, file.domain, sliceInputContract)
        }),
    )
    expect(elsewhere).toEqual([])
    const own = new Set(REFUSALS.map((refusal) => refusal.scenario))
    for (const scenario of files.flatMap((file) => file.scenarios))
      if (scenario.refusal !== undefined && (own.has(scenario.id) || scenario.id.includes("/authority-")))
        expect(OMO_CODE_REGISTRY).toHaveProperty(
          [scenario.refusal, "namespaces"],
          expect.arrayContaining([scenario.row.split(".")[0]]),
        )
  })
})

// Every string-typed leaf of a JSON schema, as a path ("accounts[].check.message"); enums and literals are not free text.
function stringLeaves(node: Record<string, unknown>, path = ""): string[] {
  const out: string[] = []
  if (node.type === "string" && node.enum === undefined && node.const === undefined) out.push(path)
  for (const [name, child] of Object.entries((node.properties ?? {}) as Record<string, Record<string, unknown>>))
    out.push(...stringLeaves(child, path === "" ? name : `${path}.${name}`))
  if (node.items !== undefined) out.push(...stringLeaves(node.items as Record<string, unknown>, `${path}[]`))
  for (const variant of (node.anyOf ?? []) as Record<string, unknown>[]) out.push(...stringLeaves(variant, path))
  return [...new Set(out)]
}

// A copy of `answer` with `value` set at `path`, creating the objects on the way; "[]" addresses the first element.
function plantAt(answer: Record<string, unknown>, path: string, value: string): Record<string, unknown> {
  const copy = structuredClone(answer)
  let cursor: Record<string, unknown> = copy
  const steps = path.split(".")
  for (const [index, raw] of steps.entries()) {
    const name = raw.replace(/\[\]$/, "")
    const last = index === steps.length - 1
    if (raw.endsWith("[]")) {
      const list = (cursor[name] as Record<string, unknown>[] | undefined) ?? [{}]
      cursor[name] = list
      cursor = list[0] ?? {}
    } else if (last) cursor[name] = value
    else {
      const next = cursor[name]
      cursor[name] = typeof next === "object" && next !== null ? next : {}
      cursor = cursor[name] as Record<string, unknown>
    }
  }
  return copy
}
