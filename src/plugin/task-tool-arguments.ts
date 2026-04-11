import { randomUUID } from "node:crypto"

import { ULTRAWORK_VERIFICATION_PROMISE } from "../hooks/ralph-loop/constants"
import { readState, writeState } from "../hooks/ralph-loop/storage"
import { log } from "../shared"

import { resolveSessionAgent } from "./session-agent-resolver"
import type { PluginContext } from "./types"

export async function prepareTaskToolArguments(args: {
  ctx: PluginContext
  sessionID: string
  callID: string
  argsObject: Record<string, unknown>
}): Promise<void> {
  const { ctx, sessionID, callID, argsObject } = args
  const category = typeof argsObject.category === "string" ? argsObject.category : undefined
  const subagentType =
    typeof argsObject.subagent_type === "string" ? argsObject.subagent_type : undefined
  const resumeSessionID =
    typeof argsObject.session_id === "string" ? argsObject.session_id : undefined

  if (category) {
    argsObject.subagent_type = "sisyphus-junior"
  } else if (!subagentType && resumeSessionID) {
    const resolvedAgent = await resolveSessionAgent(ctx.client, resumeSessionID)
    argsObject.subagent_type = resolvedAgent ?? "continue"
  }

  maybeInjectUltraworkOracleVerification({
    directory: typeof ctx.directory === "string" ? ctx.directory : null,
    sessionID,
    callID,
    argsObject,
  })
}

function maybeInjectUltraworkOracleVerification(args: {
  directory: string | null
  sessionID: string
  callID: string
  argsObject: Record<string, unknown>
}): void {
  const { directory, sessionID, callID, argsObject } = args
  if (!directory) {
    return
  }

  const normalizedSubagentType =
    typeof argsObject.subagent_type === "string" ? argsObject.subagent_type : undefined
  const prompt = typeof argsObject.prompt === "string" ? argsObject.prompt : ""
  const loopState = readState(directory)
  const shouldInjectOracleVerification =
    normalizedSubagentType === "oracle"
    && loopState?.active === true
    && loopState.ultrawork === true
    && loopState.verification_pending === true
    && loopState.session_id === sessionID

  if (!shouldInjectOracleVerification) {
    return
  }

  const verificationAttemptId = randomUUID()
  log("[tool-execute-before] Injecting ULW oracle verification attempt", {
    sessionID,
    callID,
    verificationAttemptId,
    loopSessionID: loopState.session_id,
  })

  writeState(directory, {
    ...loopState,
    verification_attempt_id: verificationAttemptId,
    verification_session_id: undefined,
  })
  argsObject.run_in_background = false
  argsObject.prompt = buildUltraworkOracleVerificationPrompt(
    prompt,
    loopState.prompt,
    verificationAttemptId,
  )
}

function buildUltraworkOracleVerificationPrompt(
  prompt: string,
  originalTask: string,
  verificationAttemptId: string,
): string {
  const verificationPrompt = [
    "You are verifying the active ULTRAWORK loop result for this session.",
    "",
    "Original task:",
    originalTask,
    "",
    "Review the work skeptically and critically.",
    "Assume it may be incomplete, misleading, or subtly broken until the evidence proves otherwise.",
    "Look for missing scope, weak verification, process violations, hidden regressions, and any reason the task should NOT be considered complete.",
    "",
    `If the work is fully complete, end your response with <promise>${ULTRAWORK_VERIFICATION_PROMISE}</promise>.`,
    "If the work is not complete, explain the blocking issues clearly and DO NOT emit that promise.",
    "",
    `<ulw_verification_attempt_id>${verificationAttemptId}</ulw_verification_attempt_id>`,
  ].join("\n")

  return `${prompt ? `${prompt}\n\n` : ""}${verificationPrompt}`
}
