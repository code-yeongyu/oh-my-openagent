// Shared fixtures and readers for the task-host-e2e scenarios (todo 41): the sandbox omo.json every
// daemon scenario uses, the mock scripts that keep a child mid-turn or let it finish, and the readers
// that turn a child's session JSONL and the task store into scenario facts.
import { existsSync, readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { failedChildEvidence } from "./task-host-e2e-audit.mjs"

export const CHILD_PROMPT = "do the host child work and report"
const FAILURE_TOKENS = ["too_many_sessions", "host_unavailable"]

/** No `default_execution_mode`: `auto` must resolve to daemon sessions on its own (scenario I). */
export function hostConfig(overrides = {}) {
  return {
    task: { global_concurrency: 16, residency_max_children: 16, ...(overrides.task ?? {}) },
    team: { max_members: 8 },
    categories: { proc: { description: "Daemon-hosted mock category.", model: "omo-mock/mock-1" } },
    ...(overrides.extra ?? {}),
  }
}

export function spawnScript(count, childSteps, prefix = "c") {
  const parentSteps = []
  for (let index = 0; index < count; index += 1) {
    parentSteps.push({
      type: "tool_call",
      name: "task",
      arguments: { category: "proc", run_in_background: true, name: `${prefix}${index}`, prompt: CHILD_PROMPT },
    })
  }
  parentSteps.push({ type: "text", text: "parent fan-out complete" })
  return { parentSteps, childSteps }
}

// Print-mode turn settlement can cancel work before the observer sees it. Keep the test's
// parent turn open until the driver has captured its fact and explicitly kills that parent.
export function holdParent(script) {
  script.parentSteps.splice(-1, 0, {
    type: "tool_call", name: "eval", arguments: {
      language: "js", summary: "keep the QA parent active until observation completes", timeout: 1_200,
      code: `var fs = await import("node:fs"); await new Promise((resolve, reject) => {
        var finish = () => { if (!fs.existsSync(".omo/parent-release")) return;
          clearTimeout(timer); watcher.close(); resolve(); };
        var watcher = fs.watch(".omo", finish);
        var timer = setTimeout(() => { watcher.close(); reject(new Error("parent release missing")); }, 1200000);
        finish();
      });`,
    },
  })
  return script
}

/**
 * A child that stays mid-turn: the last scripted step repeats forever, so every provider call issues
 * another short bash sleep and the child's transcript keeps growing while it is never terminal.
 */
// A busy child must (1) keep working across the parent's exit, so B can see its transcript grow
// after the parent is gone, and (2) FINISH, so its session is retained on the host and A's
// session count can reach 32 while concurrency stays at the configured 16. A step that never
// terminates holds its slot forever and starves the other children out of ever opening.
//
// The tool has to be one the child can COMPLETE on this engine: `bash` is eval-only here (a
// direct call is refused instantly, and since the mock repeats its last step, the child spun at
// 100% of the host loop and starved every other open), and `eval` aborts at startup in a
// mock-provider child. `read` completes; the mock's delayMs supplies the time `sleep 2` used to.
export const CHILD_BUSY = [
	...Array.from({ length: 2 }, () => ({
		type: "tool_call",
		name: "read",
		// NOT mock-script.json: it carries the prompts, so every tool result would echo the child's
		// own prompt and B would read its own fixture as a prompt replay.
		arguments: { path: ".omo/omo.json" },
		// Long enough that a child is still mid-turn when B kills the parent. It does NOT guarantee
		// that all 32 of A's children open inside any particular observe budget: on a loaded machine
		// they keep opening for minutes, which is why A observes with its own larger budget and
		// `TASK_HOST_E2E_OBSERVE_MS` exists.
		delayMs: 1_000,
	})),
	{ type: "text", text: "host child mock work complete" },
]

export const CHILD_DONE = [{ type: "text", text: "host child mock work complete" }]

export const TERMINAL_STATUSES = new Set(["completed", "error", "lost", "cancelled"])

/**
 * A poll must stop when the answer can no longer change: once every expected child has reached a
 * terminal status, waiting for a live session count is waiting for something that will never happen.
 */
export function childrenSettled(records, count) {
  return records.length >= count && records.every((record) => TERMINAL_STATUSES.has(record.status))
}

// The engine keeps a child's sessions under children/<id>/sessions/<id>/; the flat
// sessions/<id>/ layout is older. Reading only the flat one counted 0 transcripts against a
// child that had written thousands of lines, and every transcript assertion was blind to it.
export function childSessionFiles(sandbox, taskId) {
  const dirs = [
    join(sandbox.stateDir, "children", taskId, "sessions", taskId),
    join(sandbox.stateDir, "sessions", taskId),
  ]
  return dirs.flatMap((dir) =>
    existsSync(dir) ? readdirSync(dir).filter((file) => file.endsWith(".jsonl")).map((file) => join(dir, file)) : [])
}

export function jsonlLines(path) {
  if (!existsSync(path)) return []
  return readFileSync(path, "utf8").split("\n").filter((line) => line.trim().length > 0)
}

export function toolDetails(stdout, name) {
  return stdout.split("\n").flatMap((line) => {
    let event
    try { event = JSON.parse(line) } catch { return [] }
    return event.type === "tool_execution_end" && event.toolName === name && !event.isError
      ? [event.result?.details].filter(Boolean) : []
  })
}

export function transcriptSizes(sandbox, records) {
  return Object.fromEntries(records.map((record) => [
    record.task_id,
    childSessionFiles(sandbox, record.task_id).reduce((total, file) => total + jsonlLines(file).length, 0),
  ]))
}

export function failureTokens(text) {
  return FAILURE_TOKENS.filter((token) => text.includes(token))
}

export function recordFailureTokens(records) {
  return failureTokens(records.map((record) => `${record.error_message ?? ""}`).join(" "))
}

/**
 * The shared child-start probe. Every daemon scenario depends on `open_session` succeeding, so when a
 * child cannot start the scenario says so with the store's own failure kind instead of reporting a
 * downstream symptom.
 */
export function childStartDiagnosis(sandbox, records) {
  const failed = records.filter((record) => record.status === "error")
  const sessionsDir = [join(sandbox.stateDir, "children"), join(sandbox.stateDir, "sessions")].find((dir) => existsSync(dir))
  return {
    total: records.length,
    running: records.filter((record) => record.status === "running").length,
    completed: records.filter((record) => record.status === "completed").length,
    errored: failed.length,
    errorMessages: [...new Set(failed.map((record) => record.error_message))].slice(0, 3),
    failedRecords: failedChildEvidence(sandbox, records),
    childSessionsDirExists: sessionsDir !== undefined,
    executionModes: [...new Set(records.map((record) => record.execution_mode))],
  }
}

