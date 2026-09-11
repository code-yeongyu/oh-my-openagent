#!/usr/bin/env node
import assert from "node:assert/strict"
import { spawn, execFileSync } from "node:child_process"
import { EventEmitter, once } from "node:events"
import { createServer } from "node:http"
import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { createInterface } from "node:readline"
import { fileURLToPath, pathToFileURL } from "node:url"
import { createSandbox, seedSandbox, credentialDigest } from "./drive.mjs"

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, "../../../..")
const policyError = "Codex error: This request was blocked by our safety systems. Reason: Potentially unintended activity."
// A transient provider failure the pinned host classifies as retryable; `--self-test` pins that
// against the host classifier rather than against this comment.
const retryableError = "503 service unavailable from the QA provider"
const realHomes = [join(homedir(), ".senpi", "agent"), join(homedir(), ".omo", "agent")]

export const QA_CONTEXT_WINDOW = 200_000
// Large enough for senpi's own system prompt and tool schemas to stay usable, small enough that one
// reported turn of usage puts the session over the host's compaction threshold, which is what makes
// the host act on the `compaction` lane's turn.
export const QA_COMPACTION_CONTEXT_WINDOW = 60_000
export const LANES = ["loop", "boulder"]
/**
 * `policy` and `refusal` are terminal failures the host must own, and continuation must resume on
 * the next clean user turn. `retry` and `compaction` are the two HOST-OWNED edges: with retry and
 * compaction ENABLED (production defaults, and the settings this driver ships) the host answers
 * with its own retry or auto-compaction, so the hooks see an `agent_end` the host has not settled
 * and must stay silent until it does.
 */
export const FAILURES = ["policy", "refusal", "retry", "compaction"]
/** Lanes whose failure phase ends in the host's own recovery rather than a terminal failure. */
export const HOST_OWNED_FAILURES = new Set(["retry", "compaction"])

export function contextWindowFor(failure) {
  return failure === "compaction" ? QA_COMPACTION_CONTEXT_WINDOW : QA_CONTEXT_WINDOW
}

/**
 * The assistant outcome the fake provider answers with, by phase and 1-based call index within the
 * phase. Pure: the self-test drives it directly.
 */
export function providerOutcome(phase, failure, call = 1) {
  const clean = { stopReason: "stop", content: [{ type: "text", text: policyError }] }
  if (failure === "compaction") {
    // Never a failed turn: the pressure is the reported usage of the FIRST pressured call, and every
    // later call (the host's summarization, then the post-compaction turn) must answer normally so
    // the interaction terminates.
    return phase === "failure" && call === 1 ? { ...clean, usage: compactionUsage() } : clean
  }
  if (phase !== "failure") return clean
  if (failure === "policy") return { stopReason: "error", errorMessage: policyError }
  if (failure === "refusal") return { stopReason: "toolUse", stopDetails: { type: "refusal" } }
  // The retry lane fails once and then answers normally, so the host's own retry is what recovers it.
  if (failure === "retry") return call === 1 ? { stopReason: "error", errorMessage: retryableError } : clean
  throw new Error(`unknown QA failure: ${failure}`)
}

function compactionUsage() {
  const input = Math.floor(QA_COMPACTION_CONTEXT_WINDOW * 0.95)
  return { input, output: 8, cacheRead: 0, cacheWrite: 0, totalTokens: input + 8,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }
}

export function continuationCustomType(lane) {
  return lane === "loop" ? "omo-senpi:ulw-continuation" : "omo-senpi:ulw-execute-continuation"
}

/**
 * The continuation invariant, read off the fixture's edge markers: every `omo_send` must land while
 * the OPEN host edge is `agent_settled`, never while it is still `agent_end`. An `agent_end` edge
 * that never opened a settle is one the host still owns (an automatic retry, a required
 * auto-compaction, or a queued continuation), and the hooks must be silent there.
 */
