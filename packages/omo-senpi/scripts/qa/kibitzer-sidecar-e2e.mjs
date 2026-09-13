#!/usr/bin/env bun
// allow: SIZE_OK - one auditable offline proof of the resident Kibitzer sidecar: sandbox, mock
// provider, RPC parent, sidecar readers and the per-scenario assertions are one indivisible lifecycle.
//
// Offline end-to-end proof of the resident Kibitzer sidecar against the REAL senpi binary running the
// built plugin artifact and a mock openai-completions provider on 127.0.0.1
// (plan .omo/plans/kibitzer-resident-sidecar.md todo 15).
//
//   happy          one parent session, three turns: the first fresh candidate seeds ONE resident child
//                  (`recall/sidecars/<base64url(session)>/` holds exactly one child JSONL), its nudge is
//                  held and reaches the parent on the next turn, the repeated candidate starts no second
//                  provider turn, and a fresh candidate revives the SAME child through a followUp wake.
//   provider-429   the child's provider answers 429 with an hour-plus wait: the turn fails in one request,
//                  the machine-wide lease is released, the sidecar backs off, and the lazily recreated
//                  child's seed spans every parent cursor the failed child was handed - nothing dropped,
//                  no duplicate generation, and the nudge still reaches the parent.
//   context-reseed the provider reports 40k prompt tokens (60% of the 48k budget is 28.8k): the next
//                  fresh candidate seeds a replacement child whose first message is the reseed envelope
//                  carrying the delivered path, followed by the wake for the new candidate.
//
// Every wait is an RPC event, a filesystem change or a process exit with a bounded timeout. Evidence
// is structured: the mock's request log, the parent session JSONL and every child transcript.
import { copyFileSync, existsSync } from "node:fs"
import { join } from "node:path"
import { pathToFileURL } from "node:url"

import { startMockCompletionsServer } from "./mock-completions-server.mjs"
import {
  MEMORIES,
  RATE_LIMIT_STEP,
  SIDECAR_TOOL_NAMES,
  WAKE_TIMEOUT_MS,
  assertSandboxEnv,
  childTranscripts,
  createCleanup,
  createRouter,
  encodeSidecarDirName,
  decodeSidecarDirName,
  getState,
  installInterruptCleanup,
  isNudged,
  isRecall,
  isSidecarRequest,
  launchRpc,
  leaseFiles,
  messageText,
  nudgeStep,
  nudgedPaths,
  parseArgs,
  pendingFile,
  prepareSandbox,
  prompt,
  readEntries,
  removeSandbox,
  resolveCommand,
  sameNames,
  sandboxEnv,
  seedMemories,
  sidecarDirs,
  teardown,
  toolCallsOf,
  waitForAccepted,
  watchUntil,
  writeEvidence,
  writeOmoConfig,
} from "./kibitzer-sidecar-support.mjs"

export const SCENARIOS = ["happy", "provider-429", "context-reseed"]
/** The child backoff band starts at one second; each parent turn is the only clock that can end it. */
const MAX_BACKOFF_TURNS = 8
/** Longer than the first backoff band, so a turn that landed inside it is followed by one that does not. */
const BACKOFF_PROBE_MS = 1_500
/** `memory.recall.sidecar_max_tokens` default 48000 * 0.6 = 28800; this usage report crosses it. */
const RESEED_USAGE = { prompt_tokens: 40000, completion_tokens: 12, total_tokens: 40012 }

const checks = []
const activeCleanups = []

function record(name, ok, detail) {
  checks.push({ name, ok, detail })
  console.log(`${ok ? "PASS" : "FAIL"} ${name} :: ${detail}`)
  return ok
}

export function envelopeCursors(text) {
  const match = /^<kibitzer-(?:seed|wake) [^>]*cursor-from="(\d+)"[^>]*cursor-to="(\d+)"/u.exec(text)
  return match === null ? undefined : { from: Number(match[1]), to: Number(match[2]) }
}

export function candidatePathsOf(text) {
  return [...text.matchAll(/<candidate path="([^"]+)"/gu)].map((match) => match[1])
}

