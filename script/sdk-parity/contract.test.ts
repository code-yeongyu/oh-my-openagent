import { describe, expect, test } from "bun:test"

import type { SetupPlan } from "../../packages/omo-senpi/src/components/omo-sdk/contract/results/host"
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
  cancellationOf,
  PORT_EFFECTS,
  GATED,
  HONOURED_CALLS,
  HELD_CODES,
  inputAccepts,
  OMO_CODE_REGISTRY,
  PORT_OPERATIONS,
  ROOT_CALLS,
  ROOT_OPTION_NAMES,
  SECURITY_SECTIONS,
  SOURCE_CODES,
} from "../../packages/omo-senpi/src/components/omo-sdk/contract"
import { callInputOf } from "./call-input"
import { codeProblems, type Contract, inputProblems, scopeProblems } from "./contract-check"
import { TYPED_AHEAD_INPUTS } from "./typed-ahead"
import { scenarioProblems } from "./scenario-check"
import { readFileSync } from "node:fs"
import { join } from "node:path"

import { UNRESOLVED_PATH } from "./baseline"
import { allRows, loadDomainFiles, REPO_ROOT } from "./registry"
import { portProblems } from "./expectation"
import { loadScenarioTable } from "./scenario-table"
import { syncRow } from "./sync-inputs"
import { tableProblems } from "./scenario-rules"

// Slice P1a (#14948): the root's type, the code registry, the scenario ids and the input schemas agree with the
// registry rows. Each check also runs once on a fixture that breaks it.

const contract: Contract = {
  calls: Object.fromEntries(Object.entries(ROOT_CALLS).map(([key, call]) => [key, callInputOf(call.input)])),
  gated: GATED,
  ports: PORT_OPERATIONS,
  sections: SECURITY_SECTIONS,
  rootOptions: ROOT_OPTION_NAMES,
  registry: OMO_CODE_REGISTRY,
  heldCodes: HELD_CODES,
  sourceCodes: SOURCE_CODES,
  accepts: (call, input) => inputAccepts(call, input),
  ahead: TYPED_AHEAD_INPUTS,
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
type AttachmentBytes = Extract<
  NonNullable<RootCallInput<"threads.send">["attachments"]>[number],
  { readonly bytes: unknown }
>["bytes"]
type PromptObject = Extract<NonNullable<RootCallInput<"threads.create">["prompt"]>, object>
// The root decides whether a call's input may be omitted with Partial<Input> extends Input (root.ts). It replaced
// {} extends Input, written here as Record<never, never>; both forms must give the same answer on every shape a root
// input can take and on every real root input.
type OmittableBefore<T> = Record<never, never> extends T ? true : false
type OmittableNow<T> = Partial<T> extends T ? true : false
type Agrees<T> = Equal<OmittableBefore<T>, OmittableNow<T>>
type Expect<T, Answer extends boolean> = Equal<OmittableNow<T>, Answer>
const omittableChecks: readonly true[] = [
  true satisfies Expect<{ readonly a: string }, false> & Agrees<{ readonly a: string }>,
  true satisfies Expect<{ readonly a?: string }, true> & Agrees<{ readonly a?: string }>,
  true satisfies Expect<Record<never, never>, true> & Agrees<Record<never, never>>,
  true satisfies Expect<Record<string, unknown>, true> & Agrees<Record<string, unknown>>,
  true satisfies Expect<{ readonly a?: string | undefined }, true> & Agrees<{ readonly a?: string | undefined }>,
  true satisfies Expect<{ readonly a: string | undefined }, false> & Agrees<{ readonly a: string | undefined }>,
  true satisfies Equal<{ [Key in RootCallKey]: Agrees<RootCallInput<Key>> }[RootCallKey], true>,
]

const rootTypeChecks: readonly true[] = [
  // Review 6061836983 H2: an instant call whose input has required fields takes that input as required.
  true satisfies Equal<undefined extends Parameters<OmoSdkRoot["daemon"]["shardPath"]>[0] ? true : false, false>,
  // H1: install.setup.apply takes the plan as required, as design 6.7 and the row have it.
  true satisfies Equal<undefined extends RootCallInput<"install.setup.apply">["plan"] ? true : false, false>,
  // Design lane ruling on M1: bytes are a Uint8Array on the root; the scenario table's fixture reference is not an input.
  true satisfies Equal<AttachmentBytes, Uint8Array>,
  true satisfies Equal<{ readonly $bytes: { readonly fixture: string } } extends AttachmentBytes ? true : false, false>,
  // Review 6061577043 H1: install.setup.apply takes the plan install.setup.plan answered, as that type.
  true satisfies Equal<NonNullable<RootCallInput<"install.setup.apply">["plan"]>, SetupPlan>,
  // H1: the object form of create's prompt is typed, with the connector's author slice P1a-s typed (#14949).
  true satisfies Equal<
    "author" extends keyof PromptObject ? ("message" extends keyof PromptObject ? true : false) : false,
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
  // A call that answers at once from this process takes no wait options.
  true satisfies Equal<Parameters<OmoSdkRoot["install"]["version"]>["length"], 0 | 1>,
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

  test("#given an attachment's bytes #then only a Uint8Array is accepted, never text or the table's fixture reference", () => {
    const send = (bytes: unknown): boolean =>
      inputAccepts("threads.send", { thread: "t", message: "m", attachments: [{ bytes, name: "a.txt" }] })
    expect(send(new Uint8Array([104, 105]))).toBe(true)
    expect(send("aGk=")).toBe(false)
    expect(send([104, 105])).toBe(false)
    expect(
      send({
        $bytes: {
          fixture: "hi",
          length: 2,
          sha256: "8f434346648f6b96df89dda901c5176b10a6d83961dd3c1ac88b59b2dc327aa4",
        },
      }),
    ).toBe(false)
  })
})

