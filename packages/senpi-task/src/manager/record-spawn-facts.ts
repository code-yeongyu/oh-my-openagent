import type { RpcSpawnSpec } from "../runners/types"
import { isSpawnSpecV1, type TaskRecord } from "../state"
import { isTerminalRecord, recordSpawnedPid } from "./manager-helpers"

type SpawnFacts = {
  readonly pid: number | undefined
  readonly sessionId: string | undefined
  readonly spawnSpec: RpcSpawnSpec | undefined
}

export function recordSpawnFacts(current: TaskRecord, facts: SpawnFacts): TaskRecord {
  if (isTerminalRecord(current)) return current
  const withPid = recordSpawnedPid(current, facts.pid) ?? current
  const withSession = facts.sessionId === undefined || facts.sessionId === current.child_session_id
    ? withPid
    : { ...withPid, child_session_id: facts.sessionId }

  if (
    facts.spawnSpec === undefined
    || (current.spawn_spec !== undefined && isSpawnSpecV1(current.spawn_spec))
  ) {
    return withSession
  }
  return {
    ...withSession,
    spawn_spec: {
      cwd: facts.spawnSpec.cwd,
      ...(facts.spawnSpec.extensions === undefined ? {} : { extensions: facts.spawnSpec.extensions }),
      ...(facts.spawnSpec.memberEnv === undefined ? {} : { member_env: facts.spawnSpec.memberEnv }),
    },
  }
}
