#!/usr/bin/env bun
// Real AgentSession, packaged extension, and real eval kernels; no host or tool stubs.
import assert from "node:assert/strict"
import { spawn, spawnSync } from "node:child_process"
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, isAbsolute, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const script = fileURLToPath(import.meta.url)
const packageRoot = resolve(dirname(script), "../..")
const args = process.argv.slice(2)
function option(name, fallback) {
  const index = args.indexOf(name)
  if (index < 0) return fallback
  assert.ok(args[index + 1] && !args[index + 1].startsWith("--"), `${name} requires a value`)
  return resolve(args[index + 1])
}
function intOption(name, fallback) {
  const index = args.indexOf(name)
  if (index < 0) return fallback
  const value = args[index + 1]
  assert.ok(value && !value.startsWith("--"), `${name} requires a value`)
  const int = Number.parseInt(value, 10)
  if (!Number.isInteger(int) || int <= 0) {
    console.error(`Usage: ${process.argv[1]} [--deadline-ms <int>] [--evidence-dir <path>] [--plugin-root <path>]`)
    process.exit(2)
  }
  return int
}
const pluginRoot = option("--plugin-root", join(packageRoot, "plugin"))
const deadlineMs = intOption("--deadline-ms", 120_000)

async function runSession(sandbox) {
  const cwd = join(sandbox, "project")
  const agentDir = join(sandbox, "agent")
  const { createAgentSession, DefaultResourceLoader, SessionManager, SettingsManager } = await import("@code-yeongyu/senpi")
  const settingsManager = SettingsManager.inMemory({})
  const loader = new DefaultResourceLoader({ cwd, agentDir, settingsManager, additionalExtensionPaths: [pluginRoot] })
  let session
  const results = []
  async function check(number, name, action) {
    try {
      const detail = await action()
      results.push({ number, status: detail === "SKIP" ? "SKIP" : "PASS" })
      console.log(`${detail === "SKIP" ? "SKIP" : "PASS"} check ${number}: ${name}`)
    } catch (error) {
      results.push({ number, status: "FAIL" })
      console.error(`FAIL check ${number}: ${name}\n${error.stack ?? error}`)
    }
  }
  try {
    await loader.reload()
    assert.deepEqual(loader.getExtensions().errors, [], "extension load errors")
    ;({ session } = await createAgentSession({ cwd, agentDir, settingsManager, resourceLoader: loader, sessionManager: SessionManager.inMemory(cwd) }))
    await session.bindExtensions({})
    console.log(`SESSION ${JSON.stringify({ pid: process.pid, cwd, agentDir, pluginRoot, sessionId: session.sessionManager.getSessionId(), persisted: session.sessionManager.isPersisted() })}`)
    const execute = async (name, params) => {
      console.log(`CALL ${name} ${JSON.stringify(params)}`)
      const result = await session.executeTool(name, params, { signal: AbortSignal.timeout(30_000) })
      console.log(`RESULT ${name} ${JSON.stringify(result)}`)
      return result
    }
    const cell = async (code, language = "js") => {
      const result = await execute("eval", { language, code, summary: "Verify the agent toolkit SDK through the real eval kernel" })
      assert.notEqual(result.isError, true, JSON.stringify(result))
      assert.notEqual(result.details?.isError, true, JSON.stringify(result))
      if (result.details?.truncated) {
        const artifact = result.details.meta?.artifactId
        assert.ok(typeof artifact === "string" && artifact.startsWith(sandbox + "/"), JSON.stringify(result))
        const output = readFileSync(artifact, "utf8")
        console.log(`FULL_OUTPUT ${artifact}\n${output}`)
        return output
      }
      return result.content.filter(part => part.type === "text").map(part => part.text).join("\n")
    }
    const envelope = async code => {
      const text = await cell(code)
      // Eval wraps stdout in a text result. Parse the printed JSON line, not a substring match.
      const line = text.split("\n").find(line => line.trim().startsWith('{"ok":'))
      assert.ok(line, `No printed toolkit envelope: ${text}`)
      return JSON.parse(line)
    }
    const ok = result => { assert.equal(result.ok, true, JSON.stringify(result)); return result.result }
    await check(1, "catalog and removed-tool hint", async () => {
      const catalog = session.getAllTools().map(tool => tool.name)
      console.log(`CATALOG ${JSON.stringify(catalog)}`)
      assert.ok(catalog.includes("eval"))
      assert.ok(!catalog.includes("omo_agent_toolkit"))
      assert.ok(Object.hasOwn(session.agent.removedToolHints, "omo_agent_toolkit"))
      const hint = session.agent.removedToolHints.omo_agent_toolkit
      assert.match(hint, /OMO_AGENT_TOOLKIT_SDK_ROOT/)
      console.log(`REMOVED_HINT ${hint}`)
    })
    await check(2, "JS import returns the plan-missing envelope", async () => {
      const status = await envelope('const { agentToolkit } = await import(`${env("OMO_AGENT_TOOLKIT_SDK_ROOT")}/sdk.js`); print(JSON.stringify(await agentToolkit.status()))')
      assert.equal(status.ok, false)
      assert.equal(status.error.code, "ULW_LOOP_PLAN_MISSING")
    })
    await check(3, "createGoals and status round-trip", async () => {
      ok(await envelope('print(JSON.stringify(await agentToolkit.createGoals({brief:"- a\\n- b"})))'))
      const status = ok(await envelope('print(JSON.stringify(await agentToolkit.status()))'))
      assert.deepEqual(status.plan.goals.map(goal => goal.id), ["G001-a", "G002-b"])
    })
    await check(4, "real create_goal snapshot reaches the non-final checkpoint ledger", async () => {
      const objective = "QA driver objective: deliver both a and b through the eval SDK"
      const created = await execute("create_goal", { objective })
      assert.notEqual(created.isError, true)
      assert.notEqual(created.details?.isError, true)
      ok(await envelope('print(JSON.stringify(await agentToolkit.completeGoals()))'))
      const criteria = ok(await envelope('print(JSON.stringify(await agentToolkit.criteria({goalId:"G001-a"})))'))
      for (const criterion of criteria.criteria) {
        ok(await envelope(`print(JSON.stringify(await agentToolkit.recordEvidence(${JSON.stringify({ goalId: "G001-a", criterionId: criterion.id, status: "pass", evidence: "real eval QA receipt" })})))`))
      }
      ok(await envelope('print(JSON.stringify(await agentToolkit.checkpoint({goalId:"G001-a",status:"complete",evidence:"real eval QA checkpoint"})))'))
      const stateDir = join(cwd, ".omo", "ulw-loop", session.sessionManager.getSessionId())
      const entries = readFileSync(join(stateDir, "ledger.jsonl"), "utf8").trim().split("\n").map(line => JSON.parse(line))
      console.log(`LEDGER ${JSON.stringify(entries)}`)
      const checkpoint = entries.find(entry => entry.kind === "goal_completed" && entry.goalId === "G001-a")
      assert.equal(checkpoint?.codexGoal?.goal?.objective, objective)
      const status = ok(await envelope('print(JSON.stringify(await agentToolkit.status()))'))
      assert.equal(status.plan.goals[0].status, "complete")
      assert.equal(status.plan.goals[1].status, "pending")
    })
    await check(5, "Python sees the SDK root (SDK remains JS-only)", async () => {
      const python = ["python3", "python"].find(command => spawnSync(command, ["--version"], { encoding: "utf8" }).status === 0)
      if (!python) { console.log("SKIP Python: no python3 or python interpreter on PATH"); return "SKIP" }
      // The kernel value must be the SDK directory of the plugin under test, not merely non-empty.
      const sdkRoot = join(pluginRoot, "runtime", "agent-toolkit-sdk")
      assert.ok(existsSync(join(sdkRoot, "sdk.js")), sdkRoot)
      const text = await cell('print(env("OMO_AGENT_TOOLKIT_SDK_ROOT"))', "py")
      assert.ok(text.split("\n").some(line => line.trim() === sdkRoot), text)
    })
    await check(6, "removed tool throws unknown_tool", async () => {
      await assert.rejects(execute("omo_agent_toolkit", { operation: "status" }), error => error.code === "unknown_tool")
    })
    await check(7, "goal-store environment is kernel-scoped during the session", async () => {
      assert.equal(process.env.PI_GOAL_STORE_FILE, undefined)
      const text = await cell('print(JSON.stringify({goalStoreFile:env("PI_GOAL_STORE_FILE")}))')
      const line = text.split("\n").find(line => line.trim().startsWith('{"goalStoreFile":'))
      assert.ok(line, text)
      const { goalStoreFile } = JSON.parse(line)
      assert.ok(isAbsolute(goalStoreFile))
      assert.ok(goalStoreFile.startsWith(sandbox + "/"), goalStoreFile)
      assert.equal(process.env.PI_GOAL_STORE_FILE, undefined)
      console.log(`HOST_PI_GOAL_STORE_FILE=undefined KERNEL_PI_GOAL_STORE_FILE=${goalStoreFile}`)
    })
  } finally {
    if (session) {
      await session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" })
      session.dispose()
      console.log("CLEANUP session_shutdown emitted; session disposed")
    }
  }
  const passed = results.filter(result => result.status === "PASS").length
  const skipped = results.filter(result => result.status === "SKIP").length
  console.log(`${passed}/7 checks${skipped ? ` + ${skipped} explicit SKIP` : ""}`)
  return results.length === 7 && passed + skipped === 7 ? 0 : 1
}

