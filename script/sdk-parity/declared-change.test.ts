import { afterAll, describe, expect, test } from "bun:test"

import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { sha256 } from "./baseline"
import { type ExemptionProvider, loadBaseScenarioTable } from "./declared-change"
import { candidateDigest, EXEMPTION_PROVIDERS, type GateInput, gateReport, renderReport } from "./gate"
import { HEAD, input, rows, text, unresolved } from "./gate-fixture"
import type { Outcome } from "./scenario-run"
import { SCENARIOS, type Scenario } from "./scenarios"
import { readDeclaredVersions } from "./version-mask"
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
    expect(report.exempted).toEqual([expect.stringMatching(/^s1#exempt=declared:answer@[0-9a-f]{24}\/[0-9a-f]{24}$/)])
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
  // The security reader's measured table, each line as exact bytes. Read: a declaration; refused: read and failed with
  // its problem; not read: no declaration, so the difference fails as undeclared.
  const read = /^s1#exempt=declared:answer@/
  const VARIANTS: readonly (readonly [string, string, "read" | RegExp | "not read"])[] = [
    ["plain", "SDK-Parity-Changed: s1 answer", "read"],
    ["CRLF", "SDK-Parity-Changed: s1 answer\r", "read"],
    ["no space after the colon", "SDK-Parity-Changed:s1 answer", "read"],
    ["trailing spaces", "SDK-Parity-Changed: s1 answer   ", "read"],
    ["two spaces between the tokens", "SDK-Parity-Changed: s1  answer", /the kind {2}is not one of/],
    ["a tab between the tokens", "SDK-Parity-Changed:\ts1\tanswer", /names no scenario and kind/],
    ["trailing text", "SDK-Parity-Changed: s1 answer (see above)", /takes 0 argument\(s\), not 2/],
    ["a leading space", " SDK-Parity-Changed: s1 answer", "not read"],
    ["a lower-case marker", "sdk-parity-changed: s1 answer", "read"],
    ["a quote block", "> SDK-Parity-Changed: s1 answer", "not read"],
    ["inside backticks", "`SDK-Parity-Changed: s1 answer`", "not read"],
    ["a list item", "- SDK-Parity-Changed: s1 answer", "not read"],
    ["inside a fence", "```\nSDK-Parity-Changed: s1 answer\n```", "read"],
    ["inside an HTML comment", "<!--\nSDK-Parity-Changed: s1 answer\n-->", "read"],
    [
      "the marker twice on one line",
      "SDK-Parity-Changed: s1 answer SDK-Parity-Changed: s2 answer",
      /takes 0 argument\(s\), not 3/,
    ],
    ["a mixed-case kind", "SDK-Parity-Changed: s1 Answer", /the kind Answer is not one of/],
  ]
  for (const [name, line, expected] of VARIANTS)
    test(`#given ${name} #then the line is ${expected === "read" ? "read" : expected === "not read" ? "not read" : "read and refused"}`, () => {
      const report = gateReport(withOutcomes(ok(1), ok(2), `intro\n${line}\nmore\n`))
      if (expected === "read") {
        expect(report.failures).toEqual([])
        expect(report.exempted).toEqual([expect.stringMatching(read)])
      } else if (expected === "not read")
        expect(report.failures).toEqual([expect.stringMatching(/scenario s1 answers differently/)])
      else expect(report.failures.join("\n")).toMatch(expected)
    })
})

describe("the merge base's scenario table", () => {
  const dirs: string[] = []
  afterAll(() => {
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
  })
  const file = (body: string) => {
    const dir = mkdtempSync(join(tmpdir(), "sdk-parity-base-table-"))
    dirs.push(dir)
    const path = join(dir, "scenarios.ts")
    writeFileSync(path, body)
    return path
  }

  test("#given a base table that throws on import, or exports no table #then loading it fails with its error", async () => {
    await expect(loadBaseScenarioTable(file('throw new Error("broken table")\n'))).rejects.toThrow("broken table")
    await expect(loadBaseScenarioTable(file("export const OTHER = 1\n"))).rejects.toThrow("exports no SCENARIOS array")
  })

  // Tripwire on the entry's wiring: only an absent file skips the rule; a load failure is a failure of the check.
  test("#given the command-line entry #then it skips the rule only when the base has no table file", async () => {
    const source = await Bun.file(new URL("./gate-cli.ts", import.meta.url)).text()
    expect(source).toContain('show(mergeBase, "script/sdk-parity/scenarios.ts") === undefined')
    expect(source).toContain("...(baseTableProblem === undefined ? [] : [baseTableProblem])")
    // A table that fails to load is bound as an empty one, so the report says '0 merge-base scenarios bound', never
    // that the merge base has no table.
    const handler = source.slice(
      source.indexOf("loadBaseScenarioTable(join(baseTree"),
      source.indexOf("})", source.indexOf("baseTableProblem = ")) + 2,
    )
    expect(handler).toMatch(/return \[\]\s*\}\)$/)
  })
})