/** The assistant message that settled the turn opened by the user message matching `isUser`. */
export function settledAfter(transcript, isUser) {
  const index = transcript.entries.findIndex((entry) => entry.type === "message" && entry.message?.role === "user" && isUser(messageText(entry.message)))
  if (index < 0) return undefined
  return transcript.entries.slice(index + 1).map((entry) => entry.message).find((message) => message?.role === "assistant" && message.stopReason === "stop")
}

// ---- the scenario harness ----------------------------------------------------------------------------------

async function withHarness(scenario, options, run) {
  const cleanup = createCleanup()
  activeCleanups.push(cleanup)
  const router = createRouter()
  const facts = { scenario }
  let identity
  let state
  try {
    const command = resolveCommand(options)
    facts.command = command.display
    const requestLogPath = options.evidenceDir === undefined ? undefined : writeEvidence(options.evidenceDir, `${scenario}-mock-requests.jsonl`, "")
    const server = startMockCompletionsServer({ steps: router.steps, requestLogPath, classifyRequest: router.classify })
    cleanup.add("mock server", () => { server.close(); return "closed" })
    facts.baseUrl = await server.ready
    const sandbox = prepareSandbox(options.pluginRoot, facts.baseUrl)
    cleanup.add("sandbox", () => removeSandbox(sandbox, options.keepSandbox))
    facts.sandboxRoot = sandbox.root
    const env = sandboxEnv(sandbox)
    assertSandboxEnv(sandbox, env)
    const seed = await seedMemories(command, sandbox, env, router, [MEMORIES.rollout, MEMORIES.helm])
    facts.seed = { sessionId: seed.sessionId, identities: seed.identities, results: seed.results, teardown: seed.teardown }
    if (!record(`${scenario}.memory-seeded`, seed.ok, seed.ok ? `identity=${seed.identities[0]} memories=${seed.seeded.length}` : `seed failed: ${JSON.stringify(seed.results)} identities=${seed.identities.length} stderr=${seed.stderr?.replace(/\n/g, " | ")}`)) return facts
    identity = seed.identities[0]
    // The seed session's own provider turns never count as parent turns of the scenario.
    const seedRequests = router.state.parent
    facts.seed.parentRequests = seedRequests
    writeOmoConfig(sandbox, { recallEnabled: true })
    const session = launchRpc(command, sandbox, env)
    cleanup.add("rpc session", () => teardown(session))
    state = await getState(session)
    facts.sessionId = state.sessionId
    facts.sessionFile = state.sessionFile
    record(`${scenario}.session-identified`, typeof state.sessionFile === "string" && state.sessionFile.length > 0, `pid=${session.pid} sessionId=${state.sessionId}`)
    await run({ session, state, identity, router, facts, parentTurns: () => router.state.parent - seedRequests, record: (name, ok, detail) => record(`${scenario}.${name}`, ok, detail) })
    // Shut the parent down while the sandbox is still observable: the lease and the pending file must be gone.
    const exit = await teardown(session)
    const leases = leaseFiles(identity)
    const pendingLeft = existsSync(pendingFile(identity, state.sessionId))
    facts.shutdown = { teardown: exit, leaseFiles: leases, pendingFilePresent: pendingLeft, sidecarLineages: sidecarDirs(identity).length }
    record(`${scenario}.shutdown-clean`, leases.length === 0 && !pendingLeft, `teardown=${exit} leases=${leases.length} pending=${pendingLeft} stderrTail=${session.stderr().slice(-300).replace(/\n/g, " | ") || "none"}`)
  } catch (error) {
    record(`${scenario}.uncaught`, false, error instanceof Error ? (error.stack ?? error.message) : String(error))
  } finally {
    if (options.evidenceDir !== undefined && identity !== undefined) snapshotEvidence(options.evidenceDir, scenario, identity, state)
    facts.requests = { parent: router.state.parent, sidecar: router.state.sidecar, sidecarToolNames: router.state.sidecarRequests.map((request) => request.toolNames) }
    facts.cleanup = await cleanup.run()
    console.log(`cleanup: ${facts.cleanup.join(", ")}`)
  }
  return facts
}

