/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"

import { load } from "js-yaml"
import { z } from "zod"

import { publishWorkflow } from "./keychain-helper-workflow.test-support"

// Release gating contract (publish.yml): release-build-preflight, publish-platform, publish-main
// and release decide from their `if:` expressions whether an npm publish or the GitHub release
// may run. These tests evaluate the real expressions, so a gating regression fails on decisions,
// not on wording. The evaluator covers only the subset these gates use; any other construct
// throws, so a workflow edit can never be silently mis-evaluated.
// OMO_PUBLISH_GATING_YAML overrides the workflow path; the RED proof runs a mutated scratch copy.

const workflowText = process.env.OMO_PUBLISH_GATING_YAML
  ? readFileSync(process.env.OMO_PUBLISH_GATING_YAML, "utf8").replace(/\r\n/g, "\n")
  : publishWorkflow

const jobSchema = z.object({
  needs: z.union([z.string(), z.array(z.string())]).optional(),
  if: z.string().optional(),
})
const releaseJobs = z.object({ jobs: z.record(z.string(), jobSchema) }).parse(load(workflowText)).jobs

const GATED_JOBS = ["release-build-preflight", "publish-platform", "publish-main", "release"] as const
type GatedJob = (typeof GATED_JOBS)[number]

const gatingIf = (job: GatedJob): string => {
  const expression = releaseJobs[job]?.if
  if (expression === undefined) throw new Error(`publish.yml: job ${job} has no if:`)
  return expression
}

type Operator = "&&" | "||" | "==" | "!=" | "(" | ")" | "."
type Token = { kind: "op"; op: Operator } | { kind: "ident"; name: string } | { kind: "string"; value: string }
const OPERATORS: readonly Operator[] = ["&&", "||", "==", "!=", "(", ")", "."]

function tokenize(source: string): Token[] {
  const tokens: Token[] = []
  let at = 0
  while (at < source.length) {
    const rest = source.slice(at)
    const space = rest.match(/^\s+/)
    if (space?.[0] !== undefined) {
      at += space[0].length
      continue
    }
    const op = OPERATORS.find((candidate) => rest.startsWith(candidate))
    if (op !== undefined) {
      tokens.push({ kind: "op", op })
      at += op.length
      continue
    }
    const str = rest.match(/^'((?:[^']|'')*)'/)
    if (str?.[0] !== undefined) {
      tokens.push({ kind: "string", value: (str[1] ?? "").replaceAll("''", "'") })
      at += str[0].length
      continue
    }
    const ident = rest.match(/^[A-Za-z_][A-Za-z0-9_-]*/)
    if (ident?.[0] !== undefined) {
      tokens.push({ kind: "ident", name: ident[0] })
      at += ident[0].length
      continue
    }
    throw new Error(`publish gating if: unsupported token at ${JSON.stringify(rest.slice(0, 16))}`)
  }
  return tokens
}

type GatingContext = {
  github: { repository: string }
  inputs: Readonly<Record<string, string | boolean>>
  needs: Readonly<Record<string, { result: string; outputs?: Readonly<Record<string, string>> }>>
}

// GitHub Actions semantics for the values this subset produces: equality compares case-insensitively
// after string coercion (so inputs.lazycodex_only == true holds for the boolean input), and GitHub's
// falsy set defines truthiness.
const isTruthy = (value: unknown): boolean =>
  value !== false && value !== "" && value !== null && value !== undefined && value !== 0
const looselyEquals = (left: unknown, right: unknown): boolean =>
  String(left).toLowerCase() === String(right).toLowerCase()

function evaluateGating(source: string, context: GatingContext): boolean {
  const tokens = tokenize(source)
  let at = 0
  const peek = (): Token | undefined => tokens[at]
  const take = (): Token => {
    const token = tokens[at]
    if (token === undefined) throw new Error("publish gating if: expression ended early")
    at += 1
    return token
  }
  const eatOp = (op: Operator): boolean => {
    const token = peek()
    if (token?.kind === "op" && token.op === op) {
      at += 1
      return true
    }
    return false
  }
  const expectOp = (op: Operator): void => {
    const token = take()
    if (token.kind !== "op" || token.op !== op) {
      throw new Error(`publish gating if: expected ${op}, got ${JSON.stringify(token)}`)
    }
  }
  const rejectPath = (segments: readonly string[]): never => {
    throw new Error(`publish gating if: context path ${segments.join(".")} is outside the supported subset`)
  }
  const resolvePath = (head: string): unknown => {
    const segments = [head]
    while (eatOp(".")) {
      const token = take()
      if (token.kind !== "ident") throw new Error('publish gating if: expected a name after "."')
      segments.push(token.name)
    }
    const [scope, second, third, fourth] = segments
    if (scope === "github" && segments.length === 2) {
      return second === "repository" ? context.github.repository : rejectPath(segments)
    }
    if (scope === "inputs" && segments.length === 2) {
      if (second === undefined || !(second in context.inputs)) return rejectPath(segments)
      return context.inputs[second]
    }
    if (scope === "needs" && segments.length === 3 && third === "result") {
      const job = second === undefined ? undefined : context.needs[second]
      if (job === undefined) return rejectPath(segments)
      return job.result
    }
    if (scope === "needs" && segments.length === 4 && third === "outputs") {
      const output = second === undefined ? undefined : context.needs[second]?.outputs?.[fourth ?? ""]
      if (output === undefined) return rejectPath(segments)
      return output
    }
    return rejectPath(segments)
  }
  const parsePrimary = (): unknown => {
    const token = take()
    if (token.kind === "op" && token.op === "(") {
      const inner = parseOr()
      expectOp(")")
      return inner
    }
    if (token.kind === "string") return token.value
    if (token.kind === "ident") {
      if (token.name === "true") return true
      if (token.name === "false") return false
      const after = peek()
      if (after?.kind === "op" && after.op === "(") {
        if (token.name !== "always") throw new Error(`publish gating if: function ${token.name}() is not supported`)
        expectOp("(")
        expectOp(")")
        return true
      }
      return resolvePath(token.name)
    }
    throw new Error(`publish gating if: unexpected token ${JSON.stringify(token)}`)
  }
  const parseEquality = (): unknown => {
    let left = parsePrimary()
    for (;;) {
      if (eatOp("==")) left = looselyEquals(left, parsePrimary())
      else if (eatOp("!=")) left = !looselyEquals(left, parsePrimary())
      else return left
    }
  }
  const parseAnd = (): boolean => {
    let value = isTruthy(parseEquality())
    while (eatOp("&&")) value = isTruthy(parseEquality()) && value
    return value
  }
  const parseOr = (): boolean => {
    let value = isTruthy(parseAnd())
    while (eatOp("||")) value = isTruthy(parseAnd()) || value
    return value
  }
  const decision = parseOr()
  if (at !== tokens.length) throw new Error(`publish gating if: trailing tokens from ${JSON.stringify(tokens[at])}`)
  return decision
}

