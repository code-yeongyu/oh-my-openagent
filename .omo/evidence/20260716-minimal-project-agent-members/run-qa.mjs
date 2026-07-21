import { execFileSync, spawn } from "node:child_process"
import { createHash } from "node:crypto"
import { once } from "node:events"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const evidenceDir = path.dirname(fileURLToPath(import.meta.url))
const repositoryRoot = path.resolve(evidenceDir, "../../..")
const providerLog = path.join(evidenceDir, "provider-requests.jsonl")
const requiredTeamTools = ["team_send_message", "team_task_list", "team_task_get", "team_task_update", "team_status"]
const intendedFiles = [
  "docs/guide/team-mode.md",
  "packages/omo-opencode/src/features/team-mode/final-open-code-agent-registry.ts",
  "packages/omo-opencode/src/features/team-mode/team-registry/project-agent-loader.test.ts",
  "packages/omo-opencode/src/features/team-mode/team-runtime/resolve-member.test.ts",
  "packages/omo-opencode/src/features/team-mode/team-runtime/resolve-member.ts",
  "packages/omo-opencode/src/features/team-mode/tools/lifecycle-create-tool.ts",
  "packages/omo-opencode/src/features/team-mode/tools/lifecycle-inline-project-agent.test.ts",
  "packages/omo-opencode/src/features/team-mode/tools/lifecycle-inline-spec.ts",
  "packages/omo-opencode/src/features/team-mode/tools/query.ts",
  "packages/omo-opencode/src/plugin-handlers/agent-config-handler.ts",
  "packages/omo-opencode/src/plugin-handlers/config-handler.ts",
  "packages/omo-opencode/src/plugin-handlers/project-agent-provenance-cache.test.ts",
  "packages/team-core/src/team-registry/loader.ts",
  "packages/team-core/src/team-registry/validator-options.test.ts",
  "packages/team-core/src/team-registry/validator.ts",
]

function exec(command, args, options = {}) {
  return execFileSync(command, args, { encoding: "utf8", ...options }).trim()
}

function git(args) {
  return exec("git", args, { cwd: repositoryRoot, env: { ...process.env, GIT_MASTER: "1" } })
}

function sha256(file) {
  return createHash("sha256").update(readFileSync(path.join(repositoryRoot, file))).digest("hex")
}

function hostSessionCount() {
  const home = process.env.HOME
  if (!home) throw new Error("HOME is required for the read-only host DB guard")
  const dataRoot = process.env.XDG_DATA_HOME ?? path.join(home, ".local", "share")
  return Number(exec("sqlite3", ["-readonly", path.join(dataRoot, "opencode", "opencode.db"), "SELECT count(*) FROM session;"]))
}

function isolatedEnvironment(sandbox) {
  const environment = { ...process.env }
  for (const key of Object.keys(environment)) {
    if (/^(OPENCODE|ANTHROPIC|OPENAI|GOOGLE|GEMINI|GROQ|MISTRAL|COHERE|AZURE|AWS|GH_|GITHUB_)/i.test(key)
      || /(API_KEY|ACCESS_TOKEN|AUTH_TOKEN|PASSWORD|SECRET)$/i.test(key)) delete environment[key]
  }
  return {
    ...environment,
    HOME: sandbox,
    USERPROFILE: sandbox,
    XDG_CONFIG_HOME: path.join(sandbox, "config"),
    XDG_DATA_HOME: path.join(sandbox, "data"),
    XDG_STATE_HOME: path.join(sandbox, "state"),
    XDG_CACHE_HOME: path.join(sandbox, "cache"),
    CODEX_HOME: path.join(sandbox, "codex-home"),
    TMPDIR: sandbox,
    TMP: sandbox,
    TEMP: sandbox,
    OPENCODE_DISABLE_AUTOUPDATE: "1",
    OPENCODE_DISABLE_MODELS_FETCH: "1",
    OMO_DISABLE_TELEMETRY: "1",
    OMO_DISABLE_PROCESS_CLEANUP: "1",
  }
}

function writeProjectAgent(file) {
  writeFileSync(file, `---
description: Exact repository reviewer for project-agent Team Mode QA
mode: subagent
hidden: false
model: openai/gpt-project-agent
variant: xhigh
permission:
  team_send_message: allow
  team_task_list: allow
  team_task_get: allow
  team_task_update: allow
  team_status: allow
  question: deny
  apply_patch: deny
  edit: deny
  write: deny
---

QA_PROJECT_AGENT_PROMPT_MARKER
`)
}

