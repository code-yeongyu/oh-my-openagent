import { COMPUTER_SKILL_NAME } from "@oh-my-opencode/senpi-desktop-tool/registration"
import type { ContributedSkill } from "../bundled-skills/contributed-skill"
import type { ComputerUseRuntime } from "./runtime-loader"

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
 * Wires the control-grant revocation events (#9651 B5b): a finished agent run and the session
 * shutdown each send `control.revoke` (idempotent, bounded, failure logged by the service).
 * `session.close` stays the backstop; a runtime that never started has no engine to revoke on,
 * and a component without a runtime (computer use unavailable) wires nothing.
 */
export function wireComputerControlEvents(pi: { on(event: string, handler: (payload: unknown, ctx?: unknown) => unknown | Promise<unknown>): void }, runtime: { started(): Promise<ComputerUseRuntime> | undefined } | undefined): void {
  if (runtime === undefined) return
  const revokeStarted = async (): Promise<void> => {
    const started = runtime.started()
    if (started === undefined) return
    await (await started).service.revokeControl()
  }
  pi.on("agent_end", async () => {
    await revokeStarted()
  })
  pi.on("session_shutdown", async () => {
    await revokeStarted()
  })
}