export function auditContinuationTrace(trace) {
  let settles = 0
  let ends = 0
  let hostOwnedEnds = 0
  let sendsOnHostOwnedEdge = 0
  let openEdge = null
  const sends = []
  for (const event of trace) {
    if (event.type === "edge_agent_end") {
      if (openEdge === "agent_end") hostOwnedEnds += 1
      openEdge = "agent_end"
      ends += 1
    } else if (event.type === "edge_agent_settled") {
      openEdge = "agent_settled"
      settles += 1
    } else if (event.type === "omo_send") {
      if (openEdge !== "agent_settled") sendsOnHostOwnedEdge += 1
      sends.push(event)
    }
  }
  if (openEdge === "agent_end") hostOwnedEnds += 1
  return {
    ends,
    settles,
    hostOwnedEnds,
    sendsOnHostOwnedEdge,
    sends,
    retryOwnedEnds: trace.filter((event) => event.type === "edge_agent_end" && event.willRetry === true).length,
    compactions: trace.filter((event) => event.type === "hook_compact").length,
  }
}

export async function selfTest() {
  assert.deepEqual(providerOutcome("clean", "policy").stopReason, "stop")
  assert.deepEqual(providerOutcome("failure", "policy"), { stopReason: "error", errorMessage: policyError })
  assert.deepEqual(providerOutcome("failure", "refusal"), { stopReason: "toolUse", stopDetails: { type: "refusal" } })
  assert.equal(providerOutcome("failure", "retry", 2).stopReason, "stop")
  assert.equal(providerOutcome("failure", "compaction", 1).stopReason, "stop")
  assert(providerOutcome("failure", "compaction", 1).usage.input > contextWindowFor("compaction") * 0.9)
  assert.equal(contextWindowFor("policy"), QA_CONTEXT_WINDOW)
  assert.throws(() => providerOutcome("failure", "nope"))
  assert.equal(continuationCustomType("loop"), "omo-senpi:ulw-continuation")
  assert.equal(continuationCustomType("boulder"), "omo-senpi:ulw-execute-continuation")

  // A send that rides an unsettled agent_end is the regression this driver exists to catch.
  const clean = [
    { type: "edge_agent_end", willRetry: false },
    { type: "edge_agent_settled" },
    { type: "omo_send", message: { customType: "omo-senpi:wake" } },
    { type: "hook_settled", pending: 0 },
  ]
  assert.deepEqual(auditContinuationTrace(clean).sendsOnHostOwnedEdge, 0)
  assert.equal(auditContinuationTrace(clean).sends.length, 1)
  const held = [
    { type: "edge_agent_end", willRetry: true },
    { type: "omo_send", message: {} },
    { type: "edge_agent_end", willRetry: false },
    { type: "edge_agent_settled" },
  ]
  const heldAudit = auditContinuationTrace(held)
  assert.equal(heldAudit.sendsOnHostOwnedEdge, 1)
  assert.equal(heldAudit.hostOwnedEnds, 1)
  assert.equal(heldAudit.retryOwnedEnds, 1)

  // The retry lane is only a retry lane while the pinned host still classifies its error text as a
  // transient failure, and the policy lane only proves a terminal failure while its text is not.
  const { isRetryableErrorMessage } = await import(pathToFileURL(resolvePinnedPiAi()).href)
  assert.equal(isRetryableErrorMessage(providerOutcome("failure", "retry", 1).errorMessage), true)
  assert.equal(isRetryableErrorMessage(providerOutcome("failure", "policy", 1).errorMessage), false)
  return { ok: true, lanes: LANES, failures: FAILURES }
}

/** The pinned host ships pi-ai as its own dependency; both bun layouts are checked, then it fails. */
function resolvePinnedPiAi() {
  const senpiRoot = join(root, "node_modules", "@code-yeongyu", "senpi")
  const candidates = [
    join(senpiRoot, "node_modules", "@earendil-works", "pi-ai", "dist", "index.js"),
    join(root, "node_modules", "@earendil-works", "pi-ai", "dist", "index.js"),
  ]
  const found = candidates.find((candidate) => existsSync(candidate))
  if (!found) throw new Error(`pinned @earendil-works/pi-ai not found; looked in:\n${candidates.join("\n")}`)
  return found
}

