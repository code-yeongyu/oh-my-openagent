import { randomUUID } from "node:crypto"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import type { TeamModeConfig } from "../config/schema/team-mode"
import { TeamModeConfigSchema } from "../config/schema/team-mode"
import type { HostKind, HostToolDefinition, JsonObject } from "../host-contract"
import { createTask, getTask, listTasks, updateTaskStatus } from "../features/team-mode/team-tasklist"
import { sendMessage } from "../features/team-mode/team-mailbox"
import { ensureBaseDirs, getInboxDir, getWorktreeDir, resolveBaseDir } from "../features/team-mode/team-registry/paths"
import { createRuntimeState, listActiveTeams, loadRuntimeState, transitionRuntimeState } from "../features/team-mode/team-state-store/store"
import { AGENT_ELIGIBILITY_REGISTRY, TeamSpecSchema, type RuntimeState, type TeamSpec } from "../features/team-mode/types"
import { runTmuxCommand, type TmuxCommandResult } from "../shared/tmux"
import { getTmuxPath } from "../tools/interactive-bash/tmux-path-resolver"
import { registerTargetTool, type TargetToolDefinition, type TargetToolRegistry } from "./tool-registration"

type TeamIndex = Record<string, string>

type TargetTeamDeps = {
  getTmuxPath(): Promise<string | null>
  runTmuxCommand(tmuxPath: string, args: string[]): Promise<TmuxCommandResult>
}

const DEFAULT_TEAM_DEPS: TargetTeamDeps = {
  getTmuxPath,
  runTmuxCommand: (tmuxPath, args) => runTmuxCommand(tmuxPath, args, { timeoutMs: 10_000 }),
}

const schema: JsonObject = {
  type: "object",
  properties: {
    name: { type: "string", description: "Team name. Alias for team_name." },
    team_name: { type: "string", description: "Team name." },
    teamName: { type: "string", description: "Team name." },
    team: { type: "string", description: "Team name." },
    team_run_id: { type: "string", description: "Explicit team run id." },
    teamRunId: { type: "string", description: "Explicit team run id." },
    members: {
      type: "array",
      description: "Team members to create, such as sisyphus and atlas.",
      items: {
        anyOf: [
          { type: "string" },
          {
            type: "object",
            properties: {
              name: { type: "string" },
              subagent_type: { type: "string" },
            },
            additionalProperties: true,
          },
        ],
      },
    },
    subject: { type: "string", description: "Task subject for team_task_create." },
    description: { type: "string", description: "Task description." },
    body: { type: "string", description: "Message body or task description." },
    message: { type: "string", description: "Message body." },
    to: { type: "string", description: "Message recipient, member name, or *." },
    from: { type: "string", description: "Message sender." },
    task_id: { type: "string", description: "Team task id." },
    taskId: { type: "string", description: "Team task id." },
    status: { type: "string", description: "Task status." },
    owner: { type: "string", description: "Task update owner." },
    member: { type: "string", description: "Member id for shutdown tools." },
    requester: { type: "string", description: "Shutdown requester." },
    reason: { type: "string", description: "Rejection reason." },
  },
  additionalProperties: true,
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined
}

function teamName(input: JsonObject): string {
  return text(input.team_name) ?? text(input.teamName) ?? text(input.team) ?? text(input.name) ?? "default"
}

function teamRunId(input: JsonObject): string | undefined {
  return text(input.teamRunId) ?? text(input.team_run_id)
}

function safeName(value: string): string {
  const normalized = value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")
  return normalized.length > 0 ? normalized : "member"
}

function targetTeamConfig(cwd: string): TeamModeConfig {
  return TeamModeConfigSchema.parse({
    enabled: true,
    tmux_visualization: true,
    base_dir: join(cwd, ".omo", "target-team-mode"),
  })
}

function indexPath(cwd: string): string {
  return join(cwd, ".omo", "target-team-index.json")
}

async function loadIndex(cwd: string): Promise<TeamIndex> {
  try {
    return JSON.parse(await readFile(indexPath(cwd), "utf8")) as TeamIndex
  } catch (error) {
    if (error instanceof Error) return {}
    return {}
  }
}

async function saveIndex(cwd: string, index: TeamIndex): Promise<void> {
  const targetPath = indexPath(cwd)
  await mkdir(dirname(targetPath), { recursive: true })
  await writeFile(targetPath, `${JSON.stringify(index, null, 2)}\n`)
}

function parseMembers(input: JsonObject): string[] {
  const rawMembers = Array.isArray(input.members) ? input.members : ["sisyphus"]
  return rawMembers
    .map((member) => {
      if (typeof member === "string") return member
      if (typeof member === "object" && member !== null && "subagent_type" in member && typeof member.subagent_type === "string") return member.subagent_type
      if (typeof member === "object" && member !== null && "name" in member && typeof member.name === "string") return member.name
      return undefined
    })
    .filter((member): member is string => member !== undefined && member.length > 0)
}

function assertEligible(members: readonly string[]): void {
  for (const member of members) {
    const verdict = AGENT_ELIGIBILITY_REGISTRY[member]?.verdict
    if (verdict === "hard-reject") {
      throw new Error(AGENT_ELIGIBILITY_REGISTRY[member]?.rejectionMessage)
    }
  }
}

