import type { ComputerUseRuntime } from "./runtime-loader"

/**
 * Wires the control-grant revocation events (#9651 B5b): a finished agent run and the session
 * shutdown each send `control.revoke` (idempotent, bounded, failure logged by the service).
 * `session.close` stays the backstop; a runtime that never started has no engine to revoke on.
 */
export function wireComputerControlEvents(pi: { on(event: string, handler: (payload: unknown, ctx?: unknown) => unknown | Promise<unknown>): void }, runtime: { started(): Promise<ComputerUseRuntime> | undefined }): void {
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
