import { test, expect, beforeEach, afterEach } from "bun:test"
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createErrorSignalLoggerHook } from "./hook"

type Hook = ReturnType<typeof createErrorSignalLoggerHook>

function runHook(hook: Hook, tool: string, outputText: string, sessionID = "sess-1", agent = "morpheus") {
  return hook["tool.execute.after"]!(
    { tool, sessionID },
    { title: "t", output: outputText, metadata: { agent } },
  )
}

let dir: string
let cwd: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "errsig-"))
  cwd = process.cwd()
  process.chdir(dir)
})

afterEach(() => {
  process.chdir(cwd)
  rmSync(dir, { recursive: true, force: true })
})

test("given an error tool result, when hook fires, then an ErrorSignal is appended", async () => {
  const hook = createErrorSignalLoggerHook()
  await runHook(hook, "bash", "FATAL: java.lang.Exception: boom")
  const p = join(".matrix", "logs", "errors.jsonl")
  expect(existsSync(p)).toBe(true)
  const lines = readFileSync(p, "utf8").trim().split("\n")
  expect(lines.length).toBe(1)
  const sig = JSON.parse(lines[0])
  expect(sig.errorType).toBe("runtime-error")
  expect(sig.agent).toBe("morpheus")
  expect(sig.sessionId).toBe("sess-1")
  expect(typeof sig.timestamp).toBe("string")
})

test("given a benign tool result, when hook fires, then no signal is appended", async () => {
  const hook = createErrorSignalLoggerHook()
  await runHook(hook, "grep", "no matches found, that is fine")
  const p = join(".matrix", "logs", "errors.jsonl")
  expect(existsSync(p)).toBe(false)
})

test("given an api 5xx error, when hook fires, then errorType is api-error", async () => {
  const hook = createErrorSignalLoggerHook()
  await runHook(hook, "websearch", "Request failed with status 503 Service Unavailable")
  const p = join(".matrix", "logs", "errors.jsonl")
  const sig = JSON.parse(readFileSync(p, "utf8").trim())
  expect(sig.errorType).toBe("api-error")
})

test("given a timeout error, when hook fires, then errorType is timeout", async () => {
  const hook = createErrorSignalLoggerHook()
  await runHook(hook, "bash", "command timed out after 60000ms")
  const p = join(".matrix", "logs", "errors.jsonl")
  const sig = JSON.parse(readFileSync(p, "utf8").trim())
  expect(sig.errorType).toBe("timeout")
})

test("given empty output, when hook fires, then no signal is appended", async () => {
  const hook = createErrorSignalLoggerHook()
  await runHook(hook, "grep", "")
  const p = join(".matrix", "logs", "errors.jsonl")
  expect(existsSync(p)).toBe(false)
})
