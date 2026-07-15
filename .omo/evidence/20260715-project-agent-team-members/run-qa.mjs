import { execFileSync, spawn } from "node:child_process"
import { once } from "node:events"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

const evidenceDir = path.dirname(fileURLToPath(import.meta.url))
const repositoryRoot = path.resolve(evidenceDir, "../../..")
const sandboxRoot = mkdtempSync(path.join(tmpdir(), "omo-project-agent-team-qa-"))
const homeRoot = sandboxRoot
const projectRoot = path.join(sandboxRoot, "project")
const configRoot = path.join(sandboxRoot, "config")
const dataRoot = path.join(sandboxRoot, "data")
const stateRoot = path.join(sandboxRoot, "state")
const cacheRoot = path.join(sandboxRoot, "cache")
const codexHome = path.join(sandboxRoot, "codex-home")
const teamStateRoot = path.join(sandboxRoot, "team-state")
const providerLog = path.join(evidenceDir, "provider-requests.jsonl")
const providerPortFile = path.join(sandboxRoot, "provider-port")

writeFileSync(providerLog, "")

function readProviderEntries() {
  return readFileSync(providerLog, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line))
}

async function capturePersistedLeadMessage() {
  for (let attempt = 0; attempt < 9_000; attempt += 1) {
    const teamRunId = readProviderEntries().find((entry) => entry.branch === "project-agent-child-message")?.teamRunId
    if (teamRunId) {
      const inboxDir = path.join(teamStateRoot, "runtime", teamRunId, "inboxes", "lead")
      if (existsSync(inboxDir)) {
        const messages = readdirSync(inboxDir)
          .filter((name) => name.endsWith(".json"))
          .map((name) => JSON.parse(readFileSync(path.join(inboxDir, name), "utf8")))
        const message = messages.find((candidate) => candidate.body === "QA_TEAM_MESSAGE")
        if (message) return message
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  return undefined
}

function terminateProvider(provider) {
  if (provider.exitCode === null && provider.signalCode === null) provider.kill("SIGTERM")
}

async function stopProvider(provider) {
  if (provider.exitCode !== null || provider.signalCode !== null) return
  const exited = once(provider, "exit")
  terminateProvider(provider)
  await exited
}

for (const directory of [
  homeRoot,
  path.join(projectRoot, ".opencode", "agents"),
  path.join(configRoot, "opencode"),
  dataRoot,
  stateRoot,
  cacheRoot,
  codexHome,
]) mkdirSync(directory, { recursive: true })
execFileSync("git", ["init", "--quiet"], { cwd: projectRoot })

const gitHead = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repositoryRoot, encoding: "utf8" }).trim()
const gitStatus = execFileSync("git", ["status", "--short"], { cwd: repositoryRoot, encoding: "utf8" }).trim().split("\n").filter(Boolean)

const hostHome = process.env.HOME
if (!hostHome) throw new Error("HOME is required to locate the host OpenCode database for the read-only count guard")
const hostDataRoot = process.env.XDG_DATA_HOME ?? path.join(hostHome, ".local", "share")
const hostDbPath = path.join(hostDataRoot, "opencode", "opencode.db")
const hostSessionCountBefore = execFileSync(
  "sqlite3",
  [hostDbPath, "SELECT count(*) FROM session;"],
  { encoding: "utf8" },
).trim()

writeFileSync(path.join(projectRoot, ".opencode", "agents", "repository-reviewer.md"), `---
description: Repository-scoped read-only reviewer used by Team Mode QA
mode: subagent
model: openai/gpt-project-agent
variant: xhigh
permission:
  "*": allow
  edit: deny
  write: deny
  apply_patch: deny
---

QA_PROJECT_AGENT_PROMPT_MARKER

You are the exact repository-reviewer project agent. Complete the assigned Team Mode task.
`)

const isolatedEnvironment = {
  ...process.env,
  HOME: homeRoot,
  USERPROFILE: homeRoot,
  XDG_CONFIG_HOME: configRoot,
  XDG_DATA_HOME: dataRoot,
  XDG_STATE_HOME: stateRoot,
  XDG_CACHE_HOME: cacheRoot,
  CODEX_HOME: codexHome,
  OPENCODE_DISABLE_AUTOUPDATE: "1",
  OPENCODE_DISABLE_MODELS_FETCH: "1",
  OMO_DISABLE_TELEMETRY: "1",
  OMO_DISABLE_PROCESS_CLEANUP: "1",
}
for (const inheritedKey of [
  "OPENCODE_CONFIG",
  "OPENCODE_CONFIG_DIR",
  "OPENCODE_CONFIG_CONTENT",
  "OPENCODE_SERVER_PASSWORD",
  "ANTHROPIC_API_KEY",
  "OPENAI_API_KEY",
  "GOOGLE_GENERATIVE_AI_API_KEY",
  "GEMINI_API_KEY",
  "CODEX_API_KEY",
  "GH_TOKEN",
  "GITHUB_TOKEN",
]) delete isolatedEnvironment[inheritedKey]

let providerStdout = ""
let providerStderr = ""
const provider = spawn(process.execPath, [path.join(evidenceDir, "fake-provider.mjs")], {
  cwd: repositoryRoot,
  env: {
    ...isolatedEnvironment,
    QA_PROVIDER_LOG: providerLog,
    QA_PROVIDER_PORT_FILE: providerPortFile,
  },
  stdio: ["ignore", "pipe", "pipe"],
})
const terminateProviderAtBoundary = () => {
  terminateProvider(provider)
  writeFileSync(path.join(evidenceDir, "provider-stdout.log"), providerStdout)
  writeFileSync(path.join(evidenceDir, "provider-stderr.log"), providerStderr)
}
process.once("exit", terminateProviderAtBoundary)
process.once("uncaughtExceptionMonitor", terminateProviderAtBoundary)
for (const [signal, exitCode] of [["SIGINT", 130], ["SIGTERM", 143]]) {
  process.once(signal, () => {
    terminateProviderAtBoundary()
    process.exit(exitCode)
  })
}
provider.stdout.on("data", (chunk) => { providerStdout += chunk.toString() })
provider.stderr.on("data", (chunk) => { providerStderr += chunk.toString() })

for (let attempt = 0; attempt < 100 && !existsSync(providerPortFile); attempt += 1) {
  await new Promise((resolve) => setTimeout(resolve, 50))
}
if (!existsSync(providerPortFile)) throw new Error(`fake provider failed to start: ${providerStderr}`)
const providerPort = readFileSync(providerPortFile, "utf8").trim()

writeFileSync(path.join(configRoot, "opencode", "opencode.jsonc"), JSON.stringify({
  plugin: [`file://${path.join(repositoryRoot, "packages/omo-opencode/src/index.ts")}`],
  default_agent: "Sisyphus - ultraworker",
  model: "openai/gpt-fake",
  provider: {
    openai: {
      options: {
        apiKey: "fake-key",
        baseURL: `http://127.0.0.1:${providerPort}/v1`,
        timeout: 30_000,
      },
      models: {
        "gpt-fake": { tool_call: true, limit: { context: 200_000, output: 8192 } },
        "gpt-project-agent": { tool_call: true, limit: { context: 200_000, output: 8192 } },
      },
    },
  },
  permission: {
    "*": "allow",
  },
}, null, 2))

writeFileSync(path.join(configRoot, "opencode", "oh-my-openagent.json"), JSON.stringify({
  agents: {
    sisyphus: { model: "openai/gpt-fake" },
  },
  team_mode: {
    enabled: true,
    tmux_visualization: false,
    base_dir: teamStateRoot,
    max_parallel_members: 2,
    max_wall_clock_minutes: 1,
  },
}, null, 2))

const run = spawn("opencode", [
  "run",
  "--format", "json",
  "--model", "openai/gpt-fake",
  "--dir", projectRoot,
  "QA_TRIGGER_PROJECT_AGENT_TEAM: create the requested team and wait for its member to start.",
], {
  cwd: projectRoot,
  env: isolatedEnvironment,
  stdio: ["ignore", "pipe", "pipe"],
})
let runStdout = ""
let runStderr = ""
run.stdout.on("data", (chunk) => { runStdout += chunk.toString() })
run.stderr.on("data", (chunk) => { runStderr += chunk.toString() })
const persistedMessageCapture = capturePersistedLeadMessage()
const runExitCode = await new Promise((resolve, reject) => {
  const timer = setTimeout(() => {
    run.kill("SIGTERM")
    reject(new Error("opencode run timed out after 90 seconds"))
  }, 90_000)
  run.on("exit", (code) => {
    clearTimeout(timer)
    resolve(code)
  })
})
const persistedTeamMessage = await persistedMessageCapture

await stopProvider(provider)
writeFileSync(path.join(evidenceDir, "provider-stdout.log"), providerStdout)
writeFileSync(path.join(evidenceDir, "provider-stderr.log"), providerStderr)
writeFileSync(path.join(evidenceDir, "opencode-run.jsonl"), runStdout)
writeFileSync(path.join(evidenceDir, "opencode-run.stderr.log"), runStderr)
writeFileSync(
  path.join(evidenceDir, "lead-inbox-messages.json"),
  `${JSON.stringify(persistedTeamMessage ? [persistedTeamMessage] : [], null, 2)}\n`,
)

const isolatedDbPath = execFileSync("opencode", ["db", "path"], {
  cwd: projectRoot,
  env: isolatedEnvironment,
  encoding: "utf8",
}).trim()
const isolatedSessionRows = execFileSync(
  "sqlite3",
  ["-json", isolatedDbPath, "SELECT id, parent_id, directory, title FROM session ORDER BY time_created;"],
  { encoding: "utf8" },
).trim()
writeFileSync(path.join(evidenceDir, "isolated-sessions.json"), `${isolatedSessionRows || "[]"}\n`)
const isolatedSessions = JSON.parse(isolatedSessionRows || "[]")
const memberWorktree = path.join(projectRoot, "member-worktree")
const childSession = isolatedSessions.find((session) => session.directory === memberWorktree)
const childSessionId = childSession?.id ?? "missing-child-session"
const escapedChildSessionId = childSessionId.replaceAll("'", "''")
const childPartRows = execFileSync(
  "sqlite3",
  ["-json", isolatedDbPath, `SELECT data FROM part WHERE session_id = '${escapedChildSessionId}' ORDER BY time_created, id;`],
  { encoding: "utf8" },
).trim()
const childParts = JSON.parse(childPartRows || "[]").map((row) => JSON.parse(row.data))
writeFileSync(path.join(evidenceDir, "child-session-parts.json"), `${JSON.stringify(childParts, null, 2)}\n`)

const hostSessionCountAfter = execFileSync(
  "sqlite3",
  [hostDbPath, "SELECT count(*) FROM session;"],
  { encoding: "utf8" },
).trim()
const providerEntries = readProviderEntries()
const childEntry = providerEntries.find((entry) => entry.branch === "project-agent-child-message")
const childCompletionEntry = providerEntries.find((entry) => entry.branch === "project-agent-child-complete")
const runEvents = runStdout.trim().split("\n").filter(Boolean).map((line) => JSON.parse(line))
const teamCreateEvent = runEvents.find((event) => event.type === "tool_use" && event.part?.tool === "team_create")
const teamCreateOutput = typeof teamCreateEvent?.part?.state?.output === "string"
  ? JSON.parse(teamCreateEvent.part.state.output)
  : undefined
const reviewerRuntime = teamCreateOutput?.runtimeState?.members?.find((member) => member.name === "reviewer")
const childInitialText = childParts.find((part) => part.type === "text")?.text
const teamSendMessagePart = childParts.find((part) => part.type === "tool" && part.tool === "team_send_message")
const teamMessageInput = teamSendMessagePart?.state?.input
const teamMessageOutput = typeof teamSendMessagePart?.state?.output === "string"
  ? JSON.parse(teamSendMessagePart.state.output)
  : undefined
const requiredTeamTools = [
  "team_send_message",
  "team_task_list",
  "team_task_get",
  "team_task_update",
  "team_status",
]
const assertions = {
  runExitedSuccessfully: runExitCode === 0,
  canonicalLeadIdentitySelected: !runStderr.includes("not found") && providerEntries.some((entry) => entry.branch === "parent-team-create" && entry.model === "gpt-fake"),
  parentInvokedTeamCreate: providerEntries.some((entry) => entry.branch === "parent-team-create"),
  provenanceVerifiedBuiltinLeadAuthorized: teamCreateEvent?.part?.state?.status === "completed",
  childRuntimeIdentityExact: reviewerRuntime?.subagent_type === "repository-reviewer" && reviewerRuntime?.name === "reviewer",
  childRuntimeModelVariantExact: reviewerRuntime?.model?.providerID === "openai" && reviewerRuntime?.model?.modelID === "gpt-project-agent" && reviewerRuntime?.model?.variant === "xhigh",
  childUsedExactProjectModel: childEntry?.model === "gpt-project-agent",
  childReceivedProjectPrompt: childEntry?.hasProjectPrompt === true,
  childReceivedAssignedTask: childEntry?.hasChildTask === true,
  childHasRequiredTeamTools: requiredTeamTools.every((tool) => childEntry?.tools.includes(tool)),
  childRepositoryWriteToolsDenied: ["apply_patch", "edit", "write"].every((tool) => !childEntry?.tools.includes(tool)),
  childQuestionToolDenied: childEntry?.tools.includes("question") === false,
  genericModelWasNotUsedForChild: childEntry?.model !== "gpt-fake",
  childUsedMemberWorktree: childSession?.directory === memberWorktree,
  childReceivedTeamGuidance: typeof childInitialText === "string"
    && childInitialText.includes("# Team Communication")
    && childInitialText.includes("You MUST use the `team_send_message` tool")
    && childInitialText.includes("For ALL team_* tool calls, use the TeamRunId shown above")
    && childInitialText.includes("## Lead-only tools you must NOT call")
    && ["team_send_message", "team_task_list", "team_task_get", "team_task_update"]
      .every((tool) => childInitialText.includes(`\`${tool}\``)),
  childTeamSendMessageCompleted: teamSendMessagePart?.state?.status === "completed",
  childTeamMessageTargetedLead: teamMessageInput?.to === "lead",
  childToolReportedLeadDelivery: teamMessageOutput?.deliveredTo?.includes("lead") === true,
  childCompletedAfterToolResult: childCompletionEntry?.hasToolResult === true,
  leadInboxPersistedReviewerMessage: persistedTeamMessage?.from === "reviewer" && persistedTeamMessage?.to === "lead",
  hostSessionCountUnchanged: hostSessionCountBefore === hostSessionCountAfter,
  providerStopped: provider.exitCode !== null || provider.signalCode !== null,
}
function createResult(cleanup) {
  return {
    assertions,
    cleanup,
    gitHead,
    gitStatus,
    hostDbPath,
    hostSessionCountBefore,
    hostSessionCountAfter,
    isolatedDbPath,
    projectRoot,
    childEntry,
    childCompletionEntry,
    reviewerRuntime,
    childSession,
    teamSendMessagePart,
    persistedTeamMessage,
  }
}
if (Object.values(assertions).some((passed) => !passed)) {
  rmSync(sandboxRoot, { recursive: true, force: true })
  assertions.failedSandboxRemoved = !existsSync(sandboxRoot)
  const failedResult = createResult({ sandboxPath: sandboxRoot, sandboxPreservedForFailure: false })
  writeFileSync(path.join(evidenceDir, "qa-result.json"), `${JSON.stringify(failedResult, null, 2)}\n`)
  throw new Error(`QA assertions failed: ${JSON.stringify(assertions)}`)
}

rmSync(sandboxRoot, { recursive: true, force: true })
assertions.successfulSandboxRemoved = !existsSync(sandboxRoot)
const result = createResult({ sandboxPath: sandboxRoot, sandboxPreservedForFailure: false })
writeFileSync(path.join(evidenceDir, "qa-result.json"), `${JSON.stringify(result, null, 2)}\n`)
if (!assertions.successfulSandboxRemoved) throw new Error(`successful QA sandbox was not removed: ${sandboxRoot}`)
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