function snapshotEvidence(evidenceDir, scenario, identity, state) {
  if (state?.sessionFile !== undefined && existsSync(state.sessionFile)) copyFileSync(state.sessionFile, join(evidenceDir, `${scenario}-parent-session.jsonl`))
  for (const lineage of sidecarDirs(identity)) {
    childTranscripts(lineage.dir).forEach((transcript, index) => {
      copyFileSync(transcript.file, join(evidenceDir, `${scenario}-sidecar-${lineage.name}-gen${index + 1}.jsonl`))
    })
  }
}

// ---- happy ---------------------------------------------------------------------------------------------------------

async function runHappy({ session, state, identity, router, facts, parentTurns, record }) {
  const encoded = encodeSidecarDirName(state.sessionId)
  const pending = pendingFile(identity, state.sessionId)
  router.setParentSteps([{ type: "text", text: "Checking." }, { type: "text", text: "Done." }, { type: "text", text: "Noted." }])
  router.setSidecarSteps([nudgeStep(MEMORIES.rollout)])

  // Wake 1: the first fresh candidate seeds the resident child; delivery holds its accepted nudge.
  await prompt(session, MEMORIES.rollout.prompt)
  const held = await waitForAccepted(identity, state, MEMORIES.rollout, { description: "happy wake 1: accepted nudge" })
  const lineages = sidecarDirs(identity)
  const lineage = lineages[0]
  record("one-sidecar-lineage", lineages.length === 1 && lineage?.name === encoded && lineage?.sessionId === state.sessionId, `dirs=[${lineages.map((entry) => entry.name).join(",")}] decoded=${lineage?.sessionId} parent=${state.sessionId}`)
  if (lineage === undefined) return
  let transcripts = childTranscripts(lineage.dir)
  const seedText = messageText(transcripts[0]?.users[0])
  record("one-child-generation", transcripts.length === 1 && transcripts[0].users.length === 1, `transcripts=${transcripts.length} userMessages=${transcripts[0]?.users.length}`)
  record("seed-envelope", seedText.startsWith("<kibitzer-seed ") && seedText.includes(`session="${state.sessionId}"`) && candidatePathsOf(seedText).includes(MEMORIES.rollout.path) && envelopeCursors(seedText) !== undefined, `head=${JSON.stringify(seedText.slice(0, 120))} candidates=${candidatePathsOf(seedText).join(",")} cursors=${JSON.stringify(envelopeCursors(seedText))}`)
  const nudgeCall = transcripts[0]?.assistants.flatMap(toolCallsOf).find((call) => call.name === "nudge")
  record("child-called-nudge", nudgeCall?.arguments?.path === MEMORIES.rollout.path, `nudge=${JSON.stringify(nudgeCall?.arguments ?? null)}`)
  record("nudge-accepted", held.nudges.length === 1 && held.nudges[0].path === MEMORIES.rollout.path && held.nudges[0].hint === MEMORIES.rollout.body, `held=${JSON.stringify(held)}`)
  const registry = router.state.sidecarRequests[0]?.toolNames ?? []
  record("sidecar-registry-exact", router.state.sidecar === 1 && sameNames(registry, SIDECAR_TOOL_NAMES), `sidecarRequests=${router.state.sidecar} tools=[${registry.join(",")}]`)
  record("lease-released-after-wake", leaseFiles(identity).length === 0, `leases=${leaseFiles(identity).length}`)

  // Turn 2 repeats the candidate: the held nudge is drained into the parent and no provider turn starts.
  const sidecarBefore = router.state.sidecar
  const usersBefore = transcripts[0]?.users.length ?? 0
  await prompt(session, MEMORIES.rollout.prompt)
  let entries = readEntries(state.sessionFile)
  const nudged = entries.filter(isNudged)
  const recall = entries.filter(isRecall)
  record("nudge-reached-parent", nudged.length === 1 && nudgedPaths(entries).join(",") === MEMORIES.rollout.path && recall.length === 1 && (recall[0].content ?? "").includes(MEMORIES.rollout.body), `nudgedEntries=${nudged.length} via=${nudged[0]?.data?.via} paths=${nudgedPaths(entries).join(",")} recallMessages=${recall.length}`)
  transcripts = childTranscripts(lineage.dir)
  record("repeated-candidate-no-turn", router.state.sidecar === sidecarBefore && transcripts.length === 1 && transcripts[0].users.length === usersBefore && sidecarDirs(identity).length === 1, `sidecarRequests=${router.state.sidecar} (was ${sidecarBefore}) transcripts=${transcripts.length} userMessages=${transcripts[0]?.users.length}`)
  record("pending-drained", !existsSync(pending), `pending=${existsSync(pending)}`)

  // Turn 3 brings a fresh candidate to the IDLE child: a followUp wake on the same generation, declined.
  router.setSidecarSteps([{ type: "text", text: "No stored memory changes this." }])
  await prompt(session, MEMORIES.helm.prompt)
  const woken = await watchUntil(lineage.dir, () => {
    const current = childTranscripts(lineage.dir)
    const settled = current[0] === undefined ? undefined : settledAfter(current[0], (text) => text.startsWith("<kibitzer-wake "))
    return settled === undefined ? undefined : current
  }, { timeoutMs: WAKE_TIMEOUT_MS, description: "happy wake 2: followUp wake settled in the child transcript" })
  const wakeText = messageText(woken[0].users.find((message) => messageText(message).startsWith("<kibitzer-wake ")))
  record("idle-followup-same-child", woken.length === 1 && woken[0].users.length === 2 && candidatePathsOf(wakeText).includes(MEMORIES.helm.path), `transcripts=${woken.length} userMessages=${woken[0].users.length} wakeCandidates=${candidatePathsOf(wakeText).join(",")} cursors=${JSON.stringify(envelopeCursors(wakeText))}`)
  record("followup-request-counted", router.state.sidecar === sidecarBefore + 1 && router.state.sidecarRequests.every((request) => sameNames(request.toolNames, SIDECAR_TOOL_NAMES)), `sidecarRequests=${router.state.sidecar}`)
  entries = readEntries(state.sessionFile)
  record("declined-wake-delivers-nothing", entries.filter(isNudged).length === 1 && !existsSync(pending), `nudgedEntries=${entries.filter(isNudged).length} pending=${existsSync(pending)}`)
  facts.result = {
    resident: woken.length === 1 && sidecarDirs(identity).length === 1,
    childSessions: sidecarDirs(identity).length,
    childGenerations: woken.length,
    wakes: woken[0].users.length,
    nudged: nudgedPaths(entries).length,
    nudgedVia: entries.filter(isNudged).map((entry) => entry.data?.via),
    sidecarRequests: router.state.sidecar,
    parentRequests: parentTurns(),
  }
}

