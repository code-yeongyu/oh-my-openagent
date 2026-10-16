import { createHash } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { childSessionFiles, jsonlLines } from "./task-host-e2e-support.mjs"
import {
  childRequests,
  endpointSockets,
  hostStatus,
  processTable,
  shardOwners,
  statusAll,
  supervisorPid,
  taskConfig,
  taskRecords,
  treePids,
} from "./task-host-e2e-shard-cost-support.mjs"

export const REATTACH_TAG = "[host-session-reattach]"
export const CHILDREN_PER_PARENT = 3

export function heldSteps(releasePath, label) {
  return [
    {
      type: "tool_call",
      name: "eval",
      arguments: {
        language: "js",
        summary: `hold ${label} mid-turn until the driver releases it`,
        timeout: 660,
        code: `var fs = await import("node:fs"); await new Promise((resolve, reject) => {
          var finish = () => { if (!fs.existsSync(${JSON.stringify(releasePath)})) return;
            clearTimeout(timer); watcher.close(); resolve(); };
          var watcher = fs.watch(${JSON.stringify(join(releasePath, ".."))}, finish);
          var timer = setTimeout(() => { watcher.close(); reject(new Error("release missing")); }, 600000);
          finish();
        });`,
      },
    },
    { type: "text", text: `${label} complete` },
  ]
}

// `readNotices` adds one `task_output` read after the hold: its status view carries the parent's
// session notice list (`note: <line>`), the surface the crash notice is announced on.
export function parentSteps(routeDir, prefix, { readNotices = false } = {}) {
  const marker = `[[mock-cwd:${routeDir}]]`
  return [
    ...Array.from({ length: CHILDREN_PER_PARENT }, (_, index) => ({
      type: "tool_call",
      name: "task",
      arguments: {
        category: "proc",
        run_in_background: true,
        name: `${prefix}${index}`,
        prompt: `${prefix} child ${index} ${marker}`,
      },
    })),
    {
      type: "tool_call",
      name: "eval",
      arguments: {
        language: "js",
        summary: `hold parent ${prefix} until fault evidence is captured`,
        timeout: 660,
        code: `var fs = await import("node:fs"); await new Promise((resolve, reject) => {
          var path = ".omo/parent-${prefix}-release";
          var finish = () => { if (!fs.existsSync(path)) return; clearTimeout(timer); watcher.close(); resolve(); };
          var watcher = fs.watch(".omo", finish);
          var timer = setTimeout(() => { watcher.close(); reject(new Error("parent release missing")); }, 600000);
          finish();
        });`,
      },
    },
    ...(readNotices ? [{ type: "tool_call", name: "task_output", arguments: { name: `${prefix}0` } }] : []),
    { type: "text", text: `${prefix} parent complete` },
  ]
}

// The `note:` lines of the parent's `task_output` result in its JSON event stream; undefined until
// the read has finished.
export function parentNoticeLines(parent) {
  const read = parent.events.find((entry) =>
    entry.event.type === "tool_execution_end" && entry.event.toolName === "task_output")
  if (read === undefined) return undefined
  return (read.event.result?.content ?? [])
    .filter((part) => part.type === "text")
    .flatMap((part) => part.text.split("\n"))
    .filter((line) => line.startsWith("note: "))
    .map((line) => line.slice("note: ".length))
}

export function writeRoute(sandbox, name, script) {
  const root = join(sandbox.root, `route-${name}`)
  mkdirSync(join(root, ".omo"), { recursive: true })
  writeFileSync(join(root, "mock-script.json"), `${JSON.stringify(script, null, 2)}\n`)
  return root
}

export function shardConfig() {
  return taskConfig({ default_execution_mode: "process", process_runner: "host", max_depth: 4 })
}

export function recordsByParent(project) {
  return Map.groupBy(taskRecords(project), (record) => record.parent_session_id)
}

export function endpointFacts(sandbox) {
  const table = processTable()
  const owners = shardOwners(sandbox)
  return endpointSockets(sandbox).map((socket) => {
    const supervisor = supervisorPid(sandbox, socket)
    const pids = supervisor === undefined ? [] : treePids(supervisor, table)
    const host = pids.find((pid) => table.get(pid)?.args.includes("--mode rpc"))
    return {
      socket,
      inode: existsSync(socket) ? statSync(socket).ino : null,
      owner: owners[socket] ?? null,
      supervisor: supervisor ?? null,
      host: host ?? null,
      hostPpid: host === undefined ? null : table.get(host)?.ppid ?? null,
      status: hostStatus(sandbox, socket).json,
    }
  })
}

export function generationNames(sandbox, socket) {
  const dir = join(
    sandbox.agentDir,
    "rpc-host-daemon",
    createHash("sha256").update(socket).digest("hex").slice(0, 16),
    "generations",
  )
  return existsSync(dir) ? readdirSync(dir).sort() : []
}

export function crashRows(sandbox, socket) {
  const dir = join(sandbox.agentDir, "rpc-host-daemon", createHash("sha256").update(socket).digest("hex").slice(0, 16))
  const path = join(dir, "crashes.jsonl")
  return existsSync(path) ? readFileSync(path, "utf8").split("\n").filter(Boolean).map(JSON.parse) : []
}

export function continuationCount(sandbox, taskId) {
  return childSessionFiles(sandbox, taskId)
    .flatMap(jsonlLines)
    .filter((line) => line.includes(REATTACH_TAG)).length
}

export function requestCount(project) {
  return childRequests(project).length
}

export function statusWorkers(sandbox) {
  return statusAll(sandbox).endpoints.map((row) => ({
    socket: row.socket,
    workers: row.sessions?.worker ?? 0,
    crashes: row.crashes ?? 0,
    instanceId: row.instanceId ?? row.instance_id ?? null,
  }))
}

export function pass(evidence, facts = {}) {
  return { status: "pass", evidence, facts }
}

export function fail(reason, evidence = [], facts = {}) {
  return { status: "fail", reason, evidence, facts }
}
