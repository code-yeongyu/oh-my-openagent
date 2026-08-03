#!/usr/bin/env node
// Real-process QA for issue 6413. Run with an isolated home:
//   HOME=<empty-dir> node packages/omo-senpi/scripts/qa/team-delete-6413-qa.mjs [evidence-dir]
// A completed team member keeps a live wrapper process, and team_delete must destroy that resident
// while ordinary terminal cancellation stays a noop. RPC terminate signals the wrapper PID only;
// detached grandchildren can survive deletion, so the member fixture spawns one and the driver records
// it alongside the wrapper's recursively enumerated descendants. Every recorded PID must be gone before
// the lead exits, preventing session-shutdown teardown from masking whether deletion owned cleanup.

import { execFileSync, spawnSync } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

import { createSandbox, seedSandbox } from "./drive.mjs"
import { startSenpiRun } from "./team-e2e-runtime.mjs"
import { parseEvents } from "./team-e2e-support.mjs"

const scriptDir = dirname(fileURLToPath(import.meta.url))
const mockProviderEntry = join(scriptDir, "team-e2e-mock-provider.ts")
const senpiBin = process.env.SENPI_BIN ?? "senpi"
const inheritedEnvKeys = Object.keys(process.env).filter((key) => key.startsWith("SENPI_TASK_"))
const scrubbedEnv = Object.fromEntries(
  [...inheritedEnvKeys, "OMO_PROFILE", "OCX_PROFILE", "OPENCODE_CONFIG_DIR"].map((key) => [key, undefined]),
)

const QA_OMO_CONFIG = {
  categories: {
    quick: { models: ["omo-mock/mock-1"] },
  },
}

const WAIT_MEMBER_SOURCE = `import { execFileSync } from "node:child_process"
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

const dir = join(process.cwd(), ".omo", "senpi-task", "tasks")
const deadline = Date.now() + 60000

function errno(error, code) {
  return error instanceof Error && "code" in error && error.code === code
}

function pgrepChildren(pid) {
  try {
    return execFileSync("pgrep", ["-P", String(pid)]).toString().trim().split("\\n").filter(Boolean).map(Number)
  } catch (error) {
    if (error instanceof Error && "status" in error && error.status === 1) return []
    throw error
  }
}

function descendants(root) {
  const found = []
  const queue = [root]
  while (queue.length > 0) {
    const parent = queue.shift()
    if (parent === undefined) continue
    for (const child of pgrepChildren(parent)) {
      if (found.includes(child)) continue
      found.push(child)
      queue.push(child)
    }
  }
  return found
}

function findCompletedMember() {
  for (const file of readdirSync(dir)) {
    if (!file.endsWith(".json")) continue
    const record = JSON.parse(readFileSync(join(dir, file), "utf8"))
    if (record.status === "completed" && typeof record.pid === "number") return record
  }
  return null
}

function poll() {
  let record = null
  try {
    record = findCompletedMember()
  } catch (error) {
    if (!errno(error, "ENOENT")) throw error
  }
  if (record !== null) {
    const children = descendants(record.pid)
    const detachedPath = join(process.cwd(), "detached-member.pid")
    const detached = existsSync(detachedPath) ? Number(readFileSync(detachedPath, "utf8").trim()) : undefined
    if (!Number.isSafeInteger(detached) || detached <= 0) throw new Error("detached member pid was not recorded")
    writeFileSync("member-pids.json", JSON.stringify({ wrapper: record.pid, children, detached }, null, 2))
    console.log(JSON.stringify({ wrapper: record.pid, children, detached }))
    process.exit(0)
  }
  if (Date.now() > deadline) {
    console.error("member never reached completed with a pid")
    process.exit(1)
  }
  setTimeout(poll, 100)
}
poll()
`

const VERIFY_DEAD_SOURCE = `import { readFileSync, writeFileSync } from "node:fs"

const { wrapper, children, detached } = JSON.parse(readFileSync("member-pids.json", "utf8"))
const pids = [wrapper, ...children, detached]
const deadline = Date.now() + 30000

function alive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ESRCH") return false
    throw error
  }
}

function poll() {
  const live = pids.filter(alive)
  if (live.length === 0) {
    writeFileSync("verify-dead.json", JSON.stringify({ wrapper, children, detached, allExited: true }, null, 2))
    console.log(JSON.stringify({ wrapper, children, detached, allExited: true }))
    process.exit(0)
  }
  if (Date.now() > deadline) {
    console.error(JSON.stringify({ wrapper, children, detached, stillAlive: live }))
    process.exit(1)
  }
  setTimeout(poll, 100)
}
poll()
`

const MEMBER_PROMPT = "You are team member 'alpha'. MOCKROLE=quick. Acknowledge, then end your turn."

