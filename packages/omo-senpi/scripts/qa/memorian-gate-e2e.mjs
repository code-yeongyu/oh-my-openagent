#!/usr/bin/env bun
// allow: SIZE_OK - one auditable offline proof of the memorian recall gate: sandbox, mock provider,
// RPC session, judge routing and the parent-session assertions belong to one indivisible lifecycle.
//
// Offline end-to-end proof of the memorian recall gate (plan .omo/plans/memorian-judge-completion-policy.md todo 7).
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { pathToFileURL } from "node:url"

import { startMockCompletionsServer } from "./mock-completions-server.mjs"
import {
  JUDGE_TIMEOUT_MS,
  NUDGE_TOOL,
  SEED_PATH,
  SEED_BODY,
  TURN_1_PROMPT,
  TURN_2_PROMPT,
  assertSandboxEnv,
  childTranscript,
  createRouter,
  getState,
  identityDirs,
  isJudgeRequest,
  lastAssistant,
  launchRpc,
  parseArgs,
  pendingFiles,
  prepareSandbox,
  prompt,
  readEntries,
  recallRuns,
  sandboxEnv,
  seedMemoryRepo,
  teardown,
  waitUntil,
  writeOmoConfig,
} from "./memorian-e2e-support.mjs"

const checks = []

function record(name, ok, detail) {
  checks.push({ name, ok, detail })
  console.log(`${ok ? "PASS" : "FAIL"} ${name} :: ${detail}`)
}

function scenarioSteps(kind) {
  const parentSteps = [
    { type: "text", text: "Checking." },
    { type: "text", text: "Done." },
  ]
  const judgeSteps = kind === "s1"
    ? [
      { type: "tool_call", name: NUDGE_TOOL, arguments: { path: SEED_PATH, hint: SEED_BODY } },
      { type: "text", text: "" },
    ]
    : [{ type: "error", status: 500, body: { error: { message: "mock judge outage\nline2" } } }]
  return { parentSteps, judgeSteps }
}

async function runScenario(kind, options) {
  const cleanup = []
  const { parentSteps, judgeSteps } = scenarioSteps(kind)
  const router = createRouter({ judgeSteps })
  const server = startMockCompletionsServer({ steps: router.steps })
  const baseUrl = await server.ready
  const sandbox = prepareSandbox(options.pluginRoot, baseUrl)
  const env = sandboxEnv(sandbox)
  assertSandboxEnv(sandbox, env)
  record(`${kind}.sandbox-isolated`, true, `agentDir=${sandbox.agentDir} memoryHome=${sandbox.memoryHome}`)

  let session
  const facts = { scenario: kind, baseUrl, sandboxRoot: sandbox.root }
  try {
    const seed = await seedMemoryRepo(options, sandbox, env, router)
    if (seed.status !== 0) {
      record(`${kind}.memory-seeded`, false, `seed turn exited ${seed.status}: ${seed.stderr.slice(-400)}`)
      return facts
    }
    const seeded = identityDirs(sandbox.memoryHome).map((dir) => join(dir, "repo", SEED_PATH)).filter(existsSync)
    record(`${kind}.memory-seeded`, seeded.length === 1, seeded[0] ?? `no ${SEED_PATH} under ${sandbox.memoryHome}`)
    if (seeded.length !== 1) return facts
    const seedRuns = recallRuns(sandbox.memoryHome)
    record(`${kind}.seed-turn-gate-quiet`, seedRuns.length === 0 && router.state.judge === 0, `runs=${seedRuns.length} judgeRequests=${router.state.judge}`)
    if (seedRuns.length !== 0 || router.state.judge !== 0) return facts

    writeOmoConfig(sandbox, true)
    router.setParentSteps(parentSteps)
    session = launchRpc(options.senpiCli, sandbox, env)
    const state = await getState(session)
    const sessionFile = state.sessionFile
    facts.sessionId = state.sessionId
    facts.sessionFile = sessionFile
    record(`${kind}.session-identified`, typeof sessionFile === "string" && sessionFile.length > 0, `sessionId=${state.sessionId} sessionFile=${sessionFile}`)
    if (typeof sessionFile !== "string") return facts

    await prompt(session, TURN_1_PROMPT)

    const judgeSettled = await waitUntil(
      () => {
        const gate = readEntries(sessionFile).filter((entry) => entry.customType === "omo-memorian:gate")
        if (gate.length > 0) return { gate: gate.map((entry) => entry.data?.status) }
        if (kind === "s1") {
          const pending = pendingFiles(sandbox.memoryHome, state.sessionId)
          if (pending.length > 0) return { pending }
        }
        return undefined
      },
      { timeoutMs: JUDGE_TIMEOUT_MS, description: `${kind} judge verdict (pending nudges or a gate entry)` },
    ).catch((error) => ({ error: error.message }))
    if (judgeSettled.error !== undefined) {
      const runs = recallRuns(sandbox.memoryHome).map((run) => run.runId)
      record(`${kind}.judge-settled`, false, `${judgeSettled.error}; runs=[${runs.join(",")}]; stderr=${session.stderr().slice(-1200).replace(/\n/g, " | ")}`)
      return facts
    }
    record(`${kind}.judge-settled`, true, JSON.stringify(judgeSettled))

    await prompt(session, TURN_2_PROMPT)
    const entries = readEntries(sessionFile)
    facts.judgeRequests = router.state.judge
    if (kind === "s1") assertS1(entries, sandbox, state, facts, router)
    else assertS2(entries, sandbox, state, facts)
  } finally {
    if (session !== undefined) cleanup.push(await teardown(session))
    server.close()
    cleanup.push("server closed")
    if (options.keepSandbox) cleanup.push(`sandbox KEPT: ${sandbox.root}`)
    else {
      rmSync(sandbox.root, { recursive: true, force: true })
      cleanup.push(existsSync(sandbox.root) ? `sandbox NOT removed: ${sandbox.root}` : "sandbox removed")
    }
    console.log(`cleanup: ${cleanup.join(", ")}`)
    facts.cleanup = cleanup
  }
  return facts
}

