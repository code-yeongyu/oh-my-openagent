import { basename, dirname, join, sep } from "node:path"
import { readFileSync } from "node:fs"
import type { RpcSpawnSpec } from "../rpc/spawn"
import { MEMBER_IDENTITY_ENV, MEMBER_TASK_ID_ENV, MEMBER_TEAM_CONFIG_ENV } from "../../team/member-extension/identity"
import { SHARD_KEY_CONTEXT, TREE_KEY_CONTEXT } from "./shard-socket"

export interface ChildSessionContext {
  readonly kind: "worker"
  readonly context: Readonly<Record<string, string>>
}

/**
 * Derive per-child session context for daemon children: determines the role
 * (dag_child, member, or child), collects documented identity keys, and returns
 * an opaque context dict for the senpi daemon's session metadata.
 *
 * Returns ONLY plain identity strings: no env-looking keys pass through.
 * Forbidden pattern: /^(PATH|.*_API_KEY|SENPI_|OMO_|PI_)/
 */
export type ChildContextSpec = RpcSpawnSpec & {
  readonly treeKey?: string
  readonly shardKey?: string
}

export function buildChildContext(spec: ChildContextSpec): ChildSessionContext {
  const role = deriveRole(spec)
  const baseContext: Record<string, string> = {
    role,
    task_id: spec.task_id,
    state_dir: spec.state_dir,
    ...(spec.depth === undefined ? {} : { depth: String(spec.depth) }),
    ...(spec.root_session_id === undefined ? {} : { root_session_id: spec.root_session_id }),
  }

  if (spec.memberEnv !== undefined) {
    // Member: extract team_run_id and member_name from SENPI_TASK_MEMBER
    const identity = spec.memberEnv[MEMBER_IDENTITY_ENV]
    if (identity !== undefined) {
      const parts = identity.split("::")
      if (parts.length === 2) {
        const [teamRunId, memberName] = parts
        const teamConfig = spec.memberEnv[MEMBER_TEAM_CONFIG_ENV]
        if (teamRunId !== undefined && memberName !== undefined && teamConfig !== undefined) {
          baseContext.team_run_id = teamRunId
          baseContext.member_name = memberName
          baseContext.team_config = teamConfig
        }
      }
    }
  }

  if (spec.treeKey !== undefined) baseContext[TREE_KEY_CONTEXT] = spec.treeKey
  if (spec.shardKey !== undefined) baseContext[SHARD_KEY_CONTEXT] = spec.shardKey

  return {
    kind: "worker",
    context: baseContext,
  }
}

function deriveRole(spec: RpcSpawnSpec): string {
  // Member check: presence of memberEnv indicates a team member child
  if (spec.memberEnv !== undefined) {
    return "member"
  }

  // DAG check: read the task record to detect DAG ownership
  if (isDagOwnedChild(spec)) {
    return "dag_child"
  }

  // Default: plain child
  return "child"
}

/**
 * Check if this child is owned by a DAG node. This requires reading the task record
 * from disk, so it's extracted into a helper to allow testing and caching.
 */
function isDagOwnedChild(spec: RpcSpawnSpec): boolean {
  try {
    // The spec.state_dir is the senpi-task root. The task record lives at:
    // <state_dir>/tasks/<task_id>.json
    const stateDir = spec.state_dir
    const taskPath = join(stateDir, "tasks", `${spec.task_id}.json`)

    const content = readFileSync(taskPath, "utf8")
    const record = JSON.parse(content) as unknown

    if (typeof record !== "object" || record === null) return false
    if (!("owner" in record)) return false

    const owner = record.owner
    if (typeof owner !== "object" || owner === null) return false
    if (!("kind" in owner)) return false

    return owner.kind === "dag"
  } catch {
    // If we cannot read or parse the record, assume it's not a DAG child
    return false
  }
}

/**
 * The isolated, collision-free JSONL session path for a child, nested under
 * <stateDir>/sessions/<taskId>/. The path combines the ISO timestamp (UTC) and UUID
 * to ensure uniqueness across restarts and parallel children.
 *
 * Format: <stateDir>/sessions/<taskId>/<YYYY-MM-DDTHH-MM-SS.sssZ>_<uuid>.jsonl
 */
export function resolveChildSessionPath(
  stateDir: string,
  taskId: string,
  now: Date,
  uuid: string,
): string {
  // Windows has no legal filename containing ":", so the time part uses "-" and the
  // stamp stays lexicographically sortable.
  const stamp = now.toISOString().replaceAll(":", "-")
  const filename = `${stamp}_${uuid}.jsonl`
  return join(stateDir, "sessions", taskId, filename)
}