// ---- provider-429 ----------------------------------------------------------------------------------------------

async function runProvider429({ session, state, identity, router, facts, parentTurns, record }) {
  const recallDir = join(identity, "runtime", "recall")
  const locksDir = join(identity, "runtime", "locks")
  const pending = pendingFile(identity, state.sessionId)
  router.setParentSteps(Array.from({ length: MAX_BACKOFF_TURNS + 4 }, () => ({ type: "text", text: "Checking." })))
  router.setSidecarSteps([RATE_LIMIT_STEP])

  // Wake 1 fails: the child's provider answers 429 with a wait no fallback can absorb.
  await prompt(session, MEMORIES.rollout.prompt)
  const failed = await watchUntil(recallDir, () => {
    const lineage = sidecarDirs(identity)[0]
    const transcripts = lineage === undefined ? [] : childTranscripts(lineage.dir)
    const error = transcripts[0]?.assistants.find((message) => message.stopReason === "error")
    return error === undefined ? undefined : { lineage, transcripts, error }
  }, { timeoutMs: WAKE_TIMEOUT_MS, description: "provider-429 wake 1: child turn settled as an error" })
  const seed1 = messageText(failed.transcripts[0].users[0])
  record("child-turn-failed-on-429", /429|rate.?limit/iu.test(failed.error.errorMessage ?? ""), `errorMessage=${JSON.stringify((failed.error.errorMessage ?? "").slice(0, 200))}`)
  record("single-bounded-attempt", router.state.sidecar === 1 && failed.transcripts.length === 1, `sidecarRequests=${router.state.sidecar} transcripts=${failed.transcripts.length}`)
  await watchUntil(locksDir, () => (leaseFiles(identity).length === 0 ? true : undefined), { timeoutMs: WAKE_TIMEOUT_MS, description: "provider-429: wake lease released after the failure" })
  record("lease-released-after-failure", true, `leases=${leaseFiles(identity).length}`)
  record("nothing-delivered-on-failure", readEntries(state.sessionFile).filter(isNudged).length === 0 && !existsSync(pending), `nudged=${readEntries(state.sessionFile).filter(isNudged).length} pending=${existsSync(pending)}`)

  // Recovery: the provider heals; parent turns are the only clock that can end the backoff band, so
  // each turn is followed by a bounded watch for the replacement transcript (the band opens at 1 s).
  router.setSidecarSteps([nudgeStep(MEMORIES.rollout)])
  let turns = 0
  let transcripts = failed.transcripts
  while (turns < MAX_BACKOFF_TURNS && transcripts.length < 2) {
    turns += 1
    await prompt(session, MEMORIES.rollout.prompt)
    transcripts = await watchUntil(failed.lineage.dir, () => {
      const current = childTranscripts(failed.lineage.dir)
      return current.length >= 2 && current[1].users.length > 0 ? current : undefined
    }, { timeoutMs: BACKOFF_PROBE_MS, description: `provider-429 recovery turn ${turns}` }).catch(() => childTranscripts(failed.lineage.dir))
  }
  record("replacement-child-after-backoff", transcripts.length === 2 && sidecarDirs(identity).length === 1, `turnsUntilRecreate=${turns} generations=${transcripts.length} lineages=${sidecarDirs(identity).length}`)
  const seed2 = messageText(transcripts[1]?.users[0])
  const span1 = envelopeCursors(seed1)
  const span2 = envelopeCursors(seed2)
  record("replacement-seed-spans-buffered-events", seed2.startsWith("<kibitzer-seed ") && span1 !== undefined && span2 !== undefined && span2.from === span1.from && span2.to > span1.to && candidatePathsOf(seed2).includes(MEMORIES.rollout.path) && seed2.includes(MEMORIES.rollout.prompt), `seed1=${JSON.stringify(span1)} seed2=${JSON.stringify(span2)} candidates=${candidatePathsOf(seed2).join(",")}`)
  const held = await waitForAccepted(identity, state, MEMORIES.rollout, { description: "provider-429 wake 2: accepted nudge" })
  record("recovered-wake-accepted", held.nudges.length === 1 && held.nudges[0].path === MEMORIES.rollout.path && router.state.sidecar === 2, `held=${JSON.stringify(held)} sidecarRequests=${router.state.sidecar}`)
  await prompt(session, MEMORIES.rollout.prompt)
  const entries = readEntries(state.sessionFile)
  transcripts = childTranscripts(failed.lineage.dir)
  record("nudge-reached-parent-after-recovery", nudgedPaths(entries).join(",") === MEMORIES.rollout.path && entries.filter(isRecall).length === 1 && transcripts.length === 2, `paths=${nudgedPaths(entries).join(",")} via=${entries.filter(isNudged)[0]?.data?.via} generations=${transcripts.length}`)
  facts.result = {
    resident: sidecarDirs(identity).length === 1,
    childSessions: sidecarDirs(identity).length,
    childGenerations: transcripts.length,
    failedWakes: 1,
    turnsUntilRecreate: turns,
    nudged: nudgedPaths(entries).length,
    sidecarRequests: router.state.sidecar,
    parentRequests: parentTurns(),
    errorMessage: (failed.error.errorMessage ?? "").slice(0, 200),
  }
}