function assertS1(entries, sandbox, state, facts, router) {
  const nudged = entries.filter((entry) => entry.type === "custom" && entry.customType === "omo-memorian:nudged")
  const firstPath = nudged[0]?.data?.nudges?.[0]?.path
  record("s1.nudged-entry", nudged.length >= 1 && firstPath === SEED_PATH, `count=${nudged.length} path=${firstPath ?? "none"}`)

  const recall = entries.filter((entry) => entry.type === "custom_message" && entry.customType === "omo-memorian:recall")
  record("s1.recall-injected", recall.length >= 1, `count=${recall.length}`)

  const failedGate = entries.filter((entry) => entry.customType === "omo-memorian:gate" && entry.data?.status === "failed")
  record("s1.no-failed-gate", failedGate.length === 0, failedGate.length === 0 ? "no failed gate entry" : failedGate.map((entry) => JSON.stringify(entry.data)).join(" | "))

  const runs = recallRuns(sandbox.memoryHome)
  const run = runs[0]
  const transcript = run === undefined ? undefined : childTranscript(run.dir)
  const stopReason = transcript === undefined ? undefined : lastAssistant(transcript.messages)?.stopReason
  const hasCandidates = run !== undefined && existsSync(join(run.dir, "candidates.json"))
  record("s1.run-dir-artifacts", runs.length === 1 && hasCandidates && transcript !== undefined && stopReason === "stop", `runs=${runs.length} candidates=${hasCandidates} stopReason=${stopReason ?? "none"}`)
  facts.runId = run?.runId
  facts.childStopReason = stopReason

  record("s1.judge-request-count", router.state.judge === 2, `judgeRequests=${router.state.judge}`)
}