async function supervise() {
  const evidenceDir = option("--evidence-dir", join(process.cwd(), ".omo/evidence/agent-toolkit-eval-sdk-qa"))
  mkdirSync(evidenceDir, { recursive: true })
  const transcript = join(evidenceDir, "task-9-transcript.txt")
  writeFileSync(transcript, `COMMAND ${JSON.stringify(process.argv)}\nDEADLINE_MS=${deadlineMs}\n`)
  const sandbox = mkdtempSync(join(tmpdir(), "omo-toolkit-eval-qa-"))
  for (const directory of ["agent", "project", "home", "tmp"]) mkdirSync(join(sandbox, directory))
  const { isolatedEnvironment, processGroupMembers } = await import("./agent-toolkit-eval-sdk-qa-support.mjs")
  const log = text => { appendFileSync(transcript, text); process.stdout.write(text) }
  let child
  let deadline
  let code = 1
  try {
    child = spawn(process.execPath, [script, "--worker", sandbox, "--plugin-root", pluginRoot], {
      cwd: join(sandbox, "project"), env: isolatedEnvironment(sandbox, packageRoot), detached: true, stdio: ["ignore", "pipe", "pipe"],
    })
    log(`BOOTSTRAP sandbox=${sandbox} workerPid=${child.pid}\n`)
    child.stdout.on("data", chunk => log(chunk.toString()))
    child.stderr.on("data", chunk => log(chunk.toString()))
    code = await new Promise((resolve, reject) => {
      child.once("error", reject)
      child.once("close", (exitCode, signal) => { log(`WORKER_EXIT code=${exitCode} signal=${signal}\n`); resolve(exitCode ?? 1) })
      deadline = setTimeout(() => { log("FAIL QA deadline exceeded\n"); process.kill(-child.pid, "SIGKILL") }, deadlineMs)
    })
  } finally {
    clearTimeout(deadline)
    if (child?.pid) {
      const survivors = processGroupMembers(child.pid)
      log(`CLEANUP pid-tree survivors=${JSON.stringify(survivors)}\n`)
      if (survivors.length) {
        process.kill(-child.pid, "SIGKILL")
        code = 1
        log("FAIL orphan processes required SIGKILL\n")
      }
    }
    rmSync(sandbox, { recursive: true, force: true })
    const receipt = spawnSync("ls", [sandbox], { encoding: "utf8" })
    log(`CLEANUP ls ${sandbox}: exit=${receipt.status} ${receipt.stderr}`)
    assert.ok(!existsSync(sandbox))
  }
  return code
}

try {
  process.exitCode = args.includes("--worker") ? await runSession(option("--worker")) : await supervise()
} catch (error) {
  console.error(`FAIL harness: ${error.stack ?? error}`)
  process.exitCode = 1
}
