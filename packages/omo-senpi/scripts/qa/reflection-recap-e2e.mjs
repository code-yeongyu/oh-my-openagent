#!/usr/bin/env bun
// Real RPC + detached print-mode child + parent git integration. Only the HTTP model is scripted.
import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs"
import { spawnSync } from "node:child_process"
import { homedir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { pathToFileURL } from "node:url"
import { credentialDigest } from "./drive.mjs"
import { snapshotProtectedState, protectedSnapshotsUntouched } from "./isolation-state.mjs"
import { startMockCompletionsServer } from "./mock-completions-server.mjs"
import {
  DEFAULT_PLUGIN_ROOT, DEFAULT_SENPI_CLI, REPO_ROOT, prepareSandbox, sandboxEnv,
  assertSandboxEnv, resolveCommand, launchRpc, teardown, watchUntil, readEntries,
  createCleanup, installInterruptCleanup, removeSandbox, writeEvidence, isAlive,
} from "./kibitzer-sidecar-support.mjs"
import { createReplayGate, retainRuntime } from "./reflection-recap-runtime.mjs"

export const REPORT = [
  "# RECAP_E2E_SENTINEL", "", "한국어 합성 기억 보고서",
  "- Recorded the synthetic rollout preference in `reference/recap.md`.",
  "[Historical memory path](reference/recap.md)",
  "[External reference](https://example.test/reflection)",
  "이번 합성 실험에서는 배포 선호를 별도의 기억 저장소에 기록했습니다. 좁은 화면에서도 문장이 자연스럽게 이어지고 글자를 선택할 수 있어야 합니다. 상대 경로는 역사적인 변경 위치를 나타낼 뿐 현재 프로젝트의 파일을 가리키지 않습니다. 외부 문서 주소는 명시적인 링크로 구분하며 접힌 카드에서는 짧은 미리보기만 표시합니다. 펼친 화면은 원래 보고서의 줄바꿈과 마크다운 구조를 유지합니다. 다시 연결한 세션에서도 동일한 커밋과 출처를 확인할 수 있고 실패한 작업은 학습 결과로 표시하지 않습니다. 이 문단은 한국어의 가독성과 화면 너비에 따른 배치를 실제 런타임 출력으로 살펴보기 위한 내용입니다.",
].join("\n")
const COMPLETION = "senpi-memory.reflection-completion"
const DEADLINE = 90_000
const sha256 = (file) => createHash("sha256").update(readFileSync(file)).digest("hex")

function optionsFrom(argv) {
  const options = { case: "merged", keep: false, pluginRoot: DEFAULT_PLUGIN_ROOT, senpiCli: DEFAULT_SENPI_CLI }
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]
    if (arg === "--keep-sandbox" || arg === "--keep") { options.keep = true; continue }
    const field = { "--case": "case", "--evidence-dir": "evidenceDir", "--plugin-root": "pluginRoot", "--senpi-cli": "senpiCli" }[arg]
    if (field === undefined || argv[index + 1] === undefined) throw new Error(`Invalid argument: ${arg}`)
    options[field] = argv[++index]
  }
  assert(["merged", "exclusions", "replay"].includes(options.case), "--case must be merged|exclusions|replay")
  if (options.evidenceDir === undefined) {
    const result = spawnSync(process.execPath, [join(REPO_ROOT, ".agents/skills/senpi-qa/scripts/resolve-evidence-dir.mjs"), "--repo-root", REPO_ROOT, "--slug", "20260913-reflection-recap"], { encoding: "utf8" })
    assert.equal(result.status, 0, result.stderr)
    options.evidenceDir = join(result.stdout.trim(), `live-${options.case}`)
  }
  return options
}

async function request(session, message) {
  const id = `recap-${session.mark()}`
  const response = session.waitFrom(session.mark(), (event) => event.type === "response" && event.id === id, DEADLINE, message.type)
  session.send({ ...message, id })
  const frame = await response
  assert.equal(frame.success, true, JSON.stringify(frame))
  return frame.data
}