function createSpec(name: string, members: readonly string[]): TeamSpec {
  const uniqueMembers = [...new Set(members)]
  return TeamSpecSchema.parse({
    version: 1,
    name: safeName(name),
    leadAgentId: safeName(uniqueMembers[0] ?? "sisyphus"),
    members: uniqueMembers.map((member) => ({
      name: safeName(member),
      kind: "subagent_type",
      subagent_type: member,
      prompt: `Target Team Mode member ${member}. Watch your inbox and work from the assigned worktree.`,
    })),
  })
}

async function resolveRunId(input: JsonObject, cwd: string, config: TeamModeConfig): Promise<string> {
  const explicitRunId = teamRunId(input)
  if (explicitRunId) return explicitRunId
  const index = await loadIndex(cwd)
  const indexedRunId = index[teamName(input)]
  if (indexedRunId) return indexedRunId
  const activeTeam = (await listActiveTeams(config)).find((team) => team.teamName === safeName(teamName(input)))
  if (activeTeam) return activeTeam.teamRunId
  throw new Error(`Team "${teamName(input)}" not found.`)
}

async function createWorktreeLayout(runtimeState: RuntimeState, config: TeamModeConfig): Promise<RuntimeState> {
  const baseDir = resolveBaseDir(config)
  return await transitionRuntimeState(runtimeState.teamRunId, (currentState) => ({
    ...currentState,
    members: currentState.members.map((member) => ({
      ...member,
      sessionId: member.sessionId ?? `target:${currentState.teamRunId}:${member.name}`,
      status: "running",
      worktreePath: member.worktreePath ?? getWorktreeDir(baseDir, currentState.teamRunId, member.name),
    })),
  }), config)
}

async function ensureRuntimeDirectories(runtimeState: RuntimeState, config: TeamModeConfig): Promise<void> {
  const baseDir = resolveBaseDir(config)
  await Promise.all(runtimeState.members.flatMap((member) => [
    mkdir(getInboxDir(baseDir, runtimeState.teamRunId, member.name), { recursive: true, mode: 0o700 }),
    member.worktreePath ? mkdir(member.worktreePath, { recursive: true }) : Promise.resolve(),
  ]))
}

function paneCommand(member: RuntimeState["members"][number]): string {
  const cwd = member.worktreePath ?? process.cwd()
  return `cd ${JSON.stringify(cwd)} && printf 'OMO target team member: ${member.name}\\nWorktree: ${cwd}\\n' && exec \${SHELL:-sh}`
}

async function activateTargetTmuxLayout(
  runtimeState: RuntimeState,
  config: TeamModeConfig,
  deps: TargetTeamDeps,
): Promise<RuntimeState> {
  const tmuxPath = await deps.getTmuxPath()
  if (!tmuxPath) return runtimeState
  const targetSessionId = `omo-target-team-${runtimeState.teamRunId.slice(0, 8)}`
  const firstMember = runtimeState.members[0]
  if (!firstMember) return runtimeState

  const createSession = await deps.runTmuxCommand(tmuxPath, [
    "new-session",
    "-d",
    "-s",
    targetSessionId,
    "-n",
    runtimeState.teamName,
    paneCommand(firstMember),
  ])
  if (!createSession.success) return runtimeState

  const focusPanesByMember: Record<string, string> = {}
  const firstPane = await deps.runTmuxCommand(tmuxPath, ["list-panes", "-t", targetSessionId, "-F", "#{pane_id}"])
  if (firstPane.success && firstPane.output) focusPanesByMember[firstMember.name] = firstPane.output.trim().split("\n")[0] ?? ""

  for (const member of runtimeState.members.slice(1)) {
    const split = await deps.runTmuxCommand(tmuxPath, [
      "split-window",
      "-t",
      targetSessionId,
      "-d",
      "-P",
      "-F",
      "#{pane_id}",
      paneCommand(member),
    ])
    if (split.success && split.output) focusPanesByMember[member.name] = split.output.trim()
  }
  await deps.runTmuxCommand(tmuxPath, ["select-layout", "-t", targetSessionId, "tiled"])

  return await transitionRuntimeState(runtimeState.teamRunId, (currentState) => ({
    ...currentState,
    tmuxLayout: {
      ownedSession: true,
      targetSessionId,
      focusWindowId: `${targetSessionId}:0`,
    },
    members: currentState.members.map((member) => ({
      ...member,
      tmuxPaneId: focusPanesByMember[member.name] || member.tmuxPaneId,
    })),
  }), config)
}

async function createTeam(input: JsonObject, cwd: string, deps: TargetTeamDeps): Promise<RuntimeState> {
  const config = targetTeamConfig(cwd)
  const name = teamName(input)
  const members = parseMembers(input)
  assertEligible(members)
  const spec = createSpec(name, members)
  await ensureBaseDirs(resolveBaseDir(config))
  let runtimeState = await createRuntimeState(spec, "target-session", "project", config)
  runtimeState = await createWorktreeLayout(runtimeState, config)
  await ensureRuntimeDirectories(runtimeState, config)
  runtimeState = await activateTargetTmuxLayout(runtimeState, config, deps)
  runtimeState = await transitionRuntimeState(runtimeState.teamRunId, (currentState) => ({ ...currentState, status: "active" }), config)
  const index = await loadIndex(cwd)
  index[name] = runtimeState.teamRunId
  await saveIndex(cwd, index)
  return runtimeState
}

