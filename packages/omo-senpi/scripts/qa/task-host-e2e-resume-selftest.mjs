import { existsSync, mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { reattachedTaskIds, resumeReleaseStep } from "./task-host-e2e-resume-evidence.mjs"

export async function checkResumeReadbacks(root) {
  const cwd = join(root, "resume-readbacks")
  mkdirSync(join(cwd, ".omo", "senpi-task", "tasks"), { recursive: true })
  const ids = ["st_a", "st_b", "st_c", "st_d"]
  const rows = ids.map((task_id) => ({
    message: { role: "toolResult", toolName: "task_output", details: {
      kind: "status", snapshot: { task_id, parent_session_id: "parent", status: "running", residency_state: "resident" },
    } },
  }))
  for (const mutation of [
    { task_id: "foreign" }, { parent_session_id: "foreign" },
    { status: "completed" }, { residency_state: "rpc_detached" },
  ]) {
    const changed = rows.map((row) => ({ message: { ...row.message, details: {
      kind: "status", snapshot: { ...row.message.details.snapshot, ...mutation },
    } } }))
    if (reattachedTaskIds(changed, ids, "parent").length !== 0) throw new Error("invalid reattachment snapshot accepted")
  }
  const session = join(cwd, "parent.jsonl")
  for (const id of ids) {
    writeFileSync(join(cwd, ".omo", "senpi-task", "tasks", `${id}.json`), JSON.stringify({ status: "completed" }))
  }
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
  const execute = new AsyncFunction(resumeReleaseStep(session, ids, "parent", 0).arguments.code)
  const previousCwd = process.cwd()
  try {
    process.chdir(cwd)
    writeFileSync(session, ids.map(() => JSON.stringify({
      message: { role: "toolResult", toolName: "task_output", isError: true, details: { kind: "error" } },
    })).join("\n") + "\n")
    let failure
    try { await execute() } catch (error) { failure = error }
    if (failure?.code !== "QA_REATTACH_READBACK" || existsSync(join(cwd, ".omo", "resume-release"))) {
      throw new Error("failed readbacks must prevent release even when all child records already say completed")
    }
    writeFileSync(session, rows.map(JSON.stringify).join("\n") + "\n")
    await execute()
    if (!existsSync(join(cwd, ".omo", "resume-release"))) throw new Error("four valid readbacks must allow release")
  } finally {
    process.chdir(previousCwd)
  }
}