/** Exactly one batched wake carrying this lane's continuation, and nothing else. */
function assertContinuation(sends, lane) {
  assert.equal(sends.length, 1, "the settled run must make exactly one automatic continuation, then dedupe")
  assert.equal(sends[0].message.customType, "omo-senpi:wake")
  assert.deepEqual(sends[0].message.details.map((detail) => detail.customType), [continuationCustomType(lane)])
}

function trace(path) {
  return readFileSync(path, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line))
}

async function scenario(lane, failure, context) {
  const { evidence, bun, cli, toolkit } = context
  const sandbox = createSandbox()
  const name = `${lane}-${failure}`
  const traceFile = join(evidence, `${name}-hooks.jsonl`)
  const events = []
  let child
  let server
  let lines
  let calls = 0
  let phase = "failure"
  let stderr = ""
  let cleanup
  writeFileSync(traceFile, "")
  try {
    seedSandbox(sandbox)
    // Retry and compaction stay ENABLED: they are the two host-owned edges this driver must drive.
    writeFileSync(join(sandbox.agentDir, "settings.json"), JSON.stringify({ packages: [],
      retry: { enabled: true, maxRetries: 1 }, compaction: { enabled: true }, sessionTitle: { enabled: false } }))
    const extension = join(sandbox.root, "extension.mjs")
    execFileSync(bun, ["build", join(here, "fixtures/policy-continuation-extension.ts"), "--target", "node", "--outfile", extension], { cwd: root })
    let phaseCalls = 0
    server = createServer((_request, response) => {
      calls++
      phaseCalls++
      response.writeHead(200, { "content-type": "application/json" })
      response.end(JSON.stringify(providerOutcome(phase, failure, phaseCalls)))
    })
    const listening = once(server, "listening", { signal: AbortSignal.timeout(10_000) })
    server.listen(0, "127.0.0.1")
    await listening
    const address = server.address()
    assert(address && typeof address === "object")
    // Deliberate allowlist: provider credentials, caller agent dirs and task/session env never inherit.
    const env = {
      PATH: process.env.PATH, HOME: sandbox.homeDir, USERPROFILE: sandbox.homeDir,
      TMPDIR: sandbox.root, XDG_CONFIG_HOME: sandbox.xdgConfigHome, XDG_DATA_HOME: sandbox.xdgDataHome,
      XDG_CACHE_HOME: sandbox.xdgCacheHome, XDG_STATE_HOME: join(sandbox.root, "state"),
      OMO_CODING_AGENT_DIR: sandbox.agentDir, SENPI_CODING_AGENT_DIR: sandbox.agentDir, PI_CODING_AGENT_DIR: sandbox.agentDir,
      OMO_AGENT_TOOLKIT_BIN: toolkit, OMO_POLICY_QA_TRACE: traceFile, OMO_POLICY_QA_LANE: lane,
      OMO_POLICY_QA_ENDPOINT: `http://127.0.0.1:${address.port}`, PI_OFFLINE: "1", OMO_SENPI_QA: "1",
      OMO_POLICY_QA_CONTEXT_WINDOW: String(contextWindowFor(failure)),
    }
    child = spawn(process.execPath, [cli, "--mode", "rpc", "--no-extensions", "--no-skills", "--no-prompt-templates",
      "-e", extension, "--provider", "omo-policy-qa", "--model", "qa"], { cwd: sandbox.cwd, env, stdio: "pipe" })
    const bus = new EventEmitter()
    child.stderr.on("data", (data) => { stderr += data })
    child.on("error", (error) => bus.emit("error", error))
    lines = createInterface({ input: child.stdout })
    lines.on("line", (line) => {
      let event
      try { event = JSON.parse(line) } catch (error) { bus.emit("error", error); return }
      events.push(event)
      bus.emit(event.id ? `response:${event.id}` : event.type, event)
    })
    let sequence = 0
    async function request(type, data = {}) {
      const id = `qa-${++sequence}`
      const reply = once(bus, `response:${id}`, { signal: AbortSignal.timeout(30_000) })
      child.stdin.write(`${JSON.stringify({ type, id, ...data })}\n`)
      const [response] = await reply
      assert.equal(response.success, true, JSON.stringify(response))
      return response.data
    }
    async function prompt(message) {
      // Subscribe before submission. agent_idle, unlike agent_end, is after settlement and queue drain.
      const idle = once(bus, "agent_idle", { signal: AbortSignal.timeout(60_000) })
      await Promise.all([idle, request("prompt", { message })])
      const snapshot = trace(traceFile)
      assert.equal(snapshot.at(-1)?.type, "hook_settled")
      assert.equal(snapshot.at(-1)?.pending, 0)
      return snapshot
    }
    await request("get_state")
    // Each phase is audited on its OWN slice of the trace, so an earlier phase's continuation is
    // never counted as this phase's.
    let mark = 0
    if (failure === "compaction") {
      // One ordinary turn first, so the pressured turn has a transcript the host can summarize.
      phase = "warm"
      mark = (await prompt("Warm the QA transcript.")).length
      phase = "failure"
      phaseCalls = 0
    }
    const failed = await prompt("Exercise the active QA plan.")
    assert(failed.some((event) => event.type === "loaded"))
    assert(failed.some((event) => event.type === "active_plan" && event.lane === lane))
    const failureCalls = phaseCalls
    const failureAudit = auditContinuationTrace(failed.slice(mark))
    // The single invariant for every lane: nothing is ever sent on an edge the host has not settled.
    assert.equal(failureAudit.sendsOnHostOwnedEdge, 0, `send on an unsettled edge: ${JSON.stringify(failureAudit)}`)
    const end = failed.find((event) => event.type === "hook_end")
    if (failure === "retry") {
      // The host answered with its own retry: an agent_end carrying willRetry that it never settled,
      // an extra provider call, and then exactly one continuation on the settle that followed.
      assert(failureCalls > 1, `host retry must make more than one provider call, saw ${failureCalls}`)
      assert.equal(failureAudit.retryOwnedEnds, 1, `retry must report willRetry, saw ${JSON.stringify(failureAudit)}`)
      assert.equal(failureAudit.hostOwnedEnds, 1, `retry must leave one unsettled agent_end, saw ${JSON.stringify(failureAudit)}`)
      assertContinuation(failureAudit.sends, lane)
      return report()
    }
    if (failure === "compaction") {
      // The host ran its own auto-compaction for this turn, reported on its event stream. Whether
      // the settled run then continues is dedupe's business; the pinned invariant is that nothing
      // rode an unsettled edge, and that a continuation the host still cannot admit is refused by
      // the host rather than injected into its compaction window.
      const compactionReasons = events.filter((event) => event.type === "compaction_start").map((event) => event.reason)
      assert(compactionReasons.includes("threshold"), `host must run threshold compaction, saw ${JSON.stringify(compactionReasons)}`)
      assert(failureAudit.sends.length <= 1, `at most one continuation, saw ${failureAudit.sends.length}`)
      return report(0, { compactionReasons, hostRefusedSends: hostRefusedSendReasons() })
    }
    assert.equal(failureAudit.sends.length, 0, "a terminally failed turn must never send")
    if (failure === "policy") {
      assert.equal(end?.event.messages.at(-1).stopReason, "error")
      assert.equal(end.event.messages.at(-1).errorMessage, policyError)
    } else {
      // The real host normalizes an empty toolUse into stop, retains its refusal signal, and leaves
      // the demotion diagnostic the single refusal predicate keys on.
      assert.equal(end?.event.messages.at(-1).stopDetails.type, "refusal")
      assert.equal(end.event.messages.at(-1).stopReason, "stop")
      assert(end.event.messages.at(-1).diagnostics.some((diagnostic) => diagnostic.type === "empty_tool_use_terminal_state"))
      assert(events.some((event) => event.type === "message_end" && event.message?.stopReason === "toolUse"))
    }
    phase = "clean"
    phaseCalls = 0
    const recovered = await prompt("Continue after this explicit user input.")
    const cleanAudit = auditContinuationTrace(recovered.slice(failed.length))
    assert.equal(cleanAudit.sendsOnHostOwnedEdge, 0)
    assertContinuation(cleanAudit.sends, lane)
    return report(cleanAudit.sends.length)

    function hostRefusedSendReasons() {
      return events.filter((event) => event.type === "extension_error" && event.event === "send_message").map((event) => event.error)
    }

    function report(cleanSends = 0, extra = {}) {
      return { name, result: "PASS", failureCalls, failureSends: failureAudit.sends.length, totalCalls: calls, cleanSends, ...extra,
        hostOwnedEnds: failureAudit.hostOwnedEnds, retryOwnedEnds: failureAudit.retryOwnedEnds,
        compactions: failureAudit.compactions, settles: failureAudit.settles,
        isolatedAgentDir: sandbox.agentDir, coordinator: "production class, default microtask scheduler", get cleanup() { return cleanup } }
    }
  } finally {
    if (child && child.exitCode === null && child.signalCode === null) {
      const exited = once(child, "exit", { signal: AbortSignal.timeout(10_000) })
      child.kill("SIGTERM")
      await exited
    }
    lines?.close()
    if (server) await new Promise((resolveClose, reject) => server.close((error) => error ? reject(error) : resolveClose()))
    writeFileSync(join(evidence, `${name}-events.jsonl`), events.map((event) => JSON.stringify(event)).join("\n") + "\n")
    writeFileSync(join(evidence, `${name}-stderr.log`), stderr)
    rmSync(sandbox.root, { recursive: true, force: true })
    cleanup = { childTerminal: !child || child.exitCode !== null || child.signalCode !== null, sandboxRemoved: true }
  }
}

