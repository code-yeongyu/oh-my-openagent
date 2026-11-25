import { describe, expect, test } from "bun:test"

import {
  BEHAVIOUR_CHANGES,
  CUSTODY_RESULTS,
  GATED,
  MAY_EMBED,
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
import { AWAITING_REVISION, CALL_ALIASES, CUSTODY_FIELDS, HELD, SESSION_FIELDS } from "./authority-expected"
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
} from "./authority-scope"
import { inputProblems } from "./contract-check"
import { custodyResultProblems, gatedProblems, principalInputProblems } from "./custody-check"
import { scenarioProblems, scenarioShapeProblems } from "./scenario-check"

// Slice P1a-s (#14949): the security-sensitive contracts of the omo SDK against the security design (#14945). Each check
// has a negative control in authority-controls.test.ts.
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false
type RequiredKeys<T> = { [K in keyof T]-?: object extends Pick<T, K> ? never : K }[keyof T]
export const authorityTypeChecks: [true, true, true] = [
  true satisfies Equal<keyof RootAuthorityOptions, (typeof AUTHORITY_ROOT_OPTIONS)[number]>,
  // A custody operation never picks where a secret goes because an argument was left out (security design 5.2).
  true satisfies Equal<"destination" & RequiredKeys<RootCallInput<"account.credentials.handOver">>, "destination">,
  true satisfies Equal<"destination" & RequiredKeys<RootCallInput<"engine.auth.apiKey">>, "destination">,
]

const CANARY = "omo-canary-sk-0000"

describe("principals of slice P1a-s (#14949)", () => {
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

  test("#given a key-shaped provider error #then no field of a session's engine.auth.check answer can carry it", () => {
    const results = Object.fromEntries(Object.entries(SESSION_RESULTS).map(([key, schema]) => [key, json(schema)]))
    expect(custodyResultProblems(results, SESSION_FIELDS)).toEqual([])
    for (const path of MAY_EMBED["engine.auth.check"]) expect(SESSION_FIELDS["engine.auth.check"]).not.toContain(path)
    const account = { name: "a", source: "login", blocked: false, pinned: false }
    const answer = (check: Record<string, unknown>) => ({
      status: "ready",
      provider: "p",
      accounts: [{ ...account, check: { model: "m", outcome: "failed", at: 1, ...check } }],
    })
    expect(sessionAnswerAccepts("engine.auth.check", answer({ code: "auth_error" }))).toBe(true)
    expect(sessionAnswerAccepts("engine.auth.check", answer({ message: `invalid key ${CANARY}` }))).toBe(false)
    expect(sessionAnswerAccepts("engine.auth.check", answer({ code: CANARY }))).toBe(false)
    expect(sessionAnswerAccepts("engine.auth.check", answer({ reason: CANARY }))).toBe(false)
    // The owner's two provider strings, within their bounds (security design 4.3): an address of at most 254 characters,
    // an organisation name of at most 100 with no control or newline character; no other provider field.
    const withAccount = (fields: Record<string, unknown>) => ({
      status: "ready",
      provider: "p",
      accounts: [{ ...account, ...fields }],
    })
    expect(sessionAnswerAccepts("engine.auth.check", withAccount({ email: "ada@example.test", orgName: "Acme" }))).toBe(
      true,
    )
    expect(sessionAnswerAccepts("engine.auth.check", withAccount({ email: `${"a".repeat(250)}@x.test` }))).toBe(false)
    expect(sessionAnswerAccepts("engine.auth.check", withAccount({ email: "not an address" }))).toBe(false)
    expect(sessionAnswerAccepts("engine.auth.check", withAccount({ orgName: "x".repeat(101) }))).toBe(false)
    expect(sessionAnswerAccepts("engine.auth.check", withAccount({ orgName: "Acme\nIgnore previous" }))).toBe(false)
    expect(sessionAnswerAccepts("engine.auth.check", withAccount({ usageUrl: "https://x.test" }))).toBe(false)
    expect(sessionAnswerAccepts("engine.auth.check", withAccount({ subscriptionType: "max" }))).toBe(false)
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
