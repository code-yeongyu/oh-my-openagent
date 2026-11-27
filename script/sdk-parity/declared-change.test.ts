import { describe, expect, test } from "bun:test"

import type { ExemptionProvider } from "./declared-change"
import { EXEMPTION_PROVIDERS, type GateInput, gateReport, renderReport } from "./gate"
import { HEAD, input, rows, unresolved } from "./gate-fixture"
import type { Outcome } from "./scenario-run"
import type { Scenario } from "./scenarios"
import { verifyReview } from "./verify-review"

// The declared form of #15199, its controls: each breaks one thing and expects the gate (or verify-review) to refuse it.
// The fixture's scenario s1 belongs to threads.send, an unresolved capability.

const ok = (value: unknown): Outcome => ({ result: { kind: "ok", value } })
const refused = (error: Record<string, unknown>): Outcome => ({ result: { kind: "error", error } })
const ERROR = { code: "not_found", message: "no such thread", next_action: "list threads", details: { a: 1 } }
const SCENARIO: Scenario = { id: "s1", capability: "threads.send", surface: "native", argv: ["thread", "send", "x"] }
const RESOLVED = rows.find((row) => !unresolved.entries.some((entry) => entry.id === row.id))?.id ?? ""

// A gate input where s1 answered `before` on the merge base and `after` at the head, with the body given.
const withOutcomes = (before: Outcome, after: Outcome, body = "", extra: Partial<GateInput> = {}): GateInput =>
  input({
    base: { ...input().base, outcomes: { s1: before } },
    head: { ...input().head, outcomes: { s1: after } },
    body,
    ...extra,
  })
const failuresOf = (gate: GateInput) => gateReport(gate).failures