describe("input schemas of the root (review 6061577043)", () => {
  test("#given install.setup.apply #then the plan is required, in the shape install.setup.plan answers", () => {
    const plan = { inventory: { harnesses: [] }, stages: [{ id: "import-credentials", description: "import" }] }
    expect(inputAccepts("install.setup.apply", { consent: "all", plan })).toBe(true)
    expect(inputAccepts("install.setup.apply", { consent: "each" })).toBe(false)
    expect(inputAccepts("install.setup.apply", { consent: "all", plan: { stages: "all" } })).toBe(false)
  })

  test("#given engine.config.setResource #then exactly the global or the project-local form is accepted", () => {
    const base = { source: "npm:pkg", resource: { type: "skill", path: "skills/a" } }
    expect(inputAccepts("engine.config.setResource", { ...base, enabled: false })).toBe(true)
    expect(inputAccepts("engine.config.setResource", { ...base, trust: true, enabled: true })).toBe(true)
    expect(inputAccepts("engine.config.setResource", { ...base, local: true, state: "inherit" })).toBe(true)
    expect(inputAccepts("engine.config.setResource", base)).toBe(false)
    expect(inputAccepts("engine.config.setResource", { ...base, enabled: true, state: "load" })).toBe(false)
    expect(inputAccepts("engine.config.setResource", { ...base, local: true, enabled: true })).toBe(false)
    expect(inputAccepts("engine.config.setResource", { ...base, state: "unload" })).toBe(false)
    expect(inputAccepts("engine.config.setResource", { ...base, local: false, state: "load" })).toBe(false)
  })
})

describe("wait options against their cores (design lane ruling on review 6061342489 H4)", () => {
  const unresolved = new Set(
    (
      JSON.parse(readFileSync(join(REPO_ROOT, UNRESOLVED_PATH), "utf8")) as { entries: readonly { id: string }[] }
    ).entries.map((entry) => entry.id),
  )
  const waiting = Object.entries(ROOT_CALLS).flatMap(([key, call]) => (call.waits ? [key] : []))

  test("#given a call whose core ignores signal and deadline_ms today #then its row is still a recorded gap", () => {
    const gaps = waiting.filter((key) => cancellationOf(key as Parameters<typeof cancellationOf>[0]) === "gap")
    const built = gaps.flatMap((key) =>
      rows
        .filter((row) => row.kind === "capability" && row.sdk === key && !unresolved.has(row.id))
        .map((row) => row.id),
    )
    expect(built).toEqual([])
  })

  test("#given the calls marked honoured #then each is a call that can wait", () => {
    expect(HONOURED_CALLS.filter((key) => !waiting.includes(key))).toEqual([])
  })
})

