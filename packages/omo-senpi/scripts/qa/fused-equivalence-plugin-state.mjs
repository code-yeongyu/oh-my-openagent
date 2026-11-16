// O5 for the plugin's durable state outside the work dir (EQ.omo, fused-equivalence-e2e.mjs). The harness's O5 tree
// covers the session's work dir only, while a plugin tool's effect can land in the stores the plugin owns under the
// case sandbox: the task engine's records (`<agent dir>/projects/<project>/senpi-task/tasks/<task id>.json`) and the
// memory repos (`$OMO_MEMORY_HOME/agents/<identity>/...`). Both are read after the run and compared like the work tree.
//
// Left out on purpose: each memory repo's `.git/` (object ids hash commit times; the commit sha the tool reports is
// compared through its notice) and `runtime/` (queue cursors, locks and the transcript mirror, named by wall clock and
// random suffixes; the transcript itself is O7). Task logs and child sessions are left out for the same reason.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative, sep } from "node:path"

const TEXT_LIMIT = 8192
const MEMORY_SKIPPED = new Set([".git", "runtime"])

function fileContent(bytes) {
  const text = bytes.toString("utf8")
  return bytes.length <= TEXT_LIMIT && Buffer.from(text, "utf8").equals(bytes) ? { text } : { bytes: bytes.length }
}

function files(root, skipped) {
  const out = {}
  const walk = (dir) => {
    for (const name of readdirSync(dir).sort()) {
      if (skipped.has(name)) continue
      const full = join(dir, name)
      if (statSync(full).isDirectory()) walk(full)
      else out[relative(root, full).split(sep).join("/")] = fileContent(readFileSync(full))
    }
  }
  if (existsSync(root)) walk(root)
  return out
}

const subdirs = (dir) =>
  existsSync(dir)
    ? readdirSync(dir)
        .filter((name) => statSync(join(dir, name)).isDirectory())
        .sort()
    : []

/** Every memory identity's files, the identity under its own key so the driver's id map tokenizes it. */
function memoryState(memoryHome) {
  const agents = join(memoryHome, "agents")
  return subdirs(agents).map((identity) => ({ identity, files: files(join(agents, identity), MEMORY_SKIPPED) }))
}

/** Every task record the task engine persisted, in task id order. */
function taskRecords(agentDir) {
  const projects = join(agentDir, "projects")
  return subdirs(projects).flatMap((project) => {
    const tasks = join(projects, project, "senpi-task", "tasks")
    if (!existsSync(tasks)) return []
    return readdirSync(tasks)
      .filter((name) => name.endsWith(".json"))
      .sort()
      .map((name) => JSON.parse(readFileSync(join(tasks, name), "utf8")))
  })
}

export function collectPluginState(run) {
  return { memory: memoryState(run.env.OMO_MEMORY_HOME), tasks: taskRecords(run.box.agentDir) }
}
