import { expect, test } from "bun:test"
import { waitForE24TypeScript } from "./fused-equivalence-lsp-warmup.mjs"

const reply = (text, details, isError = false) => ({ content: [{ type: "text", text }], details, isError })
const empty = reply("No diagnostics found", { totalDiagnostics: 0 })
const timeout = reply("Timed out waiting for fresh diagnostics", { errorKind: "freshness_timeout" }, true)
const ready = reply("error[typescript] (2322) at 1:14: Type 'number' is not assignable to type 'string'.")

test.each([
  ["an empty cold result", empty],
  ["a freshness timeout", timeout],
])("#given %s #when TypeScript publishes later #then the E24 preflight succeeds", async (_label, first) => {
  const results = [first, ready]

  await expect(waitForE24TypeScript(async () => results.shift())).resolves.toBeUndefined()
})

test("#given persistent freshness timeouts #when warmup exhausts its budget #then the failure names the timeout", async () => {
  const results = [...Array(10).fill(timeout), ready]

  await expect(waitForE24TypeScript(async () => results.shift())).rejects.toThrow(/freshness_timeout/)
})

test("#given a missing server #when warming up #then the daemon failure is surfaced without another attempt", async () => {
  const results = [reply("TypeScript server not installed", { errorKind: "missing_dependency" }, true), ready]

  await expect(waitForE24TypeScript(async () => results.shift())).rejects.toThrow(/TypeScript server not installed/)
  expect(results).toEqual([ready])
})
