#!/usr/bin/env bun
// Real-surface QA for the shipped omo_agent_toolkit tool: it loads the BUILT extension bundle,
// registers it through a host stub that mirrors the Senpi ExtensionAPI, and then calls the tool the
// way the host calls every tool - execute(toolCallId, params, signal, onUpdate, ctx). This exercises
// the packaged artifact and its lazy "#omo-agent-toolkit-runtime" resolution, not the TypeScript
// sources, which is where a bundle or import-map regression would actually bite.
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const scriptDir = dirname(fileURLToPath(import.meta.url))
const packageRoot = join(scriptDir, "..", "..")
const bundlePath = join(packageRoot, "plugin", "extensions", "omo.js")

const results = []
function record(name, ok, detail) {
  results.push({ name, ok, detail })
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail === undefined ? "" : ` - ${detail}`}`)
}

class HostStub {
  constructor() {
    this.tools = []
    this.handlers = new Map()
    this.flags = new Map()
    this.messages = []
  }
  on(event, handler) {
    const list = this.handlers.get(event) ?? []
    list.push(handler)
    this.handlers.set(event, list)
  }
  registerFlag(name, options) { this.flags.set(name, options?.default ?? false) }
  getFlag(name) { return this.flags.get(name) ?? false }
  registerTool(tool) { this.tools.push(tool) }
  registerCommand() {}
  sendMessage(message) { this.messages.push(message) }
  sendUserMessage() {}
  getAllTools() { return this.tools }
}

async function main() {
  if (!existsSync(bundlePath)) {
    record("built bundle exists", false, bundlePath)
    return finish()
  }
  const bundle = await import(bundlePath)
  const compose = bundle.composeOmoSenpiExtension ?? bundle.default
  if (typeof compose !== "function") {
    record("bundle exposes composeOmoSenpiExtension", false, typeof compose)
    return finish()
  }

  const pi = new HostStub()
  const activate = compose(bundle.omoSenpiComponents ?? [], { logger: { info() {}, warn() {}, error() {} } })
  await activate(pi)

  const tool = pi.getAllTools().find((candidate) => candidate.name === "omo_agent_toolkit")
  record("omo_agent_toolkit is registered on the host catalog", tool !== undefined)
  if (tool === undefined) return finish()

  const operations = tool.parameters?.properties?.operation?.anyOf?.map((member) => member.const) ?? []
  record("schema advertises the ten operations", operations.length === 10, operations.join(","))
  record("tool carries a label for the host UI", typeof tool.label === "string" && tool.label.length > 0)

  const cwd = mkdtempSync(join(tmpdir(), "omo-toolkit-eval-qa-"))
  const sessionId = "eval-qa-session"
  // The tool resolves cwd/session from the host event context; drive the same events the host fires.
  for (const handler of pi.handlers.get("session_start") ?? []) {
    await handler({}, { cwd, sessionManager: { getSessionId: () => sessionId } })
  }

  const call = async (params) => tool.execute("qa-call", params, undefined, undefined, {})
  const details = (result) => result?.details ?? result

  try {
    const help = details(await call({ operation: "help" }))
    record("help returns the manifest", help?.ok === true && help.result?.operations?.length === 10)

    const created = details(await call({ operation: "create-goals", brief: "- QA alpha goal\n- QA beta goal" }))
    record("create-goals seeds this session's plan", created?.ok === true)

    const status = details(await call({ operation: "status" }))
    const goalCount = status?.result?.plan?.goals?.length ?? 0
    record("status reads the session plan", status?.ok === true && goalCount >= 1, `goals=${goalCount}`)

    const criteria = details(await call({ operation: "criteria", goalId: "G001-qa-alpha-goal" }))
    record("criteria lists the first goal's criteria", criteria?.ok === true)

    const template = details(await call({ operation: "checkpoint", printTemplate: true, goalId: "G001-qa-alpha-goal" }))
    const gateBy = template?.result?.qualityGateTemplate?.gateReview?.by
    record("checkpoint printTemplate resolves omo-senpi reviewer roles", gateBy === "category:deep", String(gateBy))

    const missing = details(await call({ operation: "record-evidence", goalId: "nope", criterionId: "c1", status: "pass", evidence: "x" }))
    record("unknown goal returns ULW_LOOP_GOAL_NOT_FOUND", missing?.ok === false && missing.error?.code === "ULW_LOOP_GOAL_NOT_FOUND", missing?.error?.code)

    const badOperation = details(await call({ operation: "hook-user-prompt-submit" }))
    record("hook-style operation is rejected", badOperation?.ok === false, badOperation?.error?.code)

    // The early-update_goal scenario: the session goal store says the driver is already complete
    // while the plan still has open goals. The checkpoint must still succeed and advise re-creating
    // the driver rather than recording the delivered work as blocked.
    const goalStoreDir = join(cwd, ".omo", "goal")
    mkdirSync(goalStoreDir, { recursive: true })
    writeFileSync(
      join(goalStoreDir, `${encodeURIComponent(sessionId)}.json`),
      JSON.stringify({ version: 1, goal: { objective: "closed too early", status: "complete" } }),
    )
    const criteriaIds = (details(await call({ operation: "criteria", goalId: "G001-qa-alpha-goal" })))?.result?.criteria ?? []
    for (const criterion of criteriaIds) {
      await call({ operation: "record-evidence", goalId: "G001-qa-alpha-goal", criterionId: criterion.id, status: "pass", evidence: "eval QA proof" })
    }
    const closed = details(await call({ operation: "checkpoint", goalId: "G001-qa-alpha-goal", status: "complete", evidence: "eval QA checkpoint" }))
    const advice = (closed?.nextActions ?? []).join(" ")
    record("early-complete driver still completes the goal", closed?.ok === true, closed?.error?.code)
    record("early-complete driver advises re-creating the driver goal", advice.includes("create_goal"), advice.slice(0, 80))

    const planPath = join(cwd, ".omo", "ulw-loop", sessionId, "goals.json")
    record("state landed under the session-scoped plan dir", existsSync(planPath), planPath)

    // The steering reminder the component injects must name the tool, never a CLI.
    const reminderSources = pi.messages.map((message) => JSON.stringify(message)).join("\n")
    record("no CLI instruction leaked into host messages", !reminderSources.includes("omo-agent-toolkit ulw-loop") && !reminderSources.includes("cli.js"))
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
  finish()
}

function finish() {
  const failed = results.filter((entry) => !entry.ok)
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
  process.exit(failed.length === 0 ? 0 : 1)
}

await main()