// ---- context-reseed --------------------------------------------------------------------------------------------

async function runContextReseed({ session, state, identity, router, facts, parentTurns, record }) {
  router.setParentSteps([{ type: "text", text: "Checking." }, { type: "text", text: "Done." }, { type: "text", text: "Noted." }])
  router.setSidecarSteps([nudgeStep(MEMORIES.rollout, { usage: RESEED_USAGE })])

  // Wake 1 delivers the first nudge and reports a context estimate past 60% of the budget.
  await prompt(session, MEMORIES.rollout.prompt)
  const first = await waitForAccepted(identity, state, MEMORIES.rollout, { description: "context-reseed wake 1: accepted nudge" })
  const lineage = sidecarDirs(identity)[0]
  record("first-wake-accepted", first.nudges.length === 1 && first.nudges[0].path === MEMORIES.rollout.path && sidecarDirs(identity).length === 1 && lineage !== undefined, `held=${JSON.stringify(first)} lineages=${sidecarDirs(identity).length}`)
  if (lineage === undefined) return
  let transcripts = childTranscripts(lineage.dir)
  const usage = transcripts[0]?.assistants.at(-1)?.usage
  record("usage-reported-past-threshold", transcripts.length === 1 && usage?.input === RESEED_USAGE.prompt_tokens, `generations=${transcripts.length} usage=${JSON.stringify(usage)}`)

  // Turn 2: the next fresh candidate seeds the replacement child with the reseed envelope first.
  router.setSidecarSteps([nudgeStep(MEMORIES.helm)])
  await prompt(session, MEMORIES.helm.prompt)
  // The replacement child is created with the reseed envelope; its settlement is the second pending nudge below.
  const reseeded = await watchUntil(lineage.dir, () => {
    const current = childTranscripts(lineage.dir)
    return messageText(current[1]?.users[0]).includes("</kibitzer-reseed>") ? current : undefined
  }, { timeoutMs: WAKE_TIMEOUT_MS, description: "context-reseed wake 2: replacement child seeded with the reseed envelope" })
  const opening = messageText(reseeded[1].users[0])
  const [reseedPart, wakePart = ""] = opening.split("</kibitzer-reseed>")
  const deliveredList = /<delivered count="(\d+)"[^>]*>([\s\S]*?)<\/delivered>/u.exec(reseedPart)
  record("replacement-child-reseeded", reseeded.length === 2 && opening.startsWith("<kibitzer-reseed ") && reseedPart.includes(`session="${state.sessionId}"`) && deliveredList?.[1] === "1" && (deliveredList?.[2] ?? "").includes(`<path>${MEMORIES.rollout.path}</path>`), `generations=${reseeded.length} head=${JSON.stringify(opening.slice(0, 100))} delivered=${JSON.stringify(deliveredList?.[2]?.trim())}`)
  record("reseed-followed-by-wake", wakePart.trimStart().startsWith("<kibitzer-wake ") && candidatePathsOf(wakePart).join(",") === MEMORIES.helm.path && !candidatePathsOf(wakePart).includes(MEMORIES.rollout.path), `wakeCandidates=${candidatePathsOf(wakePart).join(",")}`)
  const second = await waitForAccepted(identity, state, MEMORIES.helm, { description: "context-reseed wake 2: accepted nudge for the second candidate" })
  record("second-wake-accepted", second.nudges.length === 1 && second.nudges[0].path === MEMORIES.helm.path && router.state.sidecar === 2, `held=${JSON.stringify(second)} sidecarRequests=${router.state.sidecar}`)
  record("lease-released-after-reseed", leaseFiles(identity).length === 0, `leases=${leaseFiles(identity).length}`)

  // Turn 3 drains the second nudge; both paths have reached the parent through one lineage.
  await prompt(session, "thanks")
  const entries = readEntries(state.sessionFile)
  transcripts = childTranscripts(lineage.dir)
  record("both-nudges-reached-parent", nudgedPaths(entries).sort().join(",") === [MEMORIES.helm.path, MEMORIES.rollout.path].sort().join(",") && entries.filter(isRecall).length === 2 && transcripts.length === 2 && sidecarDirs(identity).length === 1, `paths=${nudgedPaths(entries).join(",")} recallMessages=${entries.filter(isRecall).length} generations=${transcripts.length}`)
  facts.result = {
    resident: sidecarDirs(identity).length === 1,
    childSessions: sidecarDirs(identity).length,
    childGenerations: transcripts.length,
    reseeded: opening.startsWith("<kibitzer-reseed "),
    contextTokensReported: usage?.input,
    nudged: nudgedPaths(entries).length,
    sidecarRequests: router.state.sidecar,
    parentRequests: parentTurns(),
  }
}