// Every need the four gates reference, seeded from the workflow's own needs graph so a needs path
// always resolves; a case overrides only what it varies and every other need succeeds.
const allNeeds = new Set(GATED_JOBS.flatMap((job) => [releaseJobs[job]?.needs ?? []].flat()))

function gatingContext(
  results: Readonly<Record<string, string>>,
  inputs: Readonly<Record<string, string | boolean>>,
): GatingContext {
  const needs: Record<string, { result: string }> = {}
  for (const job of allNeeds) needs[job] = { result: results[job] ?? "success" }
  return { github: { repository: "code-yeongyu/oh-my-openagent" }, inputs, needs }
}

const BASE_INPUTS: Readonly<Record<string, string | boolean>> = {
  prepared_release_sha: "e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5",
  lazycodex_only: false,
  skip_platform: false,
}

type Case = {
  inputs?: Record<string, string | boolean>
  results?: Record<string, string>
  expected: { preflight?: boolean; platform: boolean; main: boolean; release: boolean }
}

// The skip_platform row exercises the third branch of both OR groups, and the failed-publish-main
// row pins that release demands publish-main success; the platform gate on release is covered
// transitively because a non-success platform leaves publish-main skipped.
const CASES: ReadonlyArray<[label: string, testCase: Case]> = [
  [
    "preflight failure blocks every publish and the release",
    { results: { "release-build-preflight": "failure" }, expected: { platform: false, main: false, release: false } },
  ],
  [
    "preflight success lets the publishes and the release run",
    { expected: { platform: true, main: true, release: true } },
  ],
  [
    "lazycodex-only path keeps publish-main and the release with preflight and platform skipped",
    {
      inputs: { lazycodex_only: true },
      results: { "release-build-preflight": "skipped" },
      expected: { preflight: false, platform: false, main: true, release: true },
    },
  ],
  [
    "preflight cancelled blocks publish-main and the release",
    { results: { "release-build-preflight": "cancelled" }, expected: { platform: false, main: false, release: false } },
  ],
  [
    "skip_platform skips publish-platform but keeps publish-main and the release",
    { inputs: { skip_platform: true }, expected: { platform: false, main: true, release: true } },
  ],
  [
    "a failed publish-main blocks the release",
    { results: { "publish-main": "failure" }, expected: { platform: true, main: true, release: false } },
  ],
]

describe("publish.yml release gating decisions", () => {
  test.each(CASES)("%s", (_label, testCase) => {
    // given: the case's inputs and needs results, every other need successful
    const inputs = { ...BASE_INPUTS, ...testCase.inputs }
    const jobContext = gatingContext(testCase.results ?? {}, inputs)

    // when: the gates decide, then release sees those outcomes, and a result the case declares wins
    const platformRuns = evaluateGating(gatingIf("publish-platform"), jobContext)
    const mainRuns = evaluateGating(gatingIf("publish-main"), jobContext)
    const releaseContext = gatingContext(
      {
        "publish-platform": platformRuns ? "success" : "skipped",
        "publish-main": mainRuns ? "success" : "skipped",
        ...testCase.results,
      },
      inputs,
    )
    const releaseRuns = evaluateGating(gatingIf("release"), releaseContext)

    // then
    if (testCase.expected.preflight !== undefined) {
      expect(evaluateGating(gatingIf("release-build-preflight"), jobContext)).toBe(testCase.expected.preflight)
    }
    expect(platformRuns).toBe(testCase.expected.platform)
    expect(mainRuns).toBe(testCase.expected.main)
    expect(releaseRuns).toBe(testCase.expected.release)
  })
})

describe("the gating evaluator rejects constructs outside its subset", () => {
  const context = gatingContext({}, BASE_INPUTS)

  test.each([
    "cancelled()",
    "!inputs.lazycodex_only",
    "github.event_name == 'push'",
    "needs.release.outputs.created == 'true'",
    "format('{0}', inputs.bump) == 'patch'",
  ])("%s must throw instead of mis-evaluating", (expression) => {
    expect(() => evaluateGating(expression, context)).toThrow()
  })
})
