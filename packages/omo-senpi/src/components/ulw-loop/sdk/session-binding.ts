import { dirname, isAbsolute, join } from "node:path"
import { normalizeUlwLoopSessionId } from "../../../../../omo-codex/plugin/components/ulw-loop/src/paths.js"
import { UlwLoopError } from "../../../../../omo-codex/plugin/components/ulw-loop/src/runtime.js"
import type { ToolkitContext } from "../../../../../omo-codex/plugin/components/ulw-loop/src/sdk.js"
import { readSessionFileCwd } from "./session-file-header"

export type SessionCwdSource = "PI_SESSION_CWD" | "PI_SESSION_FILE" | "process.cwd"

export interface SessionToolkitContext extends ToolkitContext {
  readonly cwdSource: SessionCwdSource
  readonly rawSessionId: string
  readonly goalStorePaths: readonly string[]
  readonly warnings: readonly string[]
}

type Env = Readonly<Record<string, string | undefined>>
const REMEDIATION = 'env("PI_SESSION_CWD", "<session cwd>")'

function bindCwd(env: Env, processCwd: () => string, warnings: string[]): { cwd: string; source: SessionCwdSource } {
  const pinned = env.PI_SESSION_CWD?.trim()
  if (pinned) return { cwd: pinned, source: "PI_SESSION_CWD" }
  const header = readSessionFileCwd(env.PI_SESSION_FILE)
  if ("cwd" in header) {
    warnings.push(`PI_SESSION_CWD is unset; bound the session cwd recorded in PI_SESSION_FILE (${header.cwd}). Re-pin it with env("PI_SESSION_CWD", "${header.cwd}") to silence this warning.`)
    return { cwd: header.cwd, source: "PI_SESSION_FILE" }
  }
  let cwd: string
  try {
    cwd = processCwd().trim()
  } catch (error) {
    throw new UlwLoopError(`PI_SESSION_CWD is required: ${header.problem}, and process.cwd() failed (${error instanceof Error ? error.message : String(error)}). Set ${REMEDIATION} in the kernel or restart the session.`, "ULW_LOOP_CWD_REQUIRED")
  }
  if (!cwd) throw new UlwLoopError(`PI_SESSION_CWD is required: ${header.problem}, and process.cwd() is empty. Set ${REMEDIATION} in the kernel or restart the session.`, "ULW_LOOP_CWD_REQUIRED")
  warnings.push(`PI_SESSION_CWD is unset and ${header.problem}; bound process.cwd() (${cwd}), which can differ from the session cwd on a shared host. Set ${REMEDIATION} to bind the session explicitly.`)
  return { cwd, source: "process.cwd" }
}

function goalStoreCandidates(env: Env, rawSessionId: string, cwd: string, warnings: string[]): string[] {
  const candidates: string[] = []
  const override = env.PI_GOAL_STORE_FILE
  const fileName = `${encodeURIComponent(rawSessionId)}.json`
  if (override && isAbsolute(override)) candidates.push(override)
  else {
    if (override) warnings.push("Ignoring relative PI_GOAL_STORE_FILE.")
    const sessionFile = env.PI_SESSION_FILE?.trim()
    if (sessionFile && isAbsolute(sessionFile)) candidates.push(join(dirname(sessionFile), "extensions", "goal", fileName))
  }
  candidates.push(join(cwd, ".omo", "goal", fileName))
  return [...new Set(candidates)]
}

export function toolkitContextFromEnv(env: Env = process.env, processCwd: () => string = () => process.cwd()): SessionToolkitContext {
  const rawSessionId = env.PI_SESSION_ID
  if (!rawSessionId?.trim()) throw new UlwLoopError("PI_SESSION_ID is required.", "ULW_LOOP_SESSION_ID_REQUIRED")
  const sessionId = normalizeUlwLoopSessionId(rawSessionId)
  if (sessionId === null) throw new UlwLoopError("PI_SESSION_ID is invalid.", "ULW_LOOP_SESSION_ID_INVALID")
  const warnings: string[] = []
  const { cwd, source } = bindCwd(env, processCwd, warnings)
  const goalStorePaths = goalStoreCandidates(env, rawSessionId, cwd, warnings)
  return { cwd, cwdSource: source, sessionId, rawSessionId, surface: "omo-senpi", goalStorePaths, warnings }
}