const RUNNERS = { happy: runHappy, "provider-429": runProvider429, "context-reseed": runContextReseed }

// ---- main --------------------------------------------------------------------------------------------------------

async function main() {
  const options = parseArgs(process.argv.slice(2), { scenarios: SCENARIOS })
  if (!existsSync(join(options.pluginRoot, "extensions", "omo.js"))) throw new Error(`plugin bundle not built at ${options.pluginRoot}/extensions/omo.js`)
  const command = resolveCommand(options)
  console.log(`plugin-root: ${options.pluginRoot}`)
  console.log(`command: ${command.display} (${command.source})`)
  console.log(`scenario: ${options.scenario}`)
  installInterruptCleanup(() => activeCleanups)

  const scenarios = options.scenario === "all" ? SCENARIOS : [options.scenario]
  const results = {}
  for (const scenario of scenarios) {
    results[scenario] = await withHarness(scenario, options, RUNNERS[scenario])
  }

  const failures = checks.filter((check) => !check.ok)
  const observed = Object.values(results).map((facts) => facts.result).filter((result) => result !== undefined)
  const summary = {
    ok: failures.length === 0 && observed.length === scenarios.length,
    driver: "kibitzer-sidecar-e2e",
    scenarios,
    // One resident lineage per parent session in every scenario; generations are the child transcripts inside it.
    resident: observed.length === scenarios.length && observed.every((result) => result.resident === true),
    childSessions: observed.reduce((max, result) => Math.max(max, result.childSessions ?? 0), 0),
    nudgedTotal: observed.reduce((sum, result) => sum + (result.nudged ?? 0), 0),
    results: Object.fromEntries(Object.entries(results).map(([scenario, facts]) => [scenario, facts.result ?? { resident: false }])),
    checks: checks.length,
    failures: failures.map((check) => check.name),
  }
  if (options.evidenceDir !== undefined) {
    summary.evidence = writeEvidence(options.evidenceDir, "kibitzer-sidecar-e2e.json", { ...summary, checks, facts: results })
    console.log(`evidence: ${summary.evidence}`)
  }
  console.log(JSON.stringify(summary))
  process.exit(summary.ok ? 0 : 1)
}