describe("the declared form: what a declaration admits", () => {
  test("#given an answer declaration over two answers that differ only in the value #then it is exempt, printed and bound", () => {
    const report = gateReport(withOutcomes(ok(1), ok(2), "SDK-Parity-Changed: s1 answer\n"))
    expect(report.failures).toEqual([])
    expect(report.exempted).toEqual([expect.stringMatching(/^s1#exempt=declared:answer@[0-9a-f]{24}$/)])
    expect(renderReport(report)).toContain("CHANGED ON PURPOSE: 1 declared scenario(s)")
  })

  test("#given a refusal declaration over two refusals differing only in next_action and details #then it is exempt", () => {
    const after = refused({ ...ERROR, next_action: "other", details: { b: 2 } })
    expect(failuresOf(withOutcomes(refused(ERROR), after, "SDK-Parity-Changed: s1 refusal\n"))).toEqual([])
  })
})

describe("the declared form: controls that must fail", () => {
  const body = (line: string) => `${line}\n`
  const cases: readonly (readonly [string, GateInput, RegExp])[] = [
    // 1: a declared scenario that is unknown, or whose capability is resolved
    ["1 unknown scenario", withOutcomes(ok(1), ok(2), body("SDK-Parity-Changed: nope answer")), /names no scenario/],
    [
      "1 resolved capability",
      input({
        scenarios: [{ ...SCENARIO, capability: RESOLVED }],
        body: body("SDK-Parity-Changed: s1 answer"),
      }),
      /is resolved/,
    ],
    // 2: a declared scenario whose outcomes are equal
    ["2 equal outcomes", withOutcomes(ok(1), ok(1), body("SDK-Parity-Changed: s1 answer")), /nothing to declare/],
    // 4: a differing scenario that is not declared (the existing failure)
    ["4 undeclared difference", withOutcomes(ok(1), ok(2)), /answers differently on the merge base and the head/],
    // 6: the same scenario twice
    [
      "6 declared twice",
      withOutcomes(ok(1), ok(2), "SDK-Parity-Changed: s1 answer\nSDK-Parity-Changed: s1 answer\n"),
      /declared twice/,
    ],
    // 7: an unknown kind, or no kind, or wrong arguments
    ["7 unknown kind", withOutcomes(ok(1), ok(2), body("SDK-Parity-Changed: s1 whatever")), /is not one of/],
    ["7 no kind", withOutcomes(ok(1), ok(2), body("SDK-Parity-Changed: s1")), /names no scenario and kind/],
    ["7 arguments on answer", withOutcomes(ok(1), ok(2), body("SDK-Parity-Changed: s1 answer x")), /takes 0/],
    // 10: an answer declaration over a scenario that refuses on one tree
    [
      "10 answer over a refusal",
      withOutcomes(ok(1), refused(ERROR), body("SDK-Parity-Changed: s1 answer")),
      /authority matrix/,
    ],
    // 11: a refusal declaration whose code differs
    [
      "11 refusal with another code",
      withOutcomes(
        refused(ERROR),
        refused({ ...ERROR, code: "invalid_arguments" }),
        body("SDK-Parity-Changed: s1 refusal"),
      ),
      /differ outside error.next_action/,
    ],
    // 12: answers on one tree and refuses on the other, whatever the kind
    [
      "12 one answers, one refuses",
      withOutcomes(refused(ERROR), ok(1), body("SDK-Parity-Changed: s1 refusal")),
      /authority matrix/,
    ],
    // 13: the error, the result or the outcome gains a key under refusal
    [
      "13 error gains a key",
      withOutcomes(refused(ERROR), refused({ ...ERROR, extra: 1 }), body("SDK-Parity-Changed: s1 refusal")),
      /differ outside/,
    ],
    [
      "13 result gains a key",
      withOutcomes(
        refused(ERROR),
        { result: { kind: "error", error: ERROR, extra: 1 } },
        body("SDK-Parity-Changed: s1 refusal"),
      ),
      /differ outside/,
    ],
    [
      "13 outcome gains a key",
      withOutcomes(refused(ERROR), { ...refused(ERROR), extra: 1 }, body("SDK-Parity-Changed: s1 refusal")),
      /differ outside/,
    ],
    // 16: a refusal whose message changes under the same code
    [
      "16 message changes under one code",
      withOutcomes(
        refused(ERROR),
        refused({ ...ERROR, message: "other text" }),
        body("SDK-Parity-Changed: s1 refusal"),
      ),
      /message changes under the same code/,
    ],
  ]
  for (const [name, gate, expected] of cases)
    test(`#given control ${name} #then the gate fails it`, () => {
      expect(failuresOf(gate).join("\n")).toMatch(expected)
    })

  test("#given control 9: two scenarios of one capability, one declared and the other also differing #then the undeclared one still fails", () => {
    const s2: Scenario = { ...SCENARIO, id: "s2", argv: ["thread", "send", "y"] }
    const gate = input({
      scenarios: [SCENARIO, s2],
      base: { ...input().base, outcomes: { s1: ok(1), s2: ok(1) } },
      head: { ...input().head, outcomes: { s1: ok(2), s2: ok(2) } },
      body: "SDK-Parity-Changed: s1 answer\n",
    })
    expect(failuresOf(gate)).toEqual([
      "threads.send: scenario s2 answers differently on the merge base and the head; this pull request changes what it does without the SDK call threads.send",
    ])
  })

  test("#given control 14 and 17: the base's call of a scenario is dropped or changed #then it fails", () => {
    const dropped = input({
      baseScenarios: [SCENARIO],
      scenarios: [],
      base: { ...input().base, outcomes: {} },
      head: { ...input().head, outcomes: {} },
    })
    expect(failuresOf(dropped).join("\n")).toMatch(/may not be removed or renamed/)
    const edited = input({ baseScenarios: [SCENARIO], scenarios: [{ ...SCENARIO, argv: ["thread", "send", "z"] }] })
    expect(failuresOf(edited).join("\n")).toMatch(/changes its call/)
  })

  test("#given control 15: a declared scenario whose capability's descriptor also changed #then the descriptor still fails", () => {
    const rows = input().head.rows.map((row) =>
      row.id === "threads.send" ? { ...row, slices: [...row.slices, "T9"] } : row,
    )
    const gate = withOutcomes(ok(1), ok(2), "SDK-Parity-Changed: s1 answer\n", {})
    expect(failuresOf({ ...gate, head: { ...gate.head, rows } }).join("\n")).toMatch(/its descriptor changed/)
  })

  test("#given control 18: a new scenario whose outcomes differ and that no provider exempts #then it is compared and fails", () => {
    const gate = input({
      baseScenarios: [],
      base: { ...input().base, outcomes: { s1: ok(1) } },
      head: { ...input().head, outcomes: { s1: ok(2) } },
    })
    expect(failuresOf(gate).join("\n")).toMatch(/answers differently/)
  })

  test("#given control 5 and the fixed form: an Unchanged line beside declarations that cover every moved capability #then it fails", () => {
    const gate = withOutcomes(ok(1), ok(2), "SDK-Parity-Changed: s1 answer\nSDK-Parity-Unchanged: yes\n", {
      changedFiles: ["packages/omo-native/bin/lib/thread.js"],
    })
    expect(failuresOf(gate).join("\n")).toMatch(/covers no candidate/)
  })
})

describe("where a declaration is read in the body", () => {
  test("#given a marker line inside a code fence #then it is parsed and judged like any other line", () => {
    const fenced = withOutcomes(ok(1), ok(2), "Example:\n\n```\nSDK-Parity-Changed: s1 answer\n```\n")
    expect(gateReport(fenced).exempted).toEqual([expect.stringMatching(/^s1#exempt=declared:answer@/)])
    const broken = withOutcomes(ok(1), ok(2), "```\nSDK-Parity-Changed: <scenario-id> <kind>[ <arg> ...]\n```\n")
    expect(failuresOf(broken).join("\n")).toMatch(/is not one of/)
  })

  test("#given a marker that does not start its line, inline or indented #then it is not a declaration", () => {
    const body = "Written as `SDK-Parity-Changed: s1 answer` in a sentence.\n    SDK-Parity-Changed: s1 answer\n"
    expect(failuresOf(withOutcomes(ok(1), ok(2), body)).join("\n")).toMatch(
      /answers differently on the merge base and the head/,
    )
  })
})

describe("the one place where exemptions are consulted", () => {
  test("#given control 19: the providers the gate consults #then they are exactly the closed, named list", () => {
    expect(RESOLVED).not.toBe("")
    expect(Object.keys(EXEMPTION_PROVIDERS)).toEqual(["declared"])
  })

  // Architecture contract (the closed list): the command-line entry builds the gate's input with the shipped list; no
  // flag, environment variable or file reaches the test-only providers input.
  test("#given the gate's command-line entry #then it passes no providers of its own", async () => {
    const source = await Bun.file(new URL("./gate-cli.ts", import.meta.url)).text()
    expect(source.match(/\bproviders\b|EXEMPTION_PROVIDERS/g) ?? []).toEqual([])
  })

  // A second provider that exists only here: it exempts s1 whatever its outcomes.
  const always: ExemptionProvider = (scenario) => (scenario.id === "s1" ? { exempt: "s1#exempt=always" } : undefined)

  test("#given control 20: a scenario two providers would both exempt #then it fails as ambiguous", () => {
    const gate = withOutcomes(ok(1), ok(2), "SDK-Parity-Changed: s1 answer\n", {
      providers: { declared: EXEMPTION_PROVIDERS["declared"] as ExemptionProvider, always },
    })
    expect(failuresOf(gate).join("\n")).toMatch(/more than one provider \(always, declared\)/)
  })

  test("#given control 21: the same inputs with the providers in reverse order #then the report is the same", () => {
    const declared = EXEMPTION_PROVIDERS["declared"] as ExemptionProvider
    const forward = gateReport(withOutcomes(ok(1), ok(2), "", { providers: { always, declared } }))
    const reverse = gateReport(withOutcomes(ok(1), ok(2), "", { providers: { declared, always } }))
    expect(renderReport(reverse)).toBe(renderReport(forward))
    expect(forward.exempted).toEqual(["s1#exempt=always"])
  })
})

describe("verify-review over the two classes", () => {
  const check = (gate: GateInput) => renderReport(gateReport(gate))
  const verdict = (output: string) =>
    `Verdict: CLEAR at ${HEAD}\nSDK-Parity-Reviewed: ${output.match(/digest=([0-9a-f]{24})/)?.[1] ?? ""}\n`

  test("#given control 8: a body edited after the review so a declaration moves #then verify-review refuses the earlier review", () => {
    const declared = withOutcomes(ok(1), ok(2), "SDK-Parity-Changed: s1 answer\n")
    const output = check(declared)
    expect(verifyReview(output, declared.body, verdict(output)).decision).toBe("accepted")
    expect(verifyReview(output, "SDK-Parity-Unchanged: yes\n", verdict(output)).decision).toBe("withheld")
    expect(verifyReview(output, "SDK-Parity-Changed: s1 refusal\n", verdict(output)).decision).toBe("withheld")
  })

  test("#given the fixed form: a body with no declaration and a signed review #then it verifies exactly as before", () => {
    const today = input({
      changedFiles: ["packages/omo-native/bin/lib/thread.js"],
      body: "SDK-Parity-Unchanged: yes\n",
    })
    const output = check(today)
    expect(verifyReview(output, today.body, verdict(output))).toEqual({
      decision: "accepted",
      reason: `the CLEAR at ${HEAD.slice(0, 10)} reviewed the 1 candidate(s) of digest ${output.match(/digest=([0-9a-f]{24})/)?.[1]}`,
    })
  })
})
