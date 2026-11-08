import { createHash } from "node:crypto"
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, writeSync } from "node:fs"
import { dirname, join, relative } from "node:path"

export const SESSION_A = "00000000-0000-4000-8000-00000000000a"
export const SESSION_B = "00000000-0000-4000-8000-00000000000b"
const AT = "2026-09-06T00:00:00.000Z"

export function seedRun(stateDir, runId, owner, holder) {
  const prompt = "Synthetic already-completed work; no child execution required."
  const definition = { key: runId, name: runId, nodes: [{ id: "done", prompt, effectivePrompt: prompt, category: "quick" }] }
  const record = {
    schemaVersion: 1, checkpointSeq: 0, runId, runKey: runId, name: runId,
    parentSessionId: owner, rootSessionId: owner, definitionFingerprint: "synthetic-settled-fixture",
    definition, status: "paused", generation: 1, createdAt: AT, updatedAt: AT,
    nodes: [{ id: "done", prompt, route: { kind: "category", category: "quick" }, dependsOn: [],
      state: "completed", attempt: 1, createdAt: AT, completedAt: AT }],
    edges: [], waves: [{ index: 0, nodeIds: ["done"] }], criticalPath: ["done"], bottlenecks: [], diagnostics: [],
    ...(holder === undefined ? {} : { previousLeaseHolderPid: holder }),
  }
  for (const [path, body] of [
    [join(stateDir, "dag", "runs", `${runId}.json`), JSON.stringify(record)],
    [join(stateDir, "dag", "events", `${runId}.jsonl`), ""],
    [join(stateDir, "dag", "results", runId, "done.txt"), "SYNTHETIC_COMPLETED_OUTPUT\n"],
  ]) {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, body)
  }
  return record
}

// Snapshot keys are the contract evaluate() matches against (`dag/runs/<id>.json`, ...), so they
// must be posix-separated on every platform; node:path.relative yields backslashes on Windows.
// The state tree is synthetic and never contains a backslash in a file name, so both separators fold.
export function toPosixKey(relativePath) {
  return relativePath.split(/[\\/]+/).join("/")
}

export function snapshot(stateDir) {
  const files = {}
  function visit(dir) {
    if (!existsSync(dir)) return
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) visit(path)
      else if (entry.isFile()) files[toPosixKey(relative(stateDir, path))] = createHash("sha256").update(readFileSync(path)).digest("hex")
    }
  }
  visit(stateDir)
  const runsDir = join(stateDir, "dag", "runs")
  const runs = existsSync(runsDir) ? readdirSync(runsDir).filter((name) => name.endsWith(".json"))
    .map((name) => JSON.parse(readFileSync(join(runsDir, name), "utf8"))) : []
  const events = Object.fromEntries(runs.map((run) => {
    const path = join(stateDir, "dag", "events", `${run.runId}.jsonl`)
    return [run.runId, existsSync(path) ? readFileSync(path, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line)) : []]
  }))
  return { files, runs, events }
}

// Only seed data and observe events. The shipped task component owns all recovery.
export async function registerFixture(pi, createTaskComponent) {
  const config = JSON.parse(process.env.OMO_DAG_SCOPE_FIXTURE)
  const emit = (value) => appendFileSync(config.receipt, `${JSON.stringify(value)}\n`)
  let before
  pi.on("session_start", (event, ctx) => {
    const current = ctx.sessionManager.getSessionId()
    const phase = event.reason === "fork" ? "fork" : config.phase
    const ids = []
    const seed = (id, owner, holder) => { seedRun(config.stateDir, id, owner, holder); ids.push(id) }
    if (phase === "unrelated") {
      seed("a-dead", SESSION_A, config.deadPid)
      seed("a-self", SESSION_A, process.pid)
      seed("a-live", SESSION_A, config.livePid)
      seed("a-missing", SESSION_A)
      seed("b-own", current, config.deadPid)
    } else if (phase === "control") {
      seed("b-own", current, config.deadPid)
    } else if (phase === "fork") {
      const source = JSON.parse(readFileSync(event.previousSessionFile, "utf8").split("\n")[0]).id
      seed("source-dead", source, config.deadPid)
      seed("source-self", source, process.pid)
      seed("source-live", source, config.livePid)
      seed("b-unrelated", SESSION_B, config.deadPid)
      seed("c-own", current, config.deadPid)
    } else if (phase === "reopen") {
      seed("a-leftover", SESSION_A, config.deadPid)
      seed("c-reopen-own", current, config.deadPid)
    }
    const state = snapshot(config.stateDir)
    before = { phase, event, current, ids: state.runs.map((run) => run.runId), seededIds: ids, state }
    emit({ kind: "before", ...before })
  })
  const logger = Object.fromEntries(["info", "warn", "error", "debug"].map((level) =>
    [level, (...args) => emit({ kind: "log", level, args })]))
  await createTaskComponent().register(pi, { logger })
  pi.on("session_start", () => {
    emit({ kind: "after", phase: before.phase, state: snapshot(config.stateDir) })
    // RPC replacement responses precede deferred binding; signal only after the real hook settles.
    if (config.readyFd !== undefined) writeSync(config.readyFd, `${JSON.stringify({ type: "qa_scope_ready", phase: before.phase })}\n`)
  })
  pi.registerCommand("qa-owner-ready", {
    description: "Local synthetic DAG scope QA readiness check",
    handler: async (_args, ctx) => ctx.ui.notify(`QA_OWNER_READY ${ctx.sessionManager.getSessionId()}`, "info"),
  })
}