function runSelfTest() {
  const sidecarBody = { tools: SIDECAR_TOOL_NAMES.map((name) => ({ type: "function", function: { name } })), messages: [{ role: "system", content: "# Kibitzer — resident memory advisor" }] }
  if (!isSidecarRequest(sidecarBody)) throw new Error("self-test: the five tools plus the persona must route to the sidecar")
  if (isSidecarRequest({ tools: [{ type: "function", function: { name: "read" } }], messages: [{ role: "system", content: "# Kibitzer" }] })) throw new Error("self-test: a request without the nudge tool must route to the parent")
  if (isSidecarRequest({ tools: [{ type: "function", function: { name: "nudge" } }], messages: [{ role: "system", content: "you are a helpful agent" }] })) throw new Error("self-test: the nudge tool without the persona must route to the parent")

  const router = createRouter()
  router.setParentSteps([{ type: "text", text: "p1" }, { type: "text", text: "p2" }])
  router.setSidecarSteps([nudgeStep(MEMORIES.rollout)])
  const first = router.steps({ messages: [] })
  if (first.length !== 1 || first[0]?.text !== "p1") throw new Error("self-test: the first request reads the first parent step at cursor 0")
  const second = router.steps(sidecarBody)
  if (second.length !== 2 || second[1]?.name !== "nudge") throw new Error("self-test: a routed step lands at the server's global cursor")
  const third = router.steps({ messages: [] })
  if (third.length !== 3 || third[2]?.text !== "p2") throw new Error("self-test: parent and sidecar cursors advance independently")
  const exhausted = router.steps(sidecarBody)
  if (exhausted[3]?.type !== "text") throw new Error("self-test: an exhausted sidecar script must close the turn with text, never repeat a tool call")
  if (router.state.sidecar !== 2 || router.state.parent !== 2 || !sameNames(router.state.sidecarRequests[0].toolNames, SIDECAR_TOOL_NAMES)) throw new Error("self-test: request accounting is wrong")

  const id = "01a09203-650f-7933-b216-aaf19bfc00c2"
  if (decodeSidecarDirName(encodeSidecarDirName(id)) !== id || encodeSidecarDirName(id).includes("=")) throw new Error("self-test: the sidecar directory name must be unpadded base64url of the session id")
  const envelope = `<kibitzer-seed version="1" session="${id}" max-items="1" tool-budget="8" cursor-from="7" cursor-to="12">\n<candidates count="1" max-items="1">\n<candidate path="reference/a.md">\n</candidate>\n</candidates>\n</kibitzer-seed>\n`
  if (JSON.stringify(envelopeCursors(envelope)) !== JSON.stringify({ from: 7, to: 12 })) throw new Error("self-test: envelope cursor range parsing")
  if (candidatePathsOf(envelope).join() !== "reference/a.md") throw new Error("self-test: candidate path parsing")
  const transcript = { entries: [
    { type: "message", message: { role: "user", content: [{ type: "text", text: "<kibitzer-wake x>" }] } },
    { type: "message", message: { role: "assistant", content: [], stopReason: "error" } },
    { type: "message", message: { role: "assistant", content: [{ type: "text", text: "ok" }], stopReason: "stop" } },
  ] }
  if (settledAfter(transcript, (text) => text.startsWith("<kibitzer-wake "))?.stopReason !== "stop") throw new Error("self-test: settledAfter must find the stop after the matching user message")
  if (settledAfter(transcript, (text) => text.startsWith("<kibitzer-seed ")) !== undefined) throw new Error("self-test: settledAfter without the user message is undefined")

  const sandbox = { root: "/tmp/x", agentDir: "/tmp/x/agent", memoryHome: "/tmp/x/memory", homeDir: "/tmp/x/home" }
  assertSandboxEnv(sandbox, { SENPI_CODING_AGENT_DIR: "/tmp/x/agent", OMO_MEMORY_HOME: "/tmp/x/memory", HOME: "/tmp/x/home", PI_OFFLINE: "1" })
  for (const bad of [
    { SENPI_CODING_AGENT_DIR: `${process.env.HOME}/.omo/agent`, OMO_MEMORY_HOME: "/tmp/x/memory", HOME: "/tmp/x/home", PI_OFFLINE: "1" },
    { SENPI_CODING_AGENT_DIR: "/tmp/x/agent", OMO_MEMORY_HOME: "/tmp/x/memory", HOME: "/tmp/x/home", PI_OFFLINE: "1", OMO_PACKAGE_DIR: "/real" },
    { SENPI_CODING_AGENT_DIR: "/tmp/x/agent", OMO_MEMORY_HOME: "/tmp/x/memory", HOME: "/tmp/x/home" },
  ]) {
    let rejected = false
    try { assertSandboxEnv(sandbox, bad) } catch { rejected = true }
    if (!rejected) throw new Error(`self-test: the sandbox assertion must reject ${JSON.stringify(bad)}`)
  }
  console.log(JSON.stringify({ ok: true, driver: "kibitzer-sidecar-e2e", selfTest: true }))
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.includes("--self-test")) runSelfTest()
  else await main()
}
