#!/usr/bin/env bun
// Runs one `bun` invocation and retries it exactly once when, and only when, Bun itself crashed.
//
// Why: Bun 1.4.2 (and 1.4.3-canary.1) intermittently segfaults a Windows test worker while it runs
// the rpc-host suite (packages/senpi-task/src/runners/rpc-host), tracked upstream as
// oven-sh/bun#44390 and here as #9219. The crash is in Bun's GC, not in the tests, and it keeps
// turning the required Windows shard red on dev. CI runs that suite in its own invocation through
// this script so a crash is contained to it and re-run once.
//
// The invocation stays required: a second crash fails the job, and a real test failure (a `(fail)`
// line, an unhandled error, or more failures than crashed workers) is never retried, even when the
// same run also crashed.

const MAX_ATTEMPTS = 2
const UPSTREAM_ISSUE = "oven-sh/bun#44390"

interface AttemptOutcome {
  readonly exitCode: number
  readonly output: string
}

type AttemptVerdict = "passed" | "bun-panic" | "test-failure"

const PANIC_MARKERS = ["Bun has crashed", "worker crashed: exit code 3"] as const

function isPanicLine(line: string): boolean {
  return line.startsWith("panic(") || PANIC_MARKERS.some((marker) => line.includes(marker))
}

function classifyAttempt(outcome: AttemptOutcome): AttemptVerdict {
  if (outcome.exitCode === 0) return "passed"
  const lines = outcome.output.split(/\r?\n/)
  const crashed = lines.some((line) => PANIC_MARKERS.some((marker) => line.includes(marker)))
  if (!crashed) return "test-failure"
  if (lines.some((line) => /^\s*\(fail\) /.test(line))) return "test-failure"
  if (lines.some((line) => line.includes("Unhandled error between tests"))) return "test-failure"
  // Bun counts each crashed worker as one failure in the summary; anything beyond that is a test.
  const crashedWorkers = lines.filter((line) => line.includes("(worker crashed:")).length
  const summaryFailures = lines
    .map((line) => /^\s*(\d+) fail\s*$/.exec(line)?.[1])
    .filter((count): count is string => count !== undefined)
    .map(Number)
  const failures = summaryFailures.at(-1)
  if (failures !== undefined && failures > crashedWorkers) return "test-failure"
  return "bun-panic"
}

function crashLines(output: string): readonly string[] {
  return output.split(/\r?\n/).map((line) => line.trim()).filter(isPanicLine)
}

async function pump(stream: ReadableStream<Uint8Array>, sink: NodeJS.WriteStream, chunks: string[]): Promise<void> {
  const decoder = new TextDecoder()
  for await (const chunk of stream) {
    sink.write(chunk)
    chunks.push(decoder.decode(chunk, { stream: true }))
  }
  chunks.push(decoder.decode())
}

async function runAttempt(args: readonly string[]): Promise<AttemptOutcome> {
  const child = Bun.spawn([process.execPath, ...args], { stdin: "inherit", stdout: "pipe", stderr: "pipe" })
  const stdout: string[] = []
  const stderr: string[] = []
  await Promise.all([pump(child.stdout, process.stdout, stdout), pump(child.stderr, process.stderr, stderr)])
  const exitCode = await child.exited
  return { exitCode, output: `${stdout.join("")}\n${stderr.join("")}` }
}

async function runWithPanicRetry(args: readonly string[]): Promise<number> {
  for (let attempt = 1; ; attempt += 1) {
    const outcome = await runAttempt(args)
    const verdict = classifyAttempt(outcome)
    if (verdict === "passed") return 0
    if (verdict === "test-failure") {
      console.log(`\n[bun-panic-retry] attempt ${attempt} failed with test failures (exit ${outcome.exitCode}); not retried`)
      return outcome.exitCode
    }
    const summary = crashLines(outcome.output).join(" | ")
    if (attempt >= MAX_ATTEMPTS) {
      console.log(`\n::error title=Bun crashed again (${UPSTREAM_ISSUE})::attempt ${attempt} of ${MAX_ATTEMPTS} crashed: ${summary}`)
      return outcome.exitCode
    }
    console.log(`\n::warning title=Bun crashed (${UPSTREAM_ISSUE})::attempt ${attempt} crashed: ${summary}; retrying this invocation once`)
  }
}

if (import.meta.main) {
  const args = process.argv.slice(2)
  if (args.length === 0) {
    console.error("usage: bun script/bun-panic-retry.ts <bun arguments...>")
    process.exit(2)
  }
  process.exit(await runWithPanicRetry(args))
}