function writeOpenCodeConfig(file, providerPort) {
  const config = {
    plugin: [pathToFileURL(path.join(repositoryRoot, "packages/omo-opencode/src/index.ts")).href],
    default_agent: "Sisyphus - ultraworker",
    model: "openai/gpt-fake",
    provider: {
      openai: {
        options: { apiKey: "qa-non-secret-placeholder", baseURL: `http://127.0.0.1:${providerPort}/v1`, timeout: 30_000 },
        models: {
          "gpt-fake": { tool_call: true, limit: { context: 200_000, output: 8192 } },
          "gpt-project-agent": { tool_call: true, limit: { context: 200_000, output: 8192 } },
          "gpt-config-override": { tool_call: true, limit: { context: 200_000, output: 8192 } },
        },
      },
    },
    permission: { "*": "allow" },
  }
  writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`)
}

function writeLaterProjectConfig(file) {
  writeFileSync(file, `${JSON.stringify({
    agent: {
      "repository-reviewer": {
        description: "QA later OpenCode config definition",
        mode: "subagent",
        model: "openai/gpt-config-override",
        variant: "low",
        prompt: "QA_LATER_CONFIG_PROMPT_MARKER",
        permission: Object.fromEntries(["*", ...requiredTeamTools].map((tool) => [tool, tool === "*" ? "deny" : "allow"])),
      },
    },
  }, null, 2)}\n`)
}

function readJsonLines(file) {
  const text = readFileSync(file, "utf8").trim()
  return text ? text.split("\n").map((line) => JSON.parse(line)) : []
}

function sanitize(value, replacements) {
  if (typeof value === "string") {
    return replacements.reduce((current, [needle, replacement]) => current.replaceAll(needle, replacement), value)
  }
  if (Array.isArray(value)) return value.map((entry) => sanitize(entry, replacements))
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, sanitize(entry, replacements)]))
  }
  return value
}

async function stopProcess(processHandle) {
  if (!processHandle || processHandle.exitCode !== null || processHandle.signalCode !== null) return
  const exited = once(processHandle, "exit")
  processHandle.kill("SIGTERM")
  const stopped = await Promise.race([
    exited.then(() => true),
    new Promise((resolve) => setTimeout(() => resolve(false), 2_000)),
  ])
  if (!stopped) {
    processHandle.kill("SIGKILL")
    await exited
  }
}

async function runScenario(scenario) {
  const sandbox = mkdtempSync(path.join(tmpdir(), `omo-project-agent-${scenario}-`))
  const environment = isolatedEnvironment(sandbox)
  const project = path.join(sandbox, "project")
  const agentFile = path.join(project, ".opencode", "agents", "repository-reviewer.md")
  const configDir = path.join(environment.XDG_CONFIG_HOME, "opencode")
  const portFile = path.join(sandbox, "provider-port")
  const scenarioLog = path.join(sandbox, "provider.jsonl")
  let provider

  try {
    for (const directory of [project, path.dirname(agentFile), configDir, environment.XDG_DATA_HOME, environment.XDG_STATE_HOME, environment.XDG_CACHE_HOME, environment.CODEX_HOME]) {
      mkdirSync(directory, { recursive: true })
    }
    exec("git", ["init", "--quiet"], { cwd: project, env: { ...environment, GIT_MASTER: "1" } })
    writeProjectAgent(agentFile)
    writeFileSync(path.join(configDir, "oh-my-openagent.json"), `${JSON.stringify({
      agents: { sisyphus: { model: "openai/gpt-fake" } },
      team_mode: { enabled: true, tmux_visualization: false, base_dir: path.join(sandbox, "team-state"), max_parallel_members: 2, max_wall_clock_minutes: 1 },
    }, null, 2)}\n`)
    writeFileSync(scenarioLog, "")

    provider = spawn(process.execPath, [path.join(evidenceDir, "fake-provider.mjs")], {
      cwd: repositoryRoot,
      env: { ...environment, QA_SCENARIO: scenario, QA_PROVIDER_LOG: scenarioLog, QA_PROVIDER_PORT_FILE: portFile, QA_PROJECT_AGENT_FILE: agentFile },
      stdio: ["ignore", "ignore", "pipe"],
    })
    let providerStderr = ""
    provider.stderr.on("data", (chunk) => { providerStderr += chunk.toString() })
    for (let attempt = 0; attempt < 100 && !existsSync(portFile); attempt += 1) await new Promise((resolve) => setTimeout(resolve, 50))
    if (!existsSync(portFile)) throw new Error(`fake provider did not start (${providerStderr.length} stderr bytes)`)

    writeOpenCodeConfig(path.join(configDir, "opencode.jsonc"), readFileSync(portFile, "utf8").trim())
    if (scenario === "rejected") writeLaterProjectConfig(path.join(project, ".opencode", "opencode.jsonc"))
    const run = spawn("opencode", [
      "run", "--format", "json", "--model", "openai/gpt-fake", "--dir", project,
      "QA_TRIGGER_PROJECT_AGENT_TEAM: create the inline team, then finish.",
    ], { cwd: project, env: environment, stdio: ["ignore", "pipe", "pipe"] })
    let stdout = ""
    let stderr = ""
    run.stdout.on("data", (chunk) => { stdout += chunk.toString() })
    run.stderr.on("data", (chunk) => { stderr += chunk.toString() })
    const exitCode = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        run.kill("SIGTERM")
        reject(new Error(`${scenario} opencode run timed out`))
      }, 90_000)
      run.on("exit", (code) => { clearTimeout(timer); resolve(code) })
    })
    await stopProcess(provider)

    const events = stdout.trim().split("\n").filter(Boolean).map((line) => JSON.parse(line))
    const replacements = [[sandbox, "$SANDBOX"], [repositoryRoot, "$REPOSITORY_ROOT"]]
    writeFileSync(path.join(evidenceDir, `opencode-run-${scenario}.jsonl`), `${events.map((event) => JSON.stringify(sanitize(event, replacements))).join("\n")}\n`)
    const providerEntries = readJsonLines(scenarioLog)
    for (const entry of providerEntries) writeFileSync(providerLog, `${JSON.stringify(entry)}\n`, { flag: "a" })

    const teamCreateEvent = events.find((event) => event.type === "tool_use" && event.part?.tool === "team_create")
    const output = typeof teamCreateEvent?.part?.state?.output === "string" ? JSON.parse(teamCreateEvent.part.state.output) : undefined
    const reviewer = output?.runtimeState?.members?.find((member) => member.name === "reviewer")
    const childRequest = providerEntries.find((entry) => entry.branch === "project-agent-child")
    const sourcePresence = providerEntries.find((entry) => entry.branch === "parent-team-create")?.projectAgentPresentBeforeTeamCreateResponse === true
    const isolatedDb = path.join(environment.XDG_DATA_HOME, "opencode", "opencode.db")
    const childSessionCount = existsSync(isolatedDb)
      ? Number(exec("sqlite3", ["-readonly", isolatedDb, "SELECT count(*) FROM session WHERE parent_id IS NOT NULL;"]))
      : 0

    return {
      scenario,
      exitCode,
      stderrSummary: { bytes: Buffer.byteLength(stderr), nonEmptyLines: stderr.split("\n").filter(Boolean).length },
      teamCreateStatus: teamCreateEvent?.part?.state?.status ?? null,
      teamCreateError: typeof teamCreateEvent?.part?.state?.error === "string" ? teamCreateEvent.part.state.error : null,
      teamCreateHasProvenanceError: JSON.stringify(teamCreateEvent).includes("Project agent 'repository-reviewer' has no config-time provenance for this exact directory."),
      reviewer: reviewer ? { name: reviewer.name, subagent_type: reviewer.subagent_type, model: reviewer.model } : null,
      childRequest: childRequest ?? null,
      childRequestCount: providerEntries.filter((entry) => entry.branch === "project-agent-child").length,
      childSessionCount,
      projectAgentPresentBeforeTeamCreateResponse: sourcePresence,
      projectAgentExistsAfterRun: existsSync(agentFile),
      providerStopped: provider.exitCode !== null || provider.signalCode !== null,
      sandboxRemoved: false,
    }
  } finally {
    await stopProcess(provider)
    rmSync(sandbox, { recursive: true, force: true })
  }
}

writeFileSync(providerLog, "")
for (const scenario of ["accepted", "rejected"]) writeFileSync(path.join(evidenceDir, `opencode-run-${scenario}.jsonl`), "")

const gitHead = git(["rev-parse", "HEAD"])
const sourceManifest = intendedFiles.map((file) => ({ file, sha256: sha256(file) }))
const hostSessionCountBefore = hostSessionCount()
let accepted
let rejected
let failure

try {
  accepted = await runScenario("accepted")
  accepted.sandboxRemoved = true
  rejected = await runScenario("rejected")
  rejected.sandboxRemoved = true
} catch (error) {
  failure = error instanceof Error ? error.message : String(error)
}

const hostSessionCountAfter = hostSessionCount()
const assertions = accepted && rejected ? {
  exactSourceManifestHas15Files: sourceManifest.length === 15,
  hostSessionCountUnchanged: hostSessionCountBefore === hostSessionCountAfter,
  acceptedRunExitedSuccessfully: accepted.exitCode === 0,
  acceptedTeamCreateCompleted: accepted.teamCreateStatus === "completed",
  acceptedFinalIdentityExact: accepted.reviewer?.name === "reviewer" && accepted.reviewer?.subagent_type === "repository-reviewer",
  acceptedFinalModelVariantExact: accepted.reviewer?.model?.providerID === "openai" && accepted.reviewer?.model?.modelID === "gpt-project-agent" && accepted.reviewer?.model?.variant === "xhigh",
  acceptedChildUsedProjectPromptAndModel: accepted.childRequest?.model === "gpt-project-agent" && accepted.childRequest?.hasProjectPromptMarker === true && accepted.childRequest?.hasChildTaskMarker === true,
  acceptedChildHasRequiredTeamTools: requiredTeamTools.every((tool) => accepted.childRequest?.toolNames.includes(tool)),
  acceptedChildHasNoWriteOrQuestionTools: accepted.childRequest !== null && ["apply_patch", "edit", "write", "question"].every((tool) => !accepted.childRequest.toolNames.includes(tool)),
  acceptedSourcePresentForAuthoritativeRegistry: accepted.projectAgentPresentBeforeTeamCreateResponse && accepted.projectAgentExistsAfterRun,
  acceptedChildSessionCreated: accepted.childRequestCount === 1 && accepted.childSessionCount === 1,
  rejectedRunExitedSuccessfully: rejected.exitCode === 0,
  rejectedTeamCreateFailedForExactProvenanceReason: rejected.teamCreateStatus !== "completed" && rejected.teamCreateHasProvenanceError,
  rejectedCreatedNoChildRequestOrSession: rejected.childRequestCount === 0 && rejected.childSessionCount === 0,
  providersStoppedAndSandboxesRemoved: accepted.providerStopped && rejected.providerStopped && accepted.sandboxRemoved && rejected.sandboxRemoved,
} : {}

const passed = failure === undefined && Object.keys(assertions).length > 0 && Object.values(assertions).every(Boolean)
const result = {
  passed,
  assertionCount: Object.keys(assertions).length,
  assertions,
  gitHead,
  gitStatusShort: [],
  sourceManifest,
  hostIsolation: { sessionCountBefore: hostSessionCountBefore, sessionCountAfter: hostSessionCountAfter, unchanged: hostSessionCountBefore === hostSessionCountAfter },
  scenarios: { accepted: accepted ?? null, rejected: rejected ?? null },
  failure: failure ?? null,
  sanitization: "Provider evidence contains metadata only; OpenCode JSONL replaces sandbox and repository roots; stderr is summarized by byte and line counts.",
}

const resultPath = path.join(evidenceDir, "qa-result.json")
writeFileSync(resultPath, `${JSON.stringify(result, null, 2)}\n`)
result.gitStatusShort = git(["status", "--short", "--untracked-files=all"]).split("\n").filter(Boolean)
writeFileSync(resultPath, `${JSON.stringify(result, null, 2)}\n`)
process.stdout.write(`${JSON.stringify({ passed, assertionCount: result.assertionCount, hostIsolation: result.hostIsolation, failure: result.failure }, null, 2)}\n`)
if (!passed) process.exitCode = 1