describe("the exempt mark and what it binds", () => {
  test("#given a provider whose detail carries a separator #then the gate fails it and writes no mark", () => {
    for (const detail of ["answer@x#exempt=declared:answer@y", "a,b", "a\nb"]) {
      const forging: ExemptionProvider = () => ({ detail })
      const report = gateReport(withOutcomes(ok(1), ok(2), ""), { forging })
      expect({ failures: report.failures.join("\n"), exempted: report.exempted }).toEqual({
        failures: expect.stringMatching(/provider forging answered a detail with a reserved character/),
        exempted: [],
      })
    }
  })

  test("#given any provider #then the gate writes the scenario and that provider's name, never the provider", () => {
    const named: ExemptionProvider = () => ({ detail: "x" })
    expect(gateReport(withOutcomes(ok(1), ok(2), ""), { named }).exempted).toEqual(["s1#exempt=named:x"])
  })

  test("#given a declared change #then its mark binds the head outcome's hash and the base outcome's", () => {
    const hash = (outcome: Outcome) => sha256(JSON.stringify(outcome)).slice(0, 24)
    const report = gateReport(withOutcomes(ok(1), ok(2), "SDK-Parity-Changed: s1 answer\n"))
    expect(report.exempted).toEqual([`s1#exempt=declared:answer@${hash(ok(2))}/${hash(ok(1))}`])
  })

  test("#given the same declared head over another base, or another head over the same base #then the digest changes", () => {
    const body = "SDK-Parity-Changed: s1 answer\n"
    const digest = (before: Outcome, after: Outcome) => gateReport(withOutcomes(before, after, body)).digest
    expect(new Set([digest(ok(1), ok(2)), digest(ok(0), ok(2)), digest(ok(1), ok(3))]).size).toBe(3)
  })

  test("#given a report with an exempt mark #then its digest is the one over that mark", () => {
    const report = gateReport(withOutcomes(ok(1), ok(2), "SDK-Parity-Changed: s1 answer\n"))
    expect(report.digest).toBe(candidateDigest(HEAD, [...report.exempted]))
    expect(report.digest).not.toBe(candidateDigest(HEAD, []))
  })

  test("#given a declared outcome with masked spans #then the print counts each mask on each side", () => {
    const output = renderReport(
      gateReport(withOutcomes(ok("<sandbox>/a <sandbox>/b"), ok("<sandbox>/c"), "SDK-Parity-Changed: s1 answer\n")),
    )
    expect(output).toContain("[masked: <sandbox> x2]")
    expect(output).toContain("[masked: <sandbox> x1]")
  })

  test("#given a scenario with no outcome at the merge base #then it fails as not run", () => {
    const gate = input({ base: { ...input().base, outcomes: {} }, head: { ...input().head, outcomes: { s1: ok(1) } } })
    expect(failuresOf(gate)).toEqual([
      "threads.send: scenario s1 has no outcome at the merge base; the runner did not run it",
    ])
  })

  test("#given outcomes equal for 900 characters and different after #then the print shows the difference and says the heads match", () => {
    const long = "x".repeat(900)
    const output = renderReport(
      gateReport(withOutcomes(ok(`${long}A`), ok(`${long}B`), "SDK-Parity-Changed: s1 answer\n")),
    )
    expect(output).toMatch(/first difference at offset \d+; the printed heads above are equal/)
    expect(output).toMatch(/merge base: \.\.\.x+A/)
    expect(output).toMatch(/head: {7}\.\.\.x+B/)
  })

  test("#given a declared scenario whose difference the version mask absorbs #then the declaration fails as never judged", () => {
    const declared = readDeclaredVersions(".")
    if (declared === undefined) throw new Error("the repository has no native package manifest")
    const committed = JSON.parse(text("script/sdk-parity/goldens.json")) as Record<string, Outcome>
    const base = committed["native-version"] ?? {}
    const bumped = { ...declared, engine: "2099.1.2" }
    const after = { ...base, stdout: `${base["stdout"]}`.split(declared.engine).join("2099.1.2") }
    const report = gateReport(
      input({
        scenarios: SCENARIOS.filter((scenario) => scenario.id === "native-version"),
        base: { ...input().base, outcomes: { "native-version": base } },
        head: { ...input().head, outcomes: { "native-version": after } },
        versions: { base: declared, head: bumped },
        body: "SDK-Parity-Changed: native-version answer\n",
      }),
    )
    expect(report.versionMasked).toEqual(["native-version#version-mask"])
    expect(report.failures).toEqual([expect.stringMatching(/native-version: its difference is admitted elsewhere/)])
  })
})