export async function run(options = {}) {
  const lanes = options.lanes ?? LANES
  const failures = options.failures ?? FAILURES
  const evidence = execFileSync(process.execPath, [join(root, ".agents/skills/senpi-qa/scripts/resolve-evidence-dir.mjs"),
    "--repo-root", root, "--slug", process.env.POLICY_QA_SLUG ?? "20260909-policy-continuation-hooks"], { encoding: "utf8" }).trim()
  mkdirSync(evidence, { recursive: true })
  const context = {
    evidence,
    bun: process.env.BUN_BIN ?? "bun",
    cli: realpathSync(process.env.SENPI_BIN ?? join(root, "node_modules/@code-yeongyu/senpi/dist/cli.js")),
    toolkit: join(root, "packages/omo-senpi/plugin/runtime/agent-toolkit/omo-agent-toolkit"),
  }
  const before = realHomes.map(credentialDigest)
  const reports = []
  let failed = false
  try {
    for (const lane of lanes) {
      for (const failure of failures) reports.push(await scenario(lane, failure, context))
    }
  } catch (error) {
    reports.push({ result: "FAIL", error: error instanceof Error ? error.stack : String(error) })
    failed = true
  }
  const after = realHomes.map(credentialDigest)
  const realSenpiUntouched = before.every((digest, index) => digest === after[index])
  const report = { result: failed || !realSenpiUntouched ? "FAIL" : "PASS", cli: context.cli, scenarios: reports, realSenpiUntouched,
    isolationScope: "credential digests for real ~/.senpi/agent and ~/.omo/agent; allowlisted sandbox-only child environment",
    evidence }
  writeFileSync(join(evidence, "live-report.json"), JSON.stringify(report, null, 2) + "\n")
  return report
}

function readOption(flag, allowed) {
  const at = process.argv.indexOf(flag)
  if (at === -1) return undefined
  const value = process.argv[at + 1]
  assert(allowed.includes(value), `${flag} must be one of ${allowed.join(", ")}`)
  return [value]
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const report = process.argv.includes("--self-test")
    ? await selfTest()
    : await run({ lanes: readOption("--lane", LANES), failures: readOption("--failure", FAILURES) })
  console.log(JSON.stringify(report, null, 2))
  process.exitCode = report.ok === true || report.result === "PASS" ? 0 : 1
}
