#!/usr/bin/env node
// Extended W3 team-scenario live drive. Reuses the committed sandbox/isolation helpers from the real
// omo-senpi drive.mjs WITHOUT editing them, points senpi at the extended /tmp mock provider, and drives
// the full lead team-tool chain end-to-end on the real senpi binary. NOT committed; runs from /tmp only.
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import {
  createSandbox,
  seedSandbox,
  digestDirectory,
} from "/Users/yeongyu/local-workspaces/omo-wt/senpi-task-w3-engine/packages/omo-senpi/scripts/qa/drive.mjs"
import { homedir } from "node:os"

const mockProviderEntry = "/tmp/w3harness/mock-provider/index.ts"
const senpiBin = process.env.SENPI_BIN?.trim() || "/opt/homebrew/bin/senpi"
const realSenpiAgentDir = join(homedir(), ".senpi", "agent")

const MEMBER_A = "researcher"
const MEMBER_B = "builder"

// The full lead team-tool chain, in canonical order, each paired with the non-error details.kind the
// happy path must return. __TEAM_RUN_ID__ is substituted by the mock from the team_create result.
const LEAD_CHAIN = [
  { name: "team_create", kind: "created", args: {
    inline_spec: {
      name: "w3-drive",
      members: [
        { name: MEMBER_A, kind: "category", category: "mock", prompt: `member ${MEMBER_A}: send one message to lead then stop.` },
        { name: MEMBER_B, kind: "category", category: "mock", prompt: `member ${MEMBER_B}: send one message to lead then stop.` },
      ],
    },
  } },
  { name: "team_status", kind: "status", args: { team_run_id: "__TEAM_RUN_ID__" } },
  { name: "team_send_message", kind: "to_members", args: { team_run_id: "__TEAM_RUN_ID__", to: MEMBER_A, body: "lead steer: focus on the spec section", summary: "steer" } },
  { name: "team_task_create", kind: "created", args: { team_run_id: "__TEAM_RUN_ID__", subject: "wire the engine", description: "implement the W3 engine seam" } },
  { name: "team_task_list", kind: "list", args: { team_run_id: "__TEAM_RUN_ID__" } },
  { name: "team_shutdown_request", kind: "requested", args: { team_run_id: "__TEAM_RUN_ID__", member: MEMBER_A } },
  { name: "team_approve_shutdown", kind: "approved", args: { team_run_id: "__TEAM_RUN_ID__", member: MEMBER_A } },
  { name: "team_delete", kind: "deleted", args: { team_run_id: "__TEAM_RUN_ID__", force: true } },
]

function buildLeadScript() {
  return {
    steps: [
      ...LEAD_CHAIN.map((entry) => ({ type: "tool_call", name: entry.name, arguments: entry.args })),
      { type: "text", text: "team drive complete" },
    ],
  }
}

function collectFiles(root, files) {
  if (!existsSync(root)) return
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name)
    if (entry.isDirectory()) collectFiles(path, files)
    else files.push(path)
  }
}

function readTranscripts(agentDir) {
  const files = []
  collectFiles(agentDir, files)
  return files
    .filter((file) => file.endsWith(".jsonl") && file.includes("/sessions/"))
    .map((file) => ({
      file,
      records: readFileSync(file, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line)),
    }))
}

function toolResultsOf(records) {
  return records
    .filter((record) => record.type === "message" && record.message?.role === "toolResult")
    .map((record) => record.message)
}

