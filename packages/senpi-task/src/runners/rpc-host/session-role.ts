import { isTeamMemberProcess } from "../../team/member-extension/identity"
import { OMO_SENPI_TASK_DEPTH, OMO_SENPI_TASK_ROOT_SESSION_ID, OMO_SENPI_TASK_RPC_CHILD } from "../rpc/spawn"

/**
 * The READER of what `buildChildContext` writes. One extension set serves every session of the
 * shared daemon, so a component asks THIS what the session in front of it is instead of reading
 * process-wide environment variables that belong to whoever launched the process.
 *
 * The environment stays a fallback for the per-child process runner (win32, the daemon's loud
 * fallback, and every pre-daemon child), where one process really is one child.
 */

export const SESSION_ROLES = ["child", "dag_child", "member"] as const

export type SessionRole = (typeof SESSION_ROLES)[number]

/** Session-context key of the throwaway session that warms a fresh task host (`host-warmup.ts`). */
export const HOST_WARMUP_CONTEXT = "host_warmup"

/** A host warm-up session: no user and no task behind it, so nothing may report it as a session. */
export function isHostWarmupSession(pi: unknown): boolean {
  return readSessionContext(pi)?.[HOST_WARMUP_CONTEXT] === "1"
}

/**
 * The per-session labels the opener attached (senpi `open_session.context` -> `pi.sessionContext`).
 * The argument is `unknown` on purpose: the pinned engine's `ExtensionAPI` predates the field, so
 * this IS the boundary that decides whether the running host reports one.
 */
export function readSessionContext(pi: unknown): Readonly<Record<string, string>> | undefined {
  if (typeof pi !== "object" || pi === null || !("sessionContext" in pi)) return undefined
  const context = pi.sessionContext
  if (typeof context !== "object" || context === null) return undefined
  const entries = Object.entries(context).flatMap(([key, value]) => (typeof value === "string" ? [[key, value] as const] : []))
  return entries.length === 0 ? undefined : Object.fromEntries(entries)
}

/**
 * Which omo-spawned role this session serves, or undefined for an ordinary interactive session.
 * An unrecognized future role reads as the plain `child`: it is still omo-spawned work, so the
 * gates that only ask "is this a child?" keep holding, and only the roles this build knows about
 * get their own narrower treatment.
 */
export function readSessionRole(pi: unknown, env: NodeJS.ProcessEnv = process.env): SessionRole | undefined {
  const role = readSessionContext(pi)?.["role"]
  if (role !== undefined && role.length > 0) return isSessionRole(role) ? role : "child"
  if (isTeamMemberProcess(env)) return "member"
  return env[OMO_SENPI_TASK_RPC_CHILD] === "1" ? "child" : undefined
}

/** Where an omo-spawned session sits in the task tree its root session started. */
export interface SessionAncestry {
  readonly depth: number
  readonly rootSessionId?: string
}

/**
 * This session's own task depth, read from the same two channels as its role: the daemon session
 * context, else the per-child process env. Undefined only for an ordinary top-level session. A
 * session known to be a child but launched without a depth (an older parent) reads as depth 1, never
 * 0: it IS one level down, and reading it as top-level is exactly the unbounded recursion of #9036.
 */
export function readSessionAncestry(pi: unknown, env: NodeJS.ProcessEnv = process.env): SessionAncestry | undefined {
  const context = readSessionContext(pi)
  const role = context?.["role"]
  if (role !== undefined && role.length > 0) return childAncestry(context?.["depth"], context?.["root_session_id"])
  if (!isTeamMemberProcess(env) && env[OMO_SENPI_TASK_RPC_CHILD] !== "1") return undefined
  return childAncestry(env[OMO_SENPI_TASK_DEPTH], env[OMO_SENPI_TASK_ROOT_SESSION_ID])
}

function childAncestry(depth: string | undefined, rootSessionId: string | undefined): SessionAncestry {
  const parsed = depth === undefined || depth.length === 0 ? Number.NaN : Number(depth)
  const resolved = Number.isInteger(parsed) && parsed >= 1 ? parsed : 1
  return rootSessionId === undefined || rootSessionId.length === 0 ? { depth: resolved } : { depth: resolved, rootSessionId }
}

/** The member identity the daemon carries on the session, in place of the per-process env trio. */
export interface MemberSessionIdentity {
  readonly teamRunId: string
  readonly memberName: string
  readonly teamConfig: string
  readonly taskId: string
  readonly stateDir: string
}

export function readMemberSessionIdentity(pi: unknown): MemberSessionIdentity | undefined {
  const context = readSessionContext(pi)
  if (context?.["role"] !== "member") return undefined
  const { team_run_id: teamRunId, member_name: memberName, team_config: teamConfig, task_id: taskId, state_dir: stateDir } = context
  if (teamRunId === undefined || memberName === undefined || teamConfig === undefined) return undefined
  if (taskId === undefined || stateDir === undefined) return undefined
  return { teamRunId, memberName, teamConfig, taskId, stateDir }
}

function isSessionRole(value: string): value is SessionRole {
  return SESSION_ROLES.some((role) => role === value)
}