describe("the call part of each surface", () => {
  const tool: Scenario = {
    id: "s1",
    capability: "threads.send",
    surface: "tool",
    tool: "thread_send",
    args: { thread: "a" },
  }
  const sdk: Scenario = {
    id: "s1",
    capability: "threads.send",
    surface: "sdk",
    member: "config.status",
    files: { a: "1" },
  }
  for (const [name, baseScenario, headScenario] of [
    ["a tool scenario's args", tool, { ...tool, args: { thread: "b" } }],
    ["an sdk scenario's files", sdk, { ...sdk, files: { a: "2" } }],
    ["an sdk scenario's member", sdk, { ...sdk, member: "config.other" }],
  ] as const)
    test(`#given ${name} changed at the head #then the scenario's call changed and it fails`, () => {
      expect(failuresOf(input({ baseScenarios: [baseScenario], scenarios: [headScenario] })).join("\n")).toMatch(
        /changes its call/,
      )
    })
})

describe("the one place where exemptions are consulted", () => {
  test("#given control 19: the providers the gate consults #then they are exactly the closed, named list", () => {
    expect(RESOLVED).not.toBe("")
    expect(Object.keys(EXEMPTION_PROVIDERS)).toEqual(["declared"])
  })

  // A tripwire, not a proof (architecture contract, the closed list): the provider list is gateReport's second
  // parameter, so the command-line entry's one call of the gate passes its input object and nothing else.
  test("#given the gate's command-line entry #then its one call of the gate passes a single argument", async () => {
    const source = await Bun.file(new URL("./gate-cli.ts", import.meta.url)).text()
    expect([...source.matchAll(/\bgateReport\(/g)].length).toBe(1)
    let depth = 0
    let commas = 0
    for (let at = source.indexOf("gateReport(") + "gateReport".length; at < source.length; at++) {
      const char = source[at] ?? ""
      if ("({[".includes(char)) depth++
      else if (")}]".includes(char)) {
        depth--
        if (depth === 0) break
      } else if (char === "," && depth === 1) commas++
    }
    expect({ commas, providers: source.includes("EXEMPTION_PROVIDERS") }).toEqual({ commas: 0, providers: false })
  })

  // A second provider that exists only here: it exempts s1 whatever its outcomes.
  const always: ExemptionProvider = (scenario) => (scenario.id === "s1" ? {} : undefined)

  test("#given control 20: a scenario two providers would both exempt #then it fails as ambiguous", () => {
    const gate = withOutcomes(ok(1), ok(2), "SDK-Parity-Changed: s1 answer\n")
    const providers = { declared: EXEMPTION_PROVIDERS["declared"] as ExemptionProvider, always }
    expect(gateReport(gate, providers).failures.join("\n")).toMatch(/more than one provider \(always, declared\)/)
  })

  test("#given control 21: the same inputs with the providers in reverse order #then the report is the same", () => {
    const declared = EXEMPTION_PROVIDERS["declared"] as ExemptionProvider
    const forward = gateReport(withOutcomes(ok(1), ok(2), ""), { always, declared })
    const reverse = gateReport(withOutcomes(ok(1), ok(2), ""), { declared, always })
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

  test("#given every printed id exempt #then an Unchanged line is refused; #given other ids beside them #then it is required", () => {
    const allExempt = withOutcomes(ok(1), ok(2), "SDK-Parity-Changed: s1 answer\n", {
      changedFiles: ["packages/omo-native/bin/lib/thread.js"],
    })
    const exemptOnly = check(allExempt)
    expect(verifyReview(exemptOnly, `${allExempt.body}SDK-Parity-Unchanged: yes\n`, verdict(exemptOnly)).decision).toBe(
      "withheld",
    )
    const mixed = withOutcomes(ok(1), ok(2), "SDK-Parity-Changed: s1 answer\n", {
      changedFiles: ["packages/omo-native/bin/lib/thread.js", "packages/omo-native/bin/lib/account.js"],
      closures: new Map([
        ["threads.send", new Set(["packages/omo-native/bin/lib/thread.js"])],
        ["account.show", new Set(["packages/omo-native/bin/lib/account.js"])],
      ]),
    })
    const both = check(mixed)
    expect(both).toContain("account.show")
    expect(verifyReview(both, mixed.body, verdict(both)).decision).toBe("withheld")
    expect(verifyReview(both, `${mixed.body}SDK-Parity-Unchanged: yes\n`, verdict(both)).decision).toBe("accepted")
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