function main() {
  const beforeDigest = digestDirectory(realSenpiAgentDir)
  const sandbox = createSandbox()
  seedSandbox(sandbox)
  mkdirSync(join(sandbox.cwd, ".omo"), { recursive: true })
  writeFileSync(
    join(sandbox.cwd, ".omo", "omo.json"),
    JSON.stringify({ categories: { mock: { model: "omo-mock/mock-1" } } }, null, 2),
  )
  writeFileSync(join(sandbox.cwd, "mock-script.json"), JSON.stringify(buildLeadScript(), null, 2))

  const run = spawnSync(
    senpiBin,
    ["-e", mockProviderEntry, "-p", "--provider", "omo-mock", "--model", "mock-1", "drive the whole team lifecycle"],
    {
      cwd: sandbox.cwd,
      env: { ...process.env, SENPI_CODING_AGENT_DIR: sandbox.agentDir, OMO_SENPI_QA: "1" },
      encoding: "utf8",
      timeout: 120_000,
    },
  )

  const transcripts = readTranscripts(sandbox.agentDir)
  const leadTranscript = transcripts.find((t) => toolResultsOf(t.records).some((r) => r.toolName === "team_create"))
  const leadResults = leadTranscript ? toolResultsOf(leadTranscript.records) : []

  // Per-tool tool_execution_end assertion: every lead-chain tool must have produced a toolResult with
  // isError:false and the expected happy-path details.kind, in canonical order.
  const perTool = []
  let cursor = 0
  for (const entry of LEAD_CHAIN) {
    const match = leadResults.slice(cursor).find((r) => r.toolName === entry.name)
    const idx = match ? leadResults.indexOf(match, cursor) : -1
    perTool.push({
      tool: entry.name,
      found: match !== undefined,
      isError: match?.isError,
      kind: match?.details?.kind,
      expectedKind: entry.kind,
      ok: match !== undefined && match.isError === false && match.details?.kind === entry.kind,
      text: match?.content?.[0]?.text?.slice(0, 140),
    })
    if (idx >= 0) cursor = idx + 1
  }

  const teamRunId = leadResults.find((r) => r.toolName === "team_create")?.details?.team_run_id

  // Member->lead surfacing is a best-effort observation here, NOT a gate: an in-process member child
  // builds its agent session against a registry that does not inherit the -e-registered mock provider,
  // so a member cannot run a model turn to call its scoped team_send_message under this mock. That
  // reverse-delivery path is covered by the senpi-task unit suite (team messaging tests).
  const memberSends = transcripts
    .filter((t) => t !== leadTranscript)
    .flatMap((t) => toolResultsOf(t.records).filter((r) => r.toolName === "team_send_message"))
  const statusResult = leadResults.find((r) => r.toolName === "team_status")
  const statusMembers = Array.isArray(statusResult?.details?.members) ? statusResult.details.members : []
  const memberCountFromStatus = statusMembers.length
  const memberStatuses = statusMembers.map((m) => `${m.name}:${m.status}`)

  // Runtime-dir cleanup: team_delete rm -rf's the team-core runtime dir; after the drive the dir keyed
  // to this run must be gone (creation is proven by the created result + a 2-member status).
  const runtimeRoot = join(sandbox.cwd, ".omo", "senpi-task", "teams", "runtime")
  const runtimeDirCleanedUp = typeof teamRunId === "string" && !existsSync(join(runtimeRoot, teamRunId))

  // TypeBox schema rejection scan: senpi validates tool arguments before execute; a rejection would land
  // as an errored toolResult or a schema-shaped error string. Scan every toolResult + stderr.
  const anyErroredToolResult = transcripts.some((t) => toolResultsOf(t.records).some((r) => r.isError === true))
  const schemaRejectionPattern = /(TypeBox|does not match schema|Expected (?:required|string|object)|Invalid arguments|schema validation)/i
  const stderrHit = schemaRejectionPattern.test(run.stderr ?? "")
  const transcriptHit = transcripts.some((t) =>
    t.records.some((r) => r.type === "message" && r.message?.role === "toolResult" && schemaRejectionPattern.test(JSON.stringify(r.message.content))),
  )

  const afterDigest = digestDirectory(realSenpiAgentDir)

  const allToolsOk = perTool.every((t) => t.ok)
  const result = {
    result:
      run.status === 0 &&
      allToolsOk &&
      typeof teamRunId === "string" &&
      teamRunId.length > 0 &&
      !anyErroredToolResult &&
      !stderrHit &&
      !transcriptHit &&
      beforeDigest === afterDigest &&
      memberCountFromStatus === 2 &&
      runtimeDirCleanedUp
        ? "PASS"
        : "FAIL",
    status: run.status,
    teamRunId,
    perTool,
    memberCountFromStatus,
    memberStatuses,
    runtimeDirCleanedUp,
    memberSendCount: memberSends.length,
    memberLeadSurfacing: memberSends.length >= 1 ? "observed-live" : "harness-limited-covered-by-unit-tests",
    noTypeBoxRejection: !stderrHit && !transcriptHit && !anyErroredToolResult,
    realSenpiUntouched: beforeDigest === afterDigest,
    leadTranscript: leadTranscript?.file,
    sandboxAgentDir: sandbox.agentDir,
  }
  console.log(JSON.stringify(result, null, 2))
  if (process.env.OMO_W3_KEEP !== "1") {
    spawnSync("rm", ["-rf", sandbox.root])
  } else {
    console.log("KEPT_SANDBOX", sandbox.root)
  }
}

main()
