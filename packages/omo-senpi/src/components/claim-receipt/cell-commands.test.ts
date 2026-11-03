import { describe, expect, test } from "bun:test"
import { cellInvokedKinds } from "./cell-commands"
import { evalRun } from "./entries.test-support"
import { evaluateAnswer } from "./runtime"

const echoArgv = [
  'subprocess.run(["echo", "bun test x passed"])',
  'Bun.spawn(["echo", "bun test x passed"])',
  'run_argv(["echo", "bun test x passed"])',
]
const testCommands = [
  'subprocess.run(["bun", "test"])',
  'Bun.spawn(["bun", "test"])',
  'run_argv(["bun", "test"])',
  'const commands = [["tests", "bun test x"]]',
]

describe("claim-receipt runner argv and nested command pairs", () => {
  test.each(echoArgv)("#given %s #when parsing a runner argv #then a check mentioned in its argument is not invoked", (code) => {
    expect(cellInvokedKinds(code)).toEqual({ kinds: [], offset: -1 })
  })

  test.each(echoArgv)("#given %s and pass-shaped output #when matching a test claim #then it has no test receipt", (code) => {
    const branch = evalRun("echo-argv", { code, output: " 1 pass\n 0 fail" })
    const result = evaluateAnswer(branch, branch.length, "All tests pass.")
    expect(result?.verdicts.map((verdict) => ({
      kind: verdict.claim.kind, status: verdict.status, reason: verdict.reason, hasReceipt: verdict.receipt !== undefined,
    }))).toEqual([{ kind: "test", status: "unsupported", reason: "no-check", hasReceipt: false }])
  })

  test.each(testCommands)("#given %s #when parsing a real argv or nested pair #then the test kind and command offset remain", (code) => {
    expect(cellInvokedKinds(code)).toEqual({ kinds: ["test"], offset: code.indexOf('["') })
  })

  test.each(testCommands)("#given %s and passing output #when matching a test claim #then the test receipt remains supported", (code) => {
    const branch = evalRun("test-command", { code, output: " 1 pass\n 0 fail" })
    const result = evaluateAnswer(branch, branch.length, "All tests pass.")
    expect(result?.verdicts.map((verdict) => ({
      status: verdict.status, kind: verdict.receipt?.kind, outcome: verdict.receipt?.outcome,
    }))).toEqual([{ status: "supported", kind: "test", outcome: "passed" }])
  })
})
