#!/usr/bin/env node
// Shared mechanics for the quit->resume live QA lanes (task-resume-e2e.mjs; team-resume-e2e.mjs
// reuses the waits/polls). A run exits NATURALLY when its scripted turns settle: print mode's
// finally disposes the runtime, which emits session_shutdown reason "quit" - the graceful quit
// under test. kill() is only a backstop for a wedged run. No timing sleeps: every wait polls a
// condition on the store/session files, and the AGENT-side bash waits block on driver-written
// sentinel files so the driver alone decides when a run may finish.
import { spawn } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { seedSandbox } from "./drive.mjs"

export function seedResumeProject(sandbox, omoConfig) {
  seedSandbox(sandbox)
  const omoDir = join(sandbox.cwd, ".omo")
  mkdirSync(omoDir, { recursive: true })
  writeFileSync(join(omoDir, "omo.json"), `${JSON.stringify(omoConfig, null, 2)}\n`)
}

export function startResumeRun(input) {
  writeFileSync(join(input.sandbox.cwd, "mock-script.json"), `${JSON.stringify(input.script, null, 2)}\n`)
  const sessionDir = join(input.sandbox.root, "sessions")
  mkdirSync(sessionDir, { recursive: true })
  const args = [
    "-e", input.mockProviderEntry,
    "-p", "--mode", "json",
    "--provider", "omo-mock", "--model", "mock-1",
    "--session-dir", sessionDir,
    ...(input.sessionId === undefined ? [] : ["--session-id", input.sessionId]),
    input.prompt ?? "drive the quit-resume scenario",
  ]
  const child = spawn(input.senpiBin, args, {
    cwd: input.sandbox.cwd,
    env: {
      ...process.env,
      SENPI_CODING_AGENT_DIR: input.sandbox.agentDir,
      XDG_CONFIG_HOME: input.sandbox.xdgConfigHome,
      // Same HOME isolation as the team runtime: the omo user-scope config resolves from HOME.
      ...(input.sandbox.homeDir === undefined ? {} : { HOME: input.sandbox.homeDir, USERPROFILE: input.sandbox.homeDir }),
      SENPI_CODING_AGENT_SESSION_DIR: sessionDir,
      OMO_SENPI_QA: "1",
      ...(input.extraEnv ?? {}),
    },
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  })
  if (typeof child.pid === "number") input.onPid?.(child.pid)
  let stdout = ""
  let stderr = ""
  let settled = false
  let finish = () => undefined
  const completion = new Promise((resolve) => { finish = resolve })
  const settle = (status) => {
    if (settled) return
    settled = true
    clearTimeout(hardTimer)
    finish({ status, stdout, stderr, events: parseEvents(stdout) })
  }
  const hardTimer = setTimeout(() => {
    killGroup(child.pid)
    settle(null)
  }, 90_000)
  child.stdout.on("data", (chunk) => { stdout += chunk })
  child.stderr.on("data", (chunk) => { stderr += chunk })
  child.on("close", (status) => {
    if (typeof child.pid === "number") input.onClose?.(child.pid)
    settle(status)
  })
  child.on("error", () => settle(null))
  return { pid: child.pid, completion, kill: () => killGroup(child.pid) }
}

function killGroup(pid) {
  if (typeof pid !== "number") return
  try {
    process.kill(-pid, "SIGKILL")
  } catch {
    try {
      process.kill(pid, "SIGKILL")
    } catch {
      // already gone
    }
  }
}

export function parseEvents(stdout) {
  const events = []
  for (const line of String(stdout).split(/\r?\n/)) {
    if (line.trim().length === 0) continue
    try {
      events.push(JSON.parse(line))
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error
    }
  }
  return events
}

export async function pollUntil(readValue, accepted, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  let value = await readValue()
  while (!accepted(value) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, Math.min(50, Math.max(1, deadline - Date.now()))))
    value = await readValue()
  }
  return value
}

