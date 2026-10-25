/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { load } from "js-yaml"

const ci = load(readFileSync(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8")) as {
  concurrency: { group: string; "cancel-in-progress": string | boolean }
}

// GitHub evaluates these expressions; this mirrors the two operators they use for the events CI runs on.
function evaluate(expression: string, context: { event_name: string; sha: string; ref: string; workflow: string }): string {
  return expression.replace(/\$\{\{ (.+?) \}\}/g, (_, body: string) => {
    const value = (name: string) => context[name.replace("github.", "") as keyof typeof context]
    const ternary = /^(github\.\w+) == '(\w+)' && (github\.\w+) \|\| (github\.\w+)$/.exec(body)
    if (ternary) return value(ternary[1]!) === ternary[2] ? value(ternary[3]!) : value(ternary[4]!)
    const notEqual = /^(github\.\w+) != '(\w+)'$/.exec(body)
    if (notEqual) return String(value(notEqual[1]!) !== notEqual[2])
    return value(body)
  })
}

describe("CI concurrency", () => {
  const base = { workflow: "CI", ref: "refs/heads/dev" }
  const group = ci.concurrency.group
  const cancel = String(ci.concurrency["cancel-in-progress"])

  test("#given two pushes to dev #when the second starts #then they share the dev group and the running one is not cancelled", () => {
    const first = { ...base, event_name: "push", sha: "a".repeat(40) }
    const second = { ...base, event_name: "push", sha: "b".repeat(40) }
    // One group keeps at most one running and one pending dev run; no cancel-in-progress lets the running one finish.
    expect(evaluate(group, first)).toBe(evaluate(group, second))
    expect(evaluate(cancel, second)).toBe("false")
  })

  test("#given the same commit pushed to master and dev #when both run #then they are in different groups", () => {
    const sha = "c".repeat(40)
    const dev = { ...base, event_name: "push", sha }
    const master = { ...base, ref: "refs/heads/master", event_name: "push", sha }
    expect(evaluate(group, dev)).not.toBe(evaluate(group, master))
  })

  test("#given two runs of one PR #when the second starts #then it shares the group and cancels the first", () => {
    const pr = { workflow: "CI", ref: "refs/pull/10633/merge", event_name: "pull_request" }
    expect(evaluate(group, { ...pr, sha: "a".repeat(40) })).toBe(evaluate(group, { ...pr, sha: "b".repeat(40) }))
    expect(evaluate(cancel, { ...pr, sha: "b".repeat(40) })).toBe("true")
  })
})