describe("producers and sequences (review 6062113819)", () => {
  test("#given the recovery whose admission reply is lost #then the first prompt reaches b's session exactly once, on the retry", () => {
    // thread-create-remote-lost-reply.test.ts:228: admit_external_message + prompt on b's session total exactly one.
    const recovery = scenarios
      .flatMap((file) => file.scenarios)
      .find((scenario) => scenario.id === "threads.create/recovery-admission-lost")
    const sends = (expect: readonly { port: string; op: string; count?: number }[] | undefined): number =>
      (expect ?? [])
        .filter((e) => e.port === "remote" && e.op === "sessions.send")
        .reduce((sum, e) => sum + (e.count ?? 1), 0)
    expect(sends(recovery?.expect)).toBe(0)
    expect(recovery?.expect.some((e) => e.port === "remote" && e.op === "sessions.send" && e.count === 0)).toBe(true)
    expect(sends(recovery?.then?.[0]?.expect)).toBe(1)
  })

  test("#given internal_error #then the registry names threads, whose create answers it in a shipped test", () => {
    // thread/control/thread-create-remote-lost-reply.test.ts:218-229: a remote create whose recovery admission reply is
    // lost answers internal_error, so threads returns the code today.
    expect(OMO_CODE_REGISTRY.internal_error.namespaces).toContain("threads")
  })

  test("#given the lost-acknowledgement create retry #then its last step answers the original thread and device", () => {
    const retry = scenarios
      .flatMap((file) => file.scenarios)
      .find((scenario) => scenario.id === "threads.create/lost-ack-then-retry") as
      | {
          readonly then?: readonly {
            readonly kind: string
            readonly answer?: { readonly value?: Record<string, unknown> }
          }[]
        }
      | undefined
    const last = retry?.then?.at(-1)
    expect(last?.kind).toBe("effect")
    // A thread call's answer is the flat thread contract (design lane ruling on P0 review 6062172318).
    expect(last?.answer).toMatchObject({ kind: "ok", thread: "t-k9", device: "studio" })
  })
})

describe("the table under P0's shared scenario rules", () => {
  test("#given every scenario file #then each port, operation and fault is one the port table and FAULT_PORTS allow", () => {
    expect(
      portProblems(
        scenarios.flatMap((file) => file.scenarios),
        PORT_OPERATIONS,
      ),
    ).toEqual([])
  })

  test("#given every scenario file #then each row with a thread input has an effect scenario on each target", () => {
    const problems = tableProblems(
      rows,
      scenarios.flatMap((file) => file.scenarios),
    )
    expect(problems).toEqual([])
  })
})

describe("tables the root's consumers read", () => {
  test("#given the root's compile-time assertions #then every one of them holds", () => {
    expect([...rootTypeChecks, ...omittableChecks].every((holds) => holds)).toBe(true)
  })

  test("#given the effect classification P0's matcher takes #then every effect is an operation of its port", () => {
    const strays = Object.entries(PORT_EFFECTS).flatMap(([port, effects]) =>
      effects.filter(
        (op) => !(PORT_OPERATIONS[port as keyof typeof PORT_OPERATIONS] as readonly string[]).includes(op),
      ),
    )
    expect(strays).toEqual([])
  })

  test("#given every registry row #then its input is the root schema's typing of the fields it has (sync-inputs)", () => {
    expect(rows.filter((row) => JSON.stringify(syncRow(row)) !== JSON.stringify(row)).map((row) => row.id)).toEqual([])
  })
})