function buildScript() {
  return {
    lead: [
      {
        type: "tool_call",
        name: "team_create",
        arguments: {
          inline_spec: {
            name: "issue6413",
            members: [{ name: "alpha", kind: "category", category: "quick", prompt: MEMBER_PROMPT }],
          },
        },
      },
      { type: "tool_call", name: "bash", arguments: { command: "node wait-member.mjs" } },
      { type: "tool_call", name: "team_delete", arguments: { team_run_id: "__TEAM_RUN_ID__" } },
      { type: "tool_call", name: "bash", arguments: { command: "node verify-dead.mjs" } },
      { type: "text", text: "issue6413 deleted and verified" },
    ],
    quick: [
      {
        type: "tool_call",
        name: "bash",
        arguments: {
          command: "nohup sh -c 'sleep 300' </dev/null >/dev/null 2>&1 & echo $! > detached-member.pid",
        },
      },
      { type: "text", text: "alpha acknowledged" },
    ],
  }
}

function assertDead(pid) {
  try {
    process.kill(pid, 0)
    throw new Error(`pid ${pid} still alive after team_delete`)
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ESRCH")) throw error
  }
}

function killRecordedPid(pid) {
  try {
    process.kill(pid, "SIGKILL")
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ESRCH")) {
      console.error(`cleanup failed for pid ${pid}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
}

async function main() {
  const evidenceDir = process.argv[2] ?? join(tmpdir(), `omo-team-delete-6413-${Date.now()}`)
  console.error(`evidence-dir: ${evidenceDir}`)
  mkdirSync(evidenceDir, { recursive: true })

  const sandbox = createSandbox()
  let run
  let recordedPids = []
  try {
    seedSandbox(sandbox)
    mkdirSync(join(sandbox.cwd, ".omo"), { recursive: true })
    writeFileSync(join(sandbox.cwd, ".omo", "omo.json"), `${JSON.stringify(QA_OMO_CONFIG, null, 2)}\n`)
    writeFileSync(join(sandbox.cwd, "wait-member.mjs"), WAIT_MEMBER_SOURCE)
    writeFileSync(join(sandbox.cwd, "verify-dead.mjs"), VERIFY_DEAD_SOURCE)

    run = startSenpiRun({
      senpiBin,
      sandbox,
      mockProviderEntry,
      parseEvents,
      prompt: "Drive the scripted issue-6413 team_delete verification exactly.",
      script: buildScript(),
      extraEnv: scrubbedEnv,
    })
    const result = await run.completion
    writeFileSync(join(evidenceDir, "lead.stdout.log"), result.stdout)
    writeFileSync(join(evidenceDir, "lead.stderr.log"), result.stderr)

    const pidsPath = join(sandbox.cwd, "member-pids.json")
    if (!existsSync(pidsPath)) throw new Error("member-pids.json was never written (member did not complete)")
    const { wrapper, children, detached } = JSON.parse(readFileSync(pidsPath, "utf8"))
    recordedPids = [wrapper, ...children, detached]
    writeFileSync(join(evidenceDir, "member-pids.json"), JSON.stringify({ wrapper, children, detached }, null, 2))

    const verifyPath = join(sandbox.cwd, "verify-dead.json")
    if (!existsSync(verifyPath)) throw new Error(`in-turn verification did not pass; run status ${String(result.status)}`)
    writeFileSync(join(evidenceDir, "verify-dead.json"), readFileSync(verifyPath))
    for (const pid of recordedPids) assertDead(pid)

    const ps = spawnSync("ps", ["-p", recordedPids.join(","), "-o", "pid=,command="], { encoding: "utf8" })
    if (ps.error !== undefined) throw ps.error
    if (ps.status !== 0 && ps.status !== 1) throw new Error(`ps failed with status ${String(ps.status)}: ${ps.stderr}`)
    const psRows = ps.stdout ?? ""
    writeFileSync(join(evidenceDir, "post-delete-ps.txt"), psRows === "" ? "(no matching rows)\n" : psRows)
    if (psRows !== "") throw new Error(`ps rows survived deletion: ${psRows}`)

    const runtimeDir = join(sandbox.cwd, ".omo", "senpi-task", "teams", "runtime")
    const remainingTeams = existsSync(runtimeDir) ? readdirSync(runtimeDir) : []
    const summary = { runStatus: result.status, wrapper, children, detached, allExited: true, remainingTeams }
    writeFileSync(join(evidenceDir, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`)
    if (result.status !== 0) throw new Error(`lead run exited with status ${String(result.status)}`)
    if (remainingTeams.length !== 0) throw new Error(`team runtime directories remain: ${remainingTeams.join(", ")}`)
    console.log(JSON.stringify({ pass: true, wrapper, children, detached, remainingTeams, evidenceDir }))
  } finally {
    if (run !== undefined) await run.kill()
    for (const pid of [...recordedPids].reverse()) killRecordedPid(pid)
    rmSync(sandbox.root, { recursive: true, force: true })
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error))
  process.exitCode = 1
})
