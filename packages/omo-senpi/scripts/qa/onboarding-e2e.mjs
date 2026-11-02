#!/usr/bin/env bun
import assert from "node:assert/strict"
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { createSandbox, credentialDigest, seedSandbox } from "./drive.mjs"
import { launchRpc, sandboxEnv, teardown, isAlive } from "./kibitzer-sidecar-support.mjs"
import { startMockCompletionsServer } from "./mock-completions-server.mjs"

const here = dirname(fileURLToPath(import.meta.url))
const repo = resolve(here, "../../../..")
const evidence = process.argv[2]
const scenario = process.argv[3] ?? "default"
assert.ok(["default", "failure", "forced"].includes(scenario))
assert.ok(evidence, "provide the resolved senpi-qa evidence directory")
mkdirSync(evidence, { recursive: true })
const before = {
  senpi: credentialDigest(join(homedir(), ".senpi/agent")),
  omo: credentialDigest(join(homedir(), ".omo/agent")),
}
const requests = []
const server = startMockCompletionsServer({
  steps: [
    ...(scenario === "failure" ? [{ type: "error", status: 400, body: { error: { message: "synthetic terminal failure" } } }] : []),
    { type: "text", text: "first response" }, { type: "text", text: "second response" },
  ],
  onRequest: (body) => requests.push(body),
})
const sandbox = createSandbox()
let session
let cleanup
try {
  seedSandbox(sandbox)
  sandbox.sessionsDir = join(sandbox.agentDir, "sessions")
  sandbox.memoryHome = join(sandbox.root, "memory")
  mkdirSync(sandbox.sessionsDir, { recursive: true })
  // Load the actual component through the real extension loader, without unrelated components.
  writeFileSync(join(sandbox.agentDir, "settings.json"), JSON.stringify({
    defaultProjectTrust: "ask", packages: [], sessionTitle: { enabled: false },
  }))
  writeFileSync(join(sandbox.agentDir, "models.json"), JSON.stringify({
    providers: {
      "omo-mock": {
        api: "openai-completions", baseUrl: await server.ready, apiKey: "mock",
        models: [{ id: "mock-1", name: "Mock", reasoning: false, input: ["text"],
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 200000, maxTokens: 8192 }],
      },
    },
  }))
  const command = {
    file: process.execPath,
    prefix: [join(repo, "node_modules/@code-yeongyu/senpi/dist/cli.js"),
      "--multi-session", "--session-runtime", "in-process", "--no-extensions", "-e", join(here, "onboarding-extension.ts"),
      ...(scenario === "forced" ? ["--onboard"] : [])],
  }
  session = launchRpc(command, sandbox, sandboxEnv(sandbox))
  let sequence = 0
  const request = async (command) => {
    const id = `onboarding-${++sequence}`
    const response = session.waitFrom(session.mark(),
      (event) => event.type === "response" && event.id === id, 60_000, command.type)
    session.send({ id, ...command })
    const result = await response
    assert.equal(result.success, true, JSON.stringify(result.error))
    return result.data
  }
  const marker = join(sandbox.agentDir, "omo-senpi/omo-native/onboarding-completed")
  for (const purpose of ["probe", "auth", "prewarm"]) {
    const opened = await request({ type: "open_session", cwd: sandbox.cwd, kind: "interactive" })
    await request({ type: "get_available_models", sessionId: opened.sessionId })
    await request({ type: "close_session", sessionId: opened.sessionId })
    assert.equal(existsSync(marker), false, `${purpose} claimed onboarding`)
    assert.equal(requests.length, 0, `${purpose} sent a provider request`)
  }
  const opened = await request({ type: "open_session", cwd: sandbox.cwd, kind: "interactive" })
  let sessionId = opened.sessionId
  const outcomes = []
  const send = async (message) => {
    const ended = session.waitFrom(session.mark(),
      (event) => event.type === "agent_end" && event.sessionId === sessionId, 60_000, "agent_end")
    const settled = session.waitFrom(session.mark(),
      (event) => event.type === "agent_settled" && event.sessionId === sessionId, 60_000, "agent_settled")
    await request({ type: "prompt", sessionId, message })
    outcomes.push(await ended)
    await settled
  }
  await send("Fix my test")
  assert.equal(requests.length, 1, "the first prompt must make exactly one request")
  assert.equal(existsSync(marker), scenario !== "failure", JSON.stringify({
    outcomes, stderr: session.stderr(), surfaces: await request({ type: "get_loaded_surfaces", sessionId }),
  }))
  const messages = await request({ type: "get_messages", sessionId })
  const contexts = messages.messages.filter((message) => message.customType === "omo-onboarding:context")
  assert.equal(contexts.length, 1)
  assert.equal(contexts[0].display, false)
  const skillPath = contexts[0].content.match(/\S+\/onboarding\/SKILL\.md/)?.[0]
  assert.ok(skillPath && existsSync(resolve(skillPath)), "emitted skill pointer must exist")
  assert.ok(JSON.stringify(requests[0]).includes(JSON.stringify(contexts[0].content).slice(1, -1)),
    "same provider request must contain the injected context")
  await send("And the next test")
  assert.equal(requests.length, 2, "no extra onboarding turn after the second prompt")
  assert.equal(existsSync(marker), true, "retry must reclaim the marker")
  if (scenario === "failure") await send("One more test")
  const encodedContext = JSON.stringify(contexts[0].content).slice(1, -1)
  const contextCounts = requests.map((body) => JSON.stringify(body).split(encodedContext).length - 1)
  assert.deepEqual(contextCounts, scenario === "failure" ? [1, 1, 1] : [1, 1])
  const afterMessages = await request({ type: "get_messages", sessionId })
  assert.equal(afterMessages.messages.filter((message) => message.customType === "omo-onboarding:context").length, 1)
  await request({ type: "close_session", sessionId })
  const transitions = []
  if (scenario === "forced") {
    sessionId = (await request({ type: "open_session", cwd: sandbox.cwd, kind: "interactive" })).sessionId
    let sessionPath
    for (const name of ["new", "resume", "fork"]) {
      if (name === "new") {
        assert.equal((await request({ type: "new_session", sessionId })).cancelled, false)
      } else if (name === "resume") {
        assert.ok(sessionPath)
        assert.equal((await request({ type: "switch_session", sessionId, sessionPath })).cancelled, false)
      } else {
        const { messages } = await request({ type: "get_fork_messages", sessionId })
        assert.ok(messages[0]?.entryId)
        assert.equal((await request({ type: "fork", sessionId, entryId: messages[0].entryId })).cancelled, false)
      }
      await send(`Continue ${name}`)
      sessionPath = (await request({ type: "get_state", sessionId })).sessionFile
      const later = await request({ type: "get_messages", sessionId })
      assert.equal(later.messages.filter((message) => message.customType === "omo-onboarding:context").length, 0,
        JSON.stringify({ transition: name, marker: existsSync(marker), stderr: session.stderr(), contexts: later.messages.filter(
          (message) => message.customType === "omo-onboarding:context",
        ) }))
      transitions.push(name)
    }
    await request({ type: "close_session", sessionId })
  }
  cleanup = await teardown(session)
  assert.equal(isAlive(session.pid), false)
  const after = {
    senpi: credentialDigest(join(homedir(), ".senpi/agent")),
    omo: credentialDigest(join(homedir(), ".omo/agent")),
  }
  assert.deepEqual(after, before)
  const result = {
    verdict: "PASS", scenario, surface: "real pinned Senpi RPC with built onboarding component",
    backgroundSessions: 3, backgroundRequests: 0, firstPromptRequests: 1, totalRequestsAfterTwoPrompts: 2,
    hiddenContextCount: 1, contextCounts, transitions, markerClaimedOnFirstPrompt: scenario !== "failure", realSenpiUntouched: true,
    isolatedAgentDir: sandbox.agentDir, cleanup,
  }
  writeFileSync(join(evidence, `onboarding-live-${scenario}.json`), JSON.stringify(result, null, 2) + "\n")
  console.log(JSON.stringify(result))
} finally {
  if (session && isAlive(session.pid)) await teardown(session)
  server.close()
  rmSync(sandbox.root, { recursive: true, force: true })
  assert.equal(existsSync(sandbox.root), false)
  console.log("CLEANUP: sandbox removed; owned RPC process exited")
}
