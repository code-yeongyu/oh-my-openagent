#!/usr/bin/env bun
// Live proof of the claim-receipt component on the real pinned Senpi RPC host with the BUILT plugin component:
//   1. an answer claiming "All tests pass." with no check gets a persisted verdict and ONE visible nudge, and the
//      host makes no extra provider request (the component never continues the run);
//   2. after a real check (an eval cell running tool.bash) that passes, the same claim is recorded as supported
//      and no second nudge appears;
//   3. the next human turn's provider request carries the nudge text, so the agent actually sees it.
//
// In `shadow` mode (the default launch, no flag) the same verdicts are recorded but no nudge is shown and nothing
// reaches the next provider request; `nudge` launches with --omo-senpi-claim-receipt-nudge and proves 1-3 above.
//
//   bun packages/omo-senpi/scripts/qa/claim-receipt-e2e.mjs <evidence-dir> [nudge|shadow]
import assert from "node:assert/strict"
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { createSandbox, credentialDigest, seedSandbox } from "./drive.mjs"
import { isAlive, launchRpc, sandboxEnv, teardown } from "./kibitzer-sidecar-support.mjs"
import { startMockCompletionsServer } from "./mock-completions-server.mjs"

const VERDICT = "omo-claim-receipt:verdict"
const NUDGE = "omo-claim-receipt:nudge"
const here = dirname(fileURLToPath(import.meta.url))
const repo = resolve(here, "../../../..")
const evidence = process.argv[2]
assert.ok(evidence, "provide the resolved senpi-qa evidence directory")
mkdirSync(evidence, { recursive: true })
const mode = process.argv[3] ?? "nudge"
assert.ok(mode === "nudge" || mode === "shadow", `unknown mode ${mode}`)
const nudgeOn = mode === "nudge"
const before = { senpi: credentialDigest(join(homedir(), ".senpi/agent")), omo: credentialDigest(join(homedir(), ".omo/agent")) }
const requests = []
const server = startMockCompletionsServer({
  steps: [
    { type: "text", text: "I fixed the parser. All tests pass." },
    {
      type: "tool_call",
      name: "eval",
      arguments: {
        language: "js",
        summary: "run the tests",
        code: "const r = await tool.bash({ command: \"echo 'bun test (simulated)'; printf ' 3 pass\\\\n 0 fail\\\\n'\" }); print(r.text)",
      },
    },
    { type: "text", text: "I ran them. All tests pass." },
    { type: "text", text: "Noted." },
  ],
  onRequest: (body) => requests.push(body),
})
const sandbox = createSandbox()
let session
let cleanup
try {
  seedSandbox(sandbox)
  writeFileSync(join(sandbox.agentDir, "settings.json"), JSON.stringify({ defaultProjectTrust: "ask", packages: [], sessionTitle: { enabled: false } }))
  writeFileSync(join(sandbox.agentDir, "models.json"), JSON.stringify({
    providers: {
      "omo-mock": {
        api: "openai-completions", baseUrl: await server.ready, apiKey: "mock",
        models: [{ id: "mock-1", name: "Mock", reasoning: false, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 200000, maxTokens: 8192 }],
      },
    },
  }))
  const command = {
    file: process.execPath,
    prefix: [join(repo, "node_modules/@code-yeongyu/senpi/dist/cli.js"), "--multi-session", "--session-runtime", "in-process", "--no-extensions", "-e", join(here, "claim-receipt-extension.ts"), ...(nudgeOn ? ["--omo-senpi-claim-receipt-nudge"] : [])],
  }
  session = launchRpc(command, sandbox, sandboxEnv(sandbox))
  let sequence = 0
  const request = async (payload) => {
    const id = `claim-receipt-${++sequence}`
    const response = session.waitFrom(session.mark(), (event) => event.type === "response" && event.id === id, 60_000, payload.type)
    session.send({ id, ...payload })
    const result = await response
    assert.equal(result.success, true, JSON.stringify(result.error))
    return result.data
  }
  const { sessionId } = await request({ type: "open_session", cwd: sandbox.cwd, kind: "interactive" })
  const send = async (message) => {
    const settled = session.waitFrom(session.mark(), (event) => event.type === "agent_settled" && event.sessionId === sessionId, 60_000, "agent_settled")
    await request({ type: "prompt", sessionId, message })
    await settled
  }
  const sessionEntries = async () => {
    const { sessionFile } = await request({ type: "get_state", sessionId })
    return readFileSync(sessionFile, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line))
  }
  const verdicts = (entries) => entries.filter((entry) => entry.type === "custom" && entry.customType === VERDICT).map((entry) => entry.data)
  const nudges = (entries) => entries.filter((entry) => entry.type === "custom_message" && entry.customType === NUDGE)

  await send("Fix the parser and tell me when it is done.")
  const afterFirst = await sessionEntries()
  assert.equal(requests.length, 1, "the boundary must not start another provider request")
  const [first] = verdicts(afterFirst)
  assert.ok(first, JSON.stringify({ stderr: session.stderr(), types: afterFirst.map((e) => e.customType ?? e.message?.role ?? e.type) }))
  assert.equal(first.flagged, true)
  assert.equal(first.nudged, nudgeOn)
  assert.equal(first.verdicts[0].status, "unsupported")
  assert.equal(first.verdicts[0].reason, "no-check")
  const firstNudges = nudges(afterFirst)
  assert.equal(firstNudges.length, nudgeOn ? 1 : 0)
  if (nudgeOn) {
    assert.equal(firstNudges[0].display, true)
    const answerIndex = afterFirst.findIndex((entry) => entry.id === first.answerEntryId)
    assert.ok(answerIndex !== -1 && afterFirst.indexOf(firstNudges[0]) > answerIndex, "the nudge lands after the final answer")
  }

  await send("Please run the tests.")
  const afterSecond = await sessionEntries()
  assert.equal(requests.length, 3, "a tool turn and a final turn, nothing else")
  const second = verdicts(afterSecond)[1]
  const toolResults = afterSecond.filter((entry) => entry.message?.role === "toolResult").map((entry) => ({ tool: entry.message.toolName, isError: entry.message.isError, text: JSON.stringify(entry.message.content).slice(0, 300) }))
  assert.ok(second)
  assert.equal(second.flagged, false, JSON.stringify({ verdict: second.verdicts[0], toolResults }))
  assert.equal(second.verdicts[0].status, "supported")
  assert.equal(second.verdicts[0].receipt.kind, "test")
  assert.equal(nudges(afterSecond).length, nudgeOn ? 1 : 0, "a supported claim adds no nudge")

  await send("Thanks.")
  assert.equal(requests.length, 4)
  const nudgeSeen = JSON.stringify(requests[1]).includes("claim-receipt")
  assert.equal(nudgeSeen, nudgeOn, nudgeOn ? "the next provider request after the nudge carries it into the model context" : "shadow mode sends nothing to the model")

  await request({ type: "close_session", sessionId })
  cleanup = await teardown(session)
  assert.equal(isAlive(session.pid), false)
  const after = { senpi: credentialDigest(join(homedir(), ".senpi/agent")), omo: credentialDigest(join(homedir(), ".omo/agent")) }
  assert.deepEqual(after, before)
  const result = {
    verdict: "PASS",
    mode,
    surface: "real pinned Senpi RPC (in-process session runtime) with the built claim-receipt component",
    providerRequests: requests.length,
    first: { flagged: first.flagged, nudged: first.nudged, status: first.verdicts[0].status, reason: first.verdicts[0].reason, nudgeDisplay: firstNudges[0]?.display ?? null },
    second: { flagged: second.flagged, status: second.verdicts[0].status, receiptKind: second.verdicts[0].receipt.kind },
    nudgeCount: nudges(afterSecond).length,
    nudgeInNextProviderRequest: nudgeSeen,
    realCredentialsUntouched: true,
    isolatedAgentDir: sandbox.agentDir,
    cleanup,
  }
  writeFileSync(join(evidence, `claim-receipt-live-${mode}.json`), `${JSON.stringify(result, null, 2)}\n`)
  writeFileSync(join(evidence, `claim-receipt-live-${mode}-session.jsonl`), `${(await Promise.resolve(afterSecond)).map((entry) => JSON.stringify(entry)).join("\n")}\n`)
  console.log(JSON.stringify(result))
} finally {
  if (session && isAlive(session.pid)) await teardown(session)
  server.close()
  rmSync(sandbox.root, { recursive: true, force: true })
  assert.equal(existsSync(sandbox.root), false)
  console.log("CLEANUP: sandbox removed; owned RPC process exited")
}