async function turn(session, message) {
  const end = session.waitFrom(session.mark(), (event) => event.type === "agent_end", DEADLINE, "parent agent_end")
  await request(session, { type: "prompt", message })
  await end
}

function writeConfig(sandbox) {
  writeFileSync(join(sandbox.cwd, ".omo", "omo.json"), JSON.stringify({
    categories: { quick: { description: "Synthetic reflection QA", model: "omo-mock/mock-1" } },
    memory: { enabled: true, agent: "reflection-recap-qa", recall: { enabled: false }, facts: { enabled: false },
      dream: { enabled: false }, reflection: { sandbox: "off", trigger: { step_count: 0, on_compaction: false } } },
  }))
}

function git(repo, ...args) {
  const result = spawnSync("git", args, { cwd: repo, encoding: "utf8" })
  assert.equal(result.status, 0, result.stderr)
  return result.stdout.trim()
}

function completionFiles(identity) {
  const dir = join(identity, "runtime", "reflection", "completions")
  return existsSync(dir) ? readdirSync(dir).filter((name) => name.endsWith(".json")).map((name) => join(dir, name)) : []
}

function completionHashes(identity) {
  return Object.fromEntries(completionFiles(identity).map((file) => [file, sha256(file)]))
}

export async function runReflectionRecapE2e(options) {
  const cleanup = createCleanup()
  installInterruptCleanup(() => [cleanup])
  const protectedRoots = [join(homedir(), ".senpi", "agent"), join(homedir(), ".omo", "agent")]
  const before = protectedRoots.map((root) => credentialDigest(root))
  const protectedBefore = protectedRoots.map((root) => snapshotProtectedState(root))
  const manifest = { schemaVersion: 1, case: options.case, checks: [], cleanup: cleanup.receipts, retained: options.keep, runtime: { bun: Bun.version, node: process.version } }
  let parentSteps = []
  let childSteps = []
  let requestIndex = 0
  let childRequests = 0
  const server = startMockCompletionsServer({ steps(body) {
    const reflection = JSON.stringify(body.messages).includes("MEMORY_DIR=") && JSON.stringify(body.messages).includes("TRANSCRIPT_PATH=")
    if (reflection) childRequests++
    const step = (reflection ? childSteps : parentSteps).shift() ?? (reflection
      ? { type: "error", status: 400, body: { error: { message: "Synthetic child script exhausted" } } }
      : { type: "text", text: "Synthetic QA ready." })
    const script = new Array(requestIndex++).fill(undefined)
    script.push(step)
    return script
  } })
  cleanup.add("scripted HTTP provider", () => { server.close(); return "listener closed" })
  let sandbox
  try {
    const baseUrl = await server.ready
    sandbox = prepareSandbox(options.pluginRoot, baseUrl)
    cleanup.add("sandbox", () => removeSandbox(sandbox, options.keep))
    const sharedAgentDir = join(sandbox.homeDir, ".omo", "agent")
    mkdirSync(dirname(sharedAgentDir), { recursive: true })
    renameSync(sandbox.agentDir, sharedAgentDir)
    sandbox.agentDir = sharedAgentDir
    sandbox.sessionsDir = join(sharedAgentDir, "sessions")
    writeConfig(sandbox)
    const env = sandboxEnv(sandbox)
    assertSandboxEnv(sandbox, env)
    const command = resolveCommand(options)
    manifest.isolation = { root: sandbox.root, home: sandbox.homeDir, agentDir: sandbox.agentDir, memoryHome: sandbox.memoryHome, providerUrl: baseUrl, credentialsBefore: before }
    manifest.runtime.command = command
    manifest.runtime.pluginRoot = options.pluginRoot
    manifest.runtime.bundleSha256 = sha256(join(options.pluginRoot, "extensions", "omo.js"))
    manifest.runtime.supervisorSha256 = sha256(join(options.pluginRoot, "extensions", "memory-run-supervisor.mjs"))
    manifest.runtime.senpiSha256 = sha256(options.senpiCli)
    manifest.runtime.senpiVersion = JSON.parse(readFileSync(join(dirname(options.senpiCli), "..", "package.json"), "utf8")).version
    const openSession = (sessionFile) => {
      const actual = sessionFile === undefined ? command : { ...command, prefix: [...command.prefix, "--session", sessionFile] }
      const session = launchRpc(actual, sandbox, env)
      cleanup.add(`RPC pid ${session.pid}`, async () => { const receipt = await teardown(session); assert.equal(isAlive(session.pid), false); return receipt })
      return session
    }
    let session = openSession()
    const source = await request(session, { type: "get_state" })
    parentSteps = [
      { type: "tool_call", name: "memory", arguments: { command: "create", file_path: "reference/seed.md", description: "Synthetic seed", file_text: "Use staged synthetic rollouts.", reason: "seed isolated reflection QA" } },
      { type: "text", text: "Synthetic memory seeded." },
    ]
    await turn(session, "Remember the synthetic rollout preference using memory.")
    const seedEntries = readEntries(source.sessionFile)
    const binding = seedEntries.find((entry) => entry.customType === "senpi-memory.session-binding")?.data
    assert.equal(typeof binding?.identity, "string", "real runtime must bind the synthetic identity")
    manifest.seed = { binding, toolResults: seedEntries.filter((entry) => entry.message?.role === "toolResult").map((entry) => ({ toolName: entry.message.toolName, isError: entry.message.isError, details: entry.message.details })) }
    const identity = join(sandbox.memoryHome, "agents", binding.identity)
    const repo = join(identity, "repo")
    assert(existsSync(join(repo, "reference", "seed.md")), "real memory tool must persist the seed")
    await teardown(session)
    session = openSession()
    let state = await request(session, { type: "get_state" })
    parentSteps = [{ type: "text", text: "A second synthetic source conversation." }]
    await turn(session, "The synthetic rollout preference remains current.")
    await request(session, { type: "set_session_name", name: "Reflection recap QA" })
    const sourceIds = [source.sessionId, state.sessionId]
    const resumeArgs = [...command.prefix, "--session", state.sessionFile]
    manifest.session = { ...state, sourceConversationIds: sourceIds, identity, repo }
    manifest.launch = {
      cwd: sandbox.cwd,
      env: Object.fromEntries(["HOME", "USERPROFILE", "SENPI_CODING_AGENT_DIR", "OMO_MEMORY_HOME", "XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_CACHE_HOME", "PI_OFFLINE"].map((name) => [name, env[name]])),
      tui: { file: command.file, args: resumeArgs },
      rpc: { file: command.file, args: [...resumeArgs, "--mode", "rpc"] },
    }
    writeEvidence(options.evidenceDir, "manifest.json", manifest)
    const cases = options.case === "exclusions" ? ["no_changes", "failed", "dirty_uncommitted"] : ["merged"]
    for (const outcome of cases) {
      const base = git(repo, "rev-parse", "HEAD")
      const previous = new Set(completionFiles(identity))
      const write = "mkdir -p reference && printf '%s\\n' '---' 'description: Synthetic recap' '---' 'RECAP_GIT_SENTINEL' > reference/recap.md"
      const commit = `${write} && git add reference/recap.md && git commit -m 'qa: synthetic reflection integration'`
      const gate = options.case === "replay" ? createReplayGate(sandbox) : undefined
      childSteps = outcome === "failed" ? [{ type: "error", status: 429, body: { error: { message: "rate limit exceeded; retry after 7200 seconds" } } }]
        : outcome === "no_changes" ? [{ type: "text", text: REPORT }]
        : [{ type: "tool_call", name: "bash", arguments: { command: `${gate === undefined ? "" : `${gate.command} && `}${outcome === "merged" ? commit : write}` } }, { type: "text", text: REPORT }]
      const completed = watchUntil(identity, () => {
        const file = completionFiles(identity).find((file) => !previous.has(file))
        return file === undefined ? undefined : { file, record: JSON.parse(readFileSync(file, "utf8")) }
      }, { timeoutMs: DEADLINE, description: "durable completion" })
      const live = options.case === "replay" ? undefined : session.waitFrom(session.mark(), (event) => event.type === "entry_appended" && event.entry?.customType === COMPLETION, DEADLINE, "live enriched completion")
      const launched = options.case === "replay" ? session.waitFrom(session.mark(), (event) => event.type === "entry_appended" && event.entry?.customType === "senpi-memory.reflection-launched", DEADLINE, "reflection launched") : undefined
      await request(session, { type: "prompt", message: `/reflect --conversation ${sourceIds.join(",")}` })
      if (options.case === "replay") {
        // Disconnect the consumer, not the detached supervisor; a fresh process reconstructs from disk.
        await gate.ready
        const launch = await launched
        const outcomePath = join(identity, "runtime", "reflection", "runs", launch.entry.data.runId, "outcome.json")
        const childFinished = watchUntil(identity, () => existsSync(outcomePath) ? JSON.parse(readFileSync(outcomePath, "utf8")) : undefined,
          { timeoutMs: DEADLINE, description: "detached child outcome before restart" })
        await teardown(session)
        gate.release()
        await childFinished
        session = openSession(state.sessionFile)
        const recovered = session.waitFrom(0, (event) => event.type === "entry_appended" && event.entry?.customType === COMPLETION
          && event.entry.data?.runId === launch.entry.data.runId, DEADLINE, "startup completion drain")
        state = await request(session, { type: "get_state" })
        await recovered
      }
      const result = await completed
      const event = live === undefined ? undefined : await live
      writeEvidence(options.evidenceDir, `observed-${outcome}.json`, { completion: result.record, event })
      assert.equal(result.record.outcome, outcome)
      const beforePull = completionHashes(identity)
      const page = await request(session, { type: "extension_request", name: "omo.memory.reflections", data: { limit: 1 } })
      assert.deepEqual(completionHashes(identity), beforePull, "RPC pull must not mutate completion JSON")
      assert(!("recap" in JSON.parse(readFileSync(result.file, "utf8"))), "completion schema stays ordinary")
      if (outcome === "merged") {
        assert.equal(page.entries.length, 1)
        const recap = page.entries[0]
        assert.equal(recap.report.text, `${REPORT}\n`)
        assert.deepEqual(recap.conversationIds, sourceIds)
        assert.equal(recap.mergedCommitSha, result.record.mergedCommitSha)
        assert.equal(git(repo, "show", `${recap.mergedCommitSha}:reference/recap.md`).includes("RECAP_GIT_SENTINEL"), true)
        assert.notEqual(git(repo, "rev-parse", "HEAD"), base)
        if (event !== undefined) assert.deepEqual(event.entry.data.recap, recap)
        const replay = await request(session, { type: "extension_request", name: "omo.memory.reflections", data: {} })
        assert.deepEqual(replay.entries.map((entry) => entry.key), [recap.key])
        if (options.case === "replay") {
          const sourceBound = session.waitFrom(session.mark(), (event) => event.type === "entry_appended"
            && event.entry?.customType === "senpi-memory.session-binding"
            && event.entry.data?.identity === binding.identity, DEADLINE, "source memory binding")
          const switched = await request(session, { type: "switch_session", sessionPath: source.sessionFile })
          assert.equal(switched.cancelled, false)
          await sourceBound
          const switchedState = await request(session, { type: "get_state" })
          assert.equal(switchedState.sessionId, source.sessionId)
          const bindingProbe = { switched, state: switchedState }
          try {
            bindingProbe.memory = await request(session, { type: "extension_request", name: "omo.memory.status", data: {} })
          } catch (error) {
            bindingProbe.error = String(error)
          }
          writeEvidence(options.evidenceDir, "source-switch-binding.json", bindingProbe)
          writeEvidence(options.evidenceDir, "source-switch-trace.json", { stderr: session.stderr() })
          const sourcePage = await request(session, { type: "extension_request", name: "omo.memory.reflections", data: {} })
          assert.equal(sourcePage.sessionId, source.sessionId)
          assert.deepEqual(sourcePage.entries, page.entries)
          const recipientBound = session.waitFrom(session.mark(), (event) => event.type === "entry_appended"
            && event.entry?.customType === "senpi-memory.session-binding"
            && event.entry.data?.identity === binding.identity, DEADLINE, "recipient memory binding")
          const recipientSwitch = await request(session, { type: "switch_session", sessionPath: state.sessionFile })
          assert.equal(recipientSwitch.cancelled, false)
          await recipientBound
          const recipientPage = await request(session, { type: "extension_request", name: "omo.memory.reflections", data: {} })
          assert.equal(recipientPage.sessionId, state.sessionId)
          assert.deepEqual(recipientPage.entries, page.entries)
          assert.equal(readEntries(state.sessionFile).filter((entry) => entry.customType === COMPLETION && entry.data?.runId === result.record.runId).length, 1)
          writeEvidence(options.evidenceDir, "source-session-backfill.json", sourcePage)
        }
      } else {
        assert.deepEqual(page.entries, [])
        assert.equal(event.entry.data.recap, undefined)
        assert.equal(git(repo, "rev-parse", "HEAD"), base)
        if (outcome === "failed") {
          assert.equal(event.entry.data.reason, "spawn_failed")
          assert(event.entry.data.detail.includes("provider_unavailable:429"))
        }
      }
      const runDir = join(identity, "runtime", "reflection", "runs", result.record.runId)
      const child = JSON.parse(readFileSync(join(runDir, "outcome.json"), "utf8"))
      assert.equal(child.runId, result.record.runId)
      manifest.checks.push({ outcome, completion: result.record, live: event, page, completionHashes: beforePull, childOutcome: child })
      writeEvidence(options.evidenceDir, `rpc-${outcome}.json`, manifest.checks.at(-1))
    }
    assert(childRequests > 0, "real child must request generation through HTTP")
    manifest.childProviderRequests = childRequests
    if (options.keep) manifest.retainedRuntime = await retainRuntime({ sandbox, command, env, session: manifest.session, report: REPORT })
    manifest.status = "PASS"
  } catch (error) {
    manifest.status = "FAIL"
    manifest.error = error instanceof Error ? error.stack : String(error)
  } finally {
    await cleanup.run()
    manifest.isolation = { ...manifest.isolation, credentialsAfter: protectedRoots.map((root) => credentialDigest(root)) }
    manifest.isolation.realCredentialsUntouched = JSON.stringify(before) === JSON.stringify(manifest.isolation.credentialsAfter)
    const protectedAfter = protectedRoots.map((root) => snapshotProtectedState(root))
    manifest.isolation.realSenpiUntouched = protectedBefore.every((snapshot, index) => protectedSnapshotsUntouched(snapshot, protectedAfter[index]))
    manifest.isolation.observationScope = "Protected agent state; runtime HOME, coding-agent dir and memory home are isolated."
    if (!manifest.isolation.realCredentialsUntouched || !manifest.isolation.realSenpiUntouched || cleanup.receipts.some((receipt) => receipt.includes("FAILED"))) manifest.status = "FAIL"
    writeEvidence(options.evidenceDir, "manifest.json", manifest)
  }
  return manifest
}

if (import.meta.url === pathToFileURL(resolve(process.argv[1] ?? "")).href) {
  const options = optionsFrom(process.argv.slice(2))
  const manifest = await runReflectionRecapE2e(options)
  console.log(JSON.stringify({ status: manifest.status, case: options.case, evidence: options.evidenceDir, retained: manifest.retained, session: manifest.session, error: manifest.error }, null, 2))
  process.exitCode = manifest.status === "PASS" ? 0 : 1
}