async function handleTeamTool(name: string, input: JsonObject, cwd: string, deps: TargetTeamDeps): Promise<unknown> {
  const config = targetTeamConfig(cwd)
  if (name === "team_create") return await createTeam(input, cwd, deps)
  if (name === "team_list") return await listActiveTeams(config)

  const runId = await resolveRunId(input, cwd, config)
  if (name === "team_status") return await loadRuntimeState(runId, config)
  if (name === "team_delete") {
    const deleted = await transitionRuntimeState(runId, (runtimeState) => ({ ...runtimeState, status: "deleting" }), config)
    return await transitionRuntimeState(deleted.teamRunId, (runtimeState) => ({ ...runtimeState, status: "deleted" }), config)
  }
  if (name === "team_send_message") {
    const runtimeState = await loadRuntimeState(runId, config)
    return await sendMessage({
      version: 1,
      messageId: randomUUID(),
      from: text(input.from) ?? "lead",
      to: text(input.to) ?? "*",
      kind: "message",
      body: text(input.body) ?? text(input.message) ?? "",
      timestamp: Date.now(),
    }, runId, config, {
      isLead: true,
      activeMembers: runtimeState.members.map((member) => member.name),
    })
  }
  if (name === "team_task_create") {
    return await createTask(runId, {
      subject: text(input.subject) ?? "task",
      description: text(input.description) ?? text(input.body) ?? "",
      status: "pending",
      blocks: [],
      blockedBy: [],
    }, config)
  }
  if (name === "team_task_list") return await listTasks(runId, config)
  if (name === "team_task_get") return await getTask(runId, String(input.task_id ?? input.taskId ?? ""), config)
  if (name === "team_task_update") {
    return await updateTaskStatus(
      runId,
      String(input.task_id ?? input.taskId ?? ""),
      (text(input.status) ?? "in_progress") as "pending" | "claimed" | "in_progress" | "completed" | "deleted",
      text(input.owner) ?? "lead",
      config,
    )
  }
  if (name === "team_shutdown_request") {
    return await transitionRuntimeState(runId, (runtimeState) => ({
      ...runtimeState,
      status: "shutdown_requested",
      shutdownRequests: [
        ...runtimeState.shutdownRequests,
        { memberId: text(input.member) ?? "lead", requesterName: text(input.requester) ?? "lead", requestedAt: Date.now() },
      ],
    }), config)
  }
  if (name === "team_approve_shutdown") {
    return await transitionRuntimeState(runId, (runtimeState) => ({
      ...runtimeState,
      shutdownRequests: runtimeState.shutdownRequests.map((request) => ({ ...request, approvedAt: request.approvedAt ?? Date.now() })),
    }), config)
  }
  if (name === "team_reject_shutdown") {
    return await transitionRuntimeState(runId, (runtimeState) => ({
      ...runtimeState,
      status: "active",
      shutdownRequests: runtimeState.shutdownRequests.map((request) => ({
        ...request,
        rejectedReason: text(input.reason) ?? "rejected",
        rejectedAt: request.rejectedAt ?? Date.now(),
      })),
    }), config)
  }
  return await loadRuntimeState(runId, config)
}

export function registerTargetTeamTools(options: {
  host: Exclude<HostKind, "opencode">
  registry: TargetToolRegistry
  cwd: string
  enabled?: boolean
  deps?: TargetTeamDeps
}): readonly TargetToolDefinition[] {
  if (options.enabled !== true) return []
  const deps = options.deps ?? DEFAULT_TEAM_DEPS
  const names = [
    "team_create", "team_delete", "team_send_message", "team_task_create", "team_task_list",
    "team_task_get", "team_task_update", "team_status", "team_list", "team_shutdown_request",
    "team_approve_shutdown", "team_reject_shutdown",
  ] as const
  return names.map((name) => {
    const tool: HostToolDefinition<JsonObject> = {
      name,
      label: name,
      description: `${name} manages target Team Mode runtime state, worktrees, and tmux layout.`,
      parameters: schema,
      execute: async ({ input }) => ({
        content: [{ type: "text", text: JSON.stringify(await handleTeamTool(name, input, options.cwd, deps), null, 2) }],
      }),
    }
    return registerTargetTool(options.registry, tool, {
      host: options.host,
      parameters: { kind: "json-schema", schema },
      createSessionContext: () => ({
        id: "target-session", cwd: options.cwd,
        actions: {
          sendUserMessage: async () => {}, sendInternalMessage: async () => {}, appendEntry: async () => {},
          getSessionName: () => undefined, setSessionName: async () => {}, getContextUsage: () => undefined,
          compact: async () => {}, abort: () => {}, isIdle: () => true, hasPendingMessages: () => false,
        },
      }),
    })
  })
}
