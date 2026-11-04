import { COMPUTER_SKILL_NAME } from "@oh-my-opencode/senpi-desktop-tool/registration"
import type { ContributedSkill } from "../bundled-skills/contributed-skill"
import type { ComputerUseRuntime } from "./runtime-loader"

/** The registration shell's mutable state: the engine backend, telemetry context, and contributed skill. */
export interface ComputerComponentState {
  backend: string
  telemetryContext: unknown
  activationReported: boolean
  skill: ContributedSkill | undefined
}

export function initialComputerState(): ComputerComponentState {
  return { backend: "unavailable", telemetryContext: undefined, activationReported: false, skill: undefined }
}

export function skillStatusLine(skill: ContributedSkill | undefined): string {
  if (skill?.kind !== "yielded") return ""
  const where = skill.ownerPath === undefined ? "" : ` (${skill.ownerPath})`
  return `\nskill: your own ${COMPUTER_SKILL_NAME} skill is active in place of the built-in guide${where}`
}

export function toolActivatedNames(payload: unknown): readonly string[] {
  if (typeof payload !== "object" || payload === null) return []
  const names = (payload as { toolNames?: unknown }).toolNames
  return Array.isArray(names) ? names.filter((name): name is string => typeof name === "string") : []
}

/**
 * The lifecycle of the session that holds this component's grant. A fused session reports it through its loop
 * events; the hand of a split session gets no loop events, so its scope's run end and close arrive from the host
 * through another source.
 */
export interface ComputerLifecycleSource {
  onRunEnd(handler: () => Promise<void>): void
  onClose(handler: () => Promise<void>): void
}

export function hostLifecycleSource(pi: { on(event: string, handler: () => Promise<void>): void }): ComputerLifecycleSource {
  return {
    onRunEnd: (handler) => pi.on("agent_end", handler),
    onClose: (handler) => pi.on("session_shutdown", handler),
  }
}

/**
 * Wires the control-grant revocation events (#9651 B5b): a finished agent run and the session
 * close each send `control.revoke` (idempotent, bounded, failure logged by the service), and the
 * close then ends the engine session, which stays the backstop that always releases the grant.
 * A runtime that never started has no engine to revoke on or close, and a component without a
 * runtime (computer use unavailable) wires nothing.
 */
export function wireComputerControlEvents(lifecycle: ComputerLifecycleSource, runtime: { started(): Promise<ComputerUseRuntime> | undefined } | undefined): void {
  if (runtime === undefined) return
  const revokeStarted = async (): Promise<void> => {
    const started = runtime.started()
    if (started === undefined) return
    await (await started).service.revokeControl()
  }
  lifecycle.onRunEnd(revokeStarted)
  lifecycle.onClose(revokeStarted)
  lifecycle.onClose(async () => {
    const started = runtime.started()
    if (started !== undefined) await (await started).handle.close()
  })
}

/**
 * What `/computer` tells the user about a failure: the senpi user-facing `message` and `action` when the error
 * carries them (read structurally, so the lazily loaded engine classes stay out of this eager module).
 */
export function computerFailureText(error: Error): string {
  const userFacing: unknown = "userFacing" in error ? error.userFacing : undefined
  if (typeof userFacing !== "object" || userFacing === null) return error.message
  if (!("message" in userFacing) || typeof userFacing.message !== "string") return error.message
  const action = "action" in userFacing && typeof userFacing.action === "string" ? ` ${userFacing.action}` : ""
  return `${userFacing.message}${action}`
}
