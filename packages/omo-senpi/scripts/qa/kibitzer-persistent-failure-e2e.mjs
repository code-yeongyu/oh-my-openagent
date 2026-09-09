#!/usr/bin/env bun
import { execFileSync } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, rmSync, watch, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { startMockCompletionsServer } from "./mock-completions-server.mjs"
import {
  assertSandboxEnv, createRouter, getState, identityDirs, launchRpc, parseArgs,
  prepareSandbox, prompt, readEntries, sandboxEnv, seedMemoryRepo, teardown, writeOmoConfig,
} from "./kibitzer-e2e-support.mjs"

const options = parseArgs(process.argv.slice(2))
const words = ["violetdeployment", "amberbackups", "ceruleanrotation", "magentalimits",
  "crimsonrestore", "indigoretention", "vermilionquotas", "emeraldvalidation"]
const outage = { type: "error", status: 400, body: { error: { message: "mock judge configuration unavailable" } } }
const judgeSteps = [outage]
const router = createRouter({ judgeSteps })
const server = startMockCompletionsServer({ steps: router.steps })
const sandbox = prepareSandbox(options.pluginRoot, await server.ready)
const env = sandboxEnv(sandbox)
assertSandboxEnv(sandbox, env)
const checks = []
const cleanup = []
let session

function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  checks.push({ name, ok, actual, expected })
  console.log(`${ok ? "PASS" : "FAIL"} ${name}: ${JSON.stringify(actual)}`)
  if (!ok) throw new Error(`${name}: expected ${JSON.stringify(expected)}`)
}

function observe(directory, predicate, description) {
  let stop
  const promise = new Promise((resolve, reject) => {
    let watcher
    const timer = setTimeout(() => {
      watcher.close()
      reject(new Error(`Timed out waiting for ${description}`))
    }, 90000)
    stop = () => { clearTimeout(timer); watcher.close() }
    const inspect = () => {
      try {
        const result = predicate()
        if (result !== undefined) { stop(); resolve(result) }
      } catch (error) { stop(); reject(error) }
    }
    watcher = watch(directory, { recursive: true }, inspect)
    inspect()
  })
  return { promise, stop: () => stop() }
}

try {
  const seeded = await seedMemoryRepo(options, sandbox, env, router)
  if (seeded.status !== 0) throw new Error(seeded.stderr)
  const [identity] = identityDirs(sandbox.memoryHome)
  if (identity === undefined) throw new Error("Memory identity was not seeded")
  const repo = join(identity, "repo")
  for (const word of words) {
    writeFileSync(join(repo, "reference", `${word}.md`),
      `---\ndescription: ${word} configuration rule\n---\n\nUse ${word} for this operation.\n`)
  }
  execFileSync("git", ["add", "reference"], { cwd: repo, env })
  execFileSync("git", ["-c", "user.name=QA", "-c", "user.email=qa@example.invalid",
    "commit", "-m", "Seed distinct recall candidate sets"], { cwd: repo, env })
  writeOmoConfig(sandbox, true)
  router.setParentSteps(words.map(() => ({ type: "text", text: "Checked." })))
  session = launchRpc(options.senpiCli, sandbox, env)
  const state = await getState(session)
  if (typeof state.sessionFile !== "string") throw new Error("Session file missing")
  const gates = () => readEntries(state.sessionFile).filter((entry) => entry.customType === "omo-kibitzer:gate")
  const notices = () => gates().filter((entry) => entry.data?.consecutiveFailures !== undefined)
  let failures = 0
  for (let index = 0; index < words.length; index += 1) {
    const success = index === 4
    judgeSteps.splice(0, judgeSteps.length, success ? { type: "text", text: "" } : outage)
    const expectedFailures = failures + (success ? 0 : 1)
    const beforeRequests = router.state.judge
    const runRoot = join(identity, "runtime", "recall", "runs")
    mkdirSync(runRoot, { recursive: true })
    const observation = observe(success ? runRoot : dirname(state.sessionFile), () => {
      if (!success) return gates().length >= expectedFailures ? true : undefined
      if (router.state.judge <= beforeRequests) return undefined
      const entries = readEntries(state.sessionFile)
      // Successful completion is followed by a request/response barrier below. The run artifact
      // is the worker's completion signal; file events are subscribed before triggering it.
      return entries.length > 0 && Array.from(new Bun.Glob("*/outcome.json").scanSync(runRoot))
        .some((file) => {
          const outcome = JSON.parse(readFileSync(join(runRoot, file), "utf8"))
          return outcome.status === "completed"
        }) ? true : undefined
    }, `${words[index]} judge settlement`)
    try {
      await prompt(session, `Explain the ${words[index]} rule.`)
      await observation.promise
      await getState(session)
    } finally { observation.stop() }
    failures = expectedFailures
    const expectedNotices = index < 2 ? 0 : index === 7 ? 2 : 1
    check(`turn-${index + 1}.diagnostic-record-count`, gates().length, failures)
    check(`turn-${index + 1}.notification-count`, notices().length, expectedNotices)
  }
  check("notification-thresholds", notices().map((entry) => entry.data.consecutiveFailures), [3, 3])
  check("mock-provider-exercised", router.state.judge > 0, true)
} finally {
  if (session !== undefined) cleanup.push(await teardown(session))
  server.close()
  cleanup.push("server closed")
  rmSync(sandbox.root, { recursive: true, force: true })
  cleanup.push(existsSync(sandbox.root) ? "sandbox remains" : "sandbox removed")
  const payload = { ok: checks.length === 18 && checks.every((entry) => entry.ok),
    checks, cleanup, sandboxRoot: sandbox.root }
  if (options.evidenceDir !== undefined) {
    mkdirSync(options.evidenceDir, { recursive: true })
    writeFileSync(join(options.evidenceDir, "kibitzer-persistent-failure-e2e.json"),
      JSON.stringify(payload, null, 2) + "\n")
  }
  console.log(JSON.stringify(payload))
}