// AGENT-side bash command blocking until the driver writes `path` (bounded; exits 1 on the bound
// so a wedged drive fails the scenario instead of hanging the run).
export function waitForFileCommand(path) {
  const script = `const fs=require('fs');const p=process.argv[1];const until=Date.now()+60000;(function poll(){if(fs.existsSync(p))process.exit(0);if(Date.now()>until){console.error('timed out waiting for '+p);process.exit(1)}setTimeout(poll,50)})()`
  return `node -e "${script}" ${JSON.stringify(path)}`
}

// AGENT-side bash command blocking until a store record named `name` reaches `status` (the LRU
// lane uses it to guarantee the first child is a terminal idle resident before the second spawn).
export function waitForRecordStatusCommand(cwd, name, status) {
  const dir = join(taskStateDir(cwd), "tasks")
  const script = `const fs=require('fs'),path=require('path');const dir=process.argv[1],name=process.argv[2],want=process.argv[3];const until=Date.now()+60000;function hit(){if(!fs.existsSync(dir))return false;for(const f of fs.readdirSync(dir)){if(!f.endsWith('.json'))continue;try{const r=JSON.parse(fs.readFileSync(path.join(dir,f),'utf8'));if(r.name===name&&r.status===want)return true}catch(e){/* mid-write record file: skip and retry on next poll */}}return false}(function poll(){if(hit())process.exit(0);if(Date.now()>until){console.error('timed out waiting for record '+name+' status '+want);process.exit(1)}setTimeout(poll,50)})()`
  return `node -e "${script}" ${JSON.stringify(dir)} ${JSON.stringify(name)} ${JSON.stringify(status)}`
}

export function taskStateDir(cwd) {
  return join(cwd, ".omo", "senpi-task")
}

export function readTaskRecords(cwd) {
  const dir = join(taskStateDir(cwd), "tasks")
  if (!existsSync(dir)) return []
  const records = []
  for (const entry of readdirSync(dir)) {
    if (!entry.endsWith(".json")) continue
    try {
      records.push(JSON.parse(readFileSync(join(dir, entry), "utf8")))
    } catch {
      // torn write mid-poll; the next poll reads the completed file
    }
  }
  return records
}

export function findTaskByName(cwd, name) {
  return readTaskRecords(cwd).find((record) => record?.name === name)
}

export function recordFileExists(cwd, taskId) {
  return existsSync(join(taskStateDir(cwd), "tasks", `${taskId}.json`))
}

export function taskEventText(cwd, taskId) {
  const path = join(taskStateDir(cwd), "logs", `${taskId}.jsonl`)
  return existsSync(path) ? readFileSync(path, "utf8") : ""
}

export function childSessionText(cwd, taskId) {
  const dir = join(taskStateDir(cwd), "children", taskId, "sessions", taskId)
  if (!existsSync(dir)) return ""
  return readdirSync(dir)
    .filter((entry) => entry.endsWith(".jsonl"))
    .map((entry) => readFileSync(join(dir, entry), "utf8"))
    .join("\n")
}

export function childSessionHasAssistant(cwd, taskId) {
  return /"role"\s*:\s*"assistant"/.test(childSessionText(cwd, taskId))
}

// Revival proof AFTER the first suspension. The reconcile claim itself is a store.mutate CAS (no
// transition_applied line), so the durable signals are the reconcile_reattached event every
// revival logs, or a later resident transition (a continued child completes as completed/resident).
export function revivedAfterSuspend(logText) {
  const lines = logText.split(/\r?\n/).filter((line) => line.length > 0)
  const suspendIndex = lines.findIndex((line) => line.includes('"type":"suspended"'))
  if (suspendIndex < 0) return false
  return lines
    .slice(suspendIndex + 1)
    .some((line) => line.includes('"type":"reconcile_reattached"') || line.includes('"resident"'))
}

// Print json mode emits the session header first; its id is what --session-id resumes.
export function sessionIdFromEvents(events) {
  const header = events.find((event) => event?.type === "session" && typeof event?.id === "string")
  return header?.id
}
