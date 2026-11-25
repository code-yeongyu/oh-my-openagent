import { describe, expect, test } from "bun:test"

import type { ReleaseSessionReply } from "../../packages/omo-senpi/src/components/thread/gateway/adapter"
import type { FollowOutcome } from "../../packages/omo-senpi/src/components/remote/types"
import type {
  CallOptions,
  OmoFailure,
  OmoSdkRoot,
  OmoStream,
  OmoStreamEvent,
  OmoValue,
  RootCallInput,
  RootCallKey,
} from "../../packages/omo-senpi/src/components/omo-sdk/contract"
import {
  GATED,
  HELD_CODES,
  inputAccepts,
  OMO_CODE_REGISTRY,
  PORT_OPERATIONS,
  ROOT_CALLS,
  ROOT_OPTION_NAMES,
  SECURITY_SECTIONS,
  SOURCE_CODES,
} from "../../packages/omo-senpi/src/components/omo-sdk/contract"
import { type CallInput, codeProblems, type Contract, inputProblems, scopeProblems } from "./contract-check"
import { scenarioProblems } from "./scenario-check"
import { allRows, loadDomainFiles } from "./registry"
import { loadScenarioTable } from "./scenario-table"

// Slice P1a (#14948): the root's type, the code registry, the scenario ids and the input schemas agree with the
// registry rows. Each check also runs once on a fixture that breaks it.

const asInput = (schema: unknown): CallInput => {
  const json = JSON.parse(JSON.stringify(schema)) as Partial<CallInput>
  return { properties: json.properties ?? {}, required: json.required ?? [] }
}

const contract: Contract = {
  calls: Object.fromEntries(Object.entries(ROOT_CALLS).map(([key, call]) => [key, asInput(call.input)])),
  gated: GATED,
  ports: PORT_OPERATIONS,
  sections: SECURITY_SECTIONS,
  rootOptions: ROOT_OPTION_NAMES,
  registry: OMO_CODE_REGISTRY,
  heldCodes: HELD_CODES,
  sourceCodes: SOURCE_CODES,
  accepts: (call, input) => inputAccepts(call, input),
}

// The root's type is computed from ROOT_CALLS (design 4.1): these fail the typecheck when a member goes missing, takes
// another input than its schema's static type, or answers outside the three shapes of 4.4.
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false
type Leaves<T, Prefix extends string = ""> = {
  [Key in keyof T & string]: T[Key] extends (...args: never[]) => unknown
    ? `${Prefix}${Key}`
    : Leaves<T[Key], `${Prefix}${Key}.`>
}[keyof T & string]
type FollowEventOf<Stream> =
  Stream extends OmoStream<unknown, unknown> ? (Stream extends AsyncIterable<infer E> ? E : never) : never
type FollowStep = FollowEventOf<ReturnType<OmoSdkRoot["threads"]["follow"]>>
type PromptObject = Extract<NonNullable<RootCallInput<"threads.create">["prompt"]>, object>
export const rootTypeChecks: [true, true, true, true, true, true, true, true, true, true] = [
  // H1: the object form of create's prompt is typed, without the author P1a-s holds.
  true satisfies Equal<
    "author" extends keyof PromptObject ? false : "message" extends keyof PromptObject ? true : false,
    true
  >,
  true satisfies Equal<Exclude<Leaves<OmoSdkRoot>, "close" | "dispose">, RootCallKey>,
  true satisfies Equal<Parameters<OmoSdkRoot["threads"]["setModel"]>[0], RootCallInput<"threads.setModel">>,
  true satisfies Equal<
    Extract<Awaited<ReturnType<OmoSdkRoot["devices"]["rename"]>>, OmoFailure>,
    OmoFailure & Extract<OmoValue<never>, OmoFailure>
  >,
  true satisfies ReturnType<OmoSdkRoot["threads"]["follow"]> extends OmoStream<unknown, unknown> ? true : false,
  // Review 6061342489 H2: threads.release answers the engine's own reply as its value (design 4.4).
  true satisfies Equal<Awaited<ReturnType<OmoSdkRoot["threads"]["release"]>>, OmoValue<ReleaseSessionReply>>,
  // H3: one terminal event ends a follow; no nonterminal event carries the remote stream's own end or failure.
  true satisfies Equal<Extract<FollowStep, { readonly kind: "event" }>["event"]["kind"] & ("end" | "failed"), never>,
  true satisfies Equal<
    Extract<FollowStep, { readonly outcome: unknown }>,
    Extract<OmoStreamEvent<never, FollowOutcome>, { readonly outcome: unknown }>
  >,
  // H4: every call takes the wait options of 4.4; a call whose input already names deadline_ms takes only the signal.
  true satisfies Equal<Parameters<OmoSdkRoot["threads"]["readAfterWait"]>[1], CallOptions | undefined>,
  true satisfies Equal<Parameters<OmoSdkRoot["threads"]["wait"]>[1], Omit<CallOptions, "deadline_ms"> | undefined>,
]

const rows = allRows(loadDomainFiles())
const scenarios = loadScenarioTable()

describe("SDK contract of slice P1a (#14948)", () => {
  test("#given the registry rows #then the root type has one call per P1a row and holds the rest for P1a-s", () => {
    expect(scopeProblems(rows, contract)).toEqual([])
  })

  test("#given each P1a call #then its input schema equals its row's input, field by field", () => {
    expect(inputProblems(rows, contract)).toEqual([])
  })

  test("#given the scenario table #then every code a row returns is registered, and every registered code is returned", () => {
    expect(codeProblems(rows, contract, scenarios)).toEqual([])
  })

  test("#given the scenario table #then each scenario is observable and each behaviour input has one", () => {
    expect(scenarioProblems(rows, contract, scenarios)).toEqual([])
  })
})

describe("input schemas of the root (review 6061342489)", () => {
  test("#given threads.create #then the prompt is a string or the object form, never with the held author", () => {
    expect(inputAccepts("threads.create", { prompt: "hi" })).toBe(true)
    expect(
      inputAccepts("threads.create", { prompt: { message: "hi", delivery: "steer", expected_turn_id: "t1" } }),
    ).toBe(true)
    expect(inputAccepts("threads.create", { prompt: {} })).toBe(false)
  })

  test("#given an attachment's bytes #then only base64 text is accepted, as the schema states", () => {
    const send = (bytes: unknown): boolean =>
      inputAccepts("threads.send", { thread: "t", message: "m", attachments: [{ bytes, name: "a.txt" }] })
    expect(send("aGk=")).toBe(true)
    expect(send("not base64!")).toBe(false)
    expect(send(new Uint8Array([104, 105]))).toBe(false)
  })
})