function assertS2(entries, sandbox, state, facts) {
  const gate = entries.filter((entry) => entry.customType === "omo-memorian:gate" && entry.data?.status === "failed")
  const data = gate[0]?.data
  facts.gate = data
  const reasonOk = typeof data?.reason === "string" && data.reason.length <= 160 && !data.reason.includes("\n")
  record("s2.gate-child-failed", gate.length === 1 && data?.cause === "child_failed", `count=${gate.length} cause=${data?.cause ?? "none"}`)
  record("s2.gate-reason-sanitized", reasonOk, `reason=${JSON.stringify(data?.reason ?? null)} length=${data?.reason?.length ?? 0}`)
  record("s2.gate-run-id", typeof data?.runId === "string" && /^[0-9a-f-]{36}$/.test(data.runId), `runId=${data?.runId ?? "none"}`)
  facts.runId = data?.runId

  const nudged = entries.filter((entry) => entry.customType === "omo-memorian:nudged")
  record("s2.no-nudged-entry", nudged.length === 0, `count=${nudged.length}`)

  const pending = pendingFiles(sandbox.memoryHome, state.sessionId)
  record("s2.no-pending-file", pending.length === 0, pending.length === 0 ? "no pending nudges" : pending.join(","))
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  if (!existsSync(options.senpiCli)) throw new Error(`senpi cli not found at ${options.senpiCli}`)
  if (!existsSync(join(options.pluginRoot, "extensions"))) throw new Error(`plugin bundle not built at ${options.pluginRoot}/extensions`)
  console.log(`plugin-root: ${options.pluginRoot}`)
  console.log(`senpi-cli: ${options.senpiCli}`)
  console.log(`scenario: ${options.scenario}`)

  const scenarios = options.scenario === "all" ? ["s1", "s2"] : [options.scenario]
  const facts = []
  for (const kind of scenarios) facts.push(await runScenario(kind, options))

  const failures = checks.filter((check) => !check.ok)
  const payload = { ok: failures.length === 0, scenarios, checks, facts }
  if (options.evidenceDir !== undefined) {
    mkdirSync(options.evidenceDir, { recursive: true })
    writeFileSync(join(options.evidenceDir, "memorian-gate-e2e.json"), `${JSON.stringify(payload, null, 2)}\n`)
    console.log(`evidence: ${join(options.evidenceDir, "memorian-gate-e2e.json")}`)
  }
  console.log(JSON.stringify({ ok: payload.ok, total: checks.length, failures: failures.map((check) => check.name) }, null, 2))
  process.exit(failures.length === 0 ? 0 : 1)
}

function runSelfTest() {
  const judgeBody = { tools: [{ type: "function", function: { name: NUDGE_TOOL } }], messages: [{ role: "system", content: "# Memorian — memory nudge agent" }] }
  if (!isJudgeRequest(judgeBody)) throw new Error("self-test: a nudge-tool + persona request must route to the judge")
  if (isJudgeRequest({ tools: [{ type: "function", function: { name: "read" } }], messages: [{ role: "system", content: "# Memorian" }] })) {
    throw new Error("self-test: a request without the nudge tool must route to the parent")
  }
  if (isJudgeRequest({ tools: [{ type: "function", function: { name: NUDGE_TOOL } }], messages: [{ role: "system", content: "you are a helpful agent" }] })) {
    throw new Error("self-test: a nudge tool without the persona must route to the parent")
  }

  const router = createRouter({ judgeSteps: [{ type: "tool_call", name: NUDGE_TOOL }] })
  router.setParentSteps([{ type: "text", text: "p1" }, { type: "text", text: "p2" }])
  const first = router.steps({ messages: [] })
  if (first[0]?.text !== "p1") throw new Error("self-test: the first request must read the first parent step at cursor 0")
  const second = router.steps(judgeBody)
  if (second.length !== 2 || second[1]?.name !== NUDGE_TOOL) throw new Error("self-test: a routed step must land at the server's global cursor")
  const third = router.steps({ messages: [] })
  if (third.length !== 3 || third[2]?.text !== "p2") throw new Error("self-test: parent and judge counters must advance independently")
  if (router.state.judge !== 1 || router.state.parent !== 2) throw new Error("self-test: request counters are wrong")
  const retried = router.steps(judgeBody)
  if (retried[3]?.name !== NUDGE_TOOL) throw new Error("self-test: an exhausted judge script must repeat its last step, never fall back to a success text")

  const sandbox = { root: "/tmp/x", agentDir: "/tmp/x/agent", memoryHome: "/tmp/x/memory", homeDir: "/tmp/x/home" }
  assertSandboxEnv(sandbox, { SENPI_CODING_AGENT_DIR: "/tmp/x/agent", OMO_MEMORY_HOME: "/tmp/x/memory", HOME: "/tmp/x/home" })
  let escaped = false
  try { assertSandboxEnv(sandbox, { SENPI_CODING_AGENT_DIR: `${process.env.HOME}/.omo/agent`, OMO_MEMORY_HOME: "/tmp/x/memory", HOME: "/tmp/x/home" }) }
  catch { escaped = true }
  if (!escaped) throw new Error("self-test: a real agent dir must fail the sandbox assertion")
  let leaked = false
  try { assertSandboxEnv(sandbox, { SENPI_CODING_AGENT_DIR: "/tmp/x/agent", OMO_MEMORY_HOME: "/tmp/x/memory", HOME: "/tmp/x/home", OMO_CODING_AGENT_DIR: "/real" }) }
  catch { leaked = true }
  if (!leaked) throw new Error("self-test: an unscrubbed OMO_CODING_AGENT_DIR must fail the sandbox assertion")

  console.log("SELF-TEST OK")
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.includes("--self-test")) runSelfTest()
  else await main()
}
