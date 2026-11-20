import { approveDevice } from "../memory-core/src/sync/account/index.ts"
import type { SyncCommandDependencies } from "./sync-cli"
import type { SyncContext } from "./sync-context"

export const spacedCode = (code: string): string => `${code.slice(0, 3)} ${code.slice(3)}`

export async function approve(
  dependencies: SyncCommandDependencies,
  context: SyncContext,
  requested: string | undefined,
): Promise<number> {
  if (!dependencies.interactive) {
    dependencies.error("Approving a device needs an interactive terminal, so you can compare the code on both screens.")
    return 1
  }
  const waiting = (await context.pairing.listPending()).filter((row) => row.answer === null)
  const chosen =
    requested === undefined
      ? waiting.length === 1
        ? waiting[0]
        : undefined
      : waiting.find((row) => row.id === requested)
  if (chosen === undefined) {
    if (waiting.length === 0)
      dependencies.error("No device is waiting to join. Run `omo sync enable` on the new device first.")
    else
      dependencies.error(
        `More than one device is waiting. Run \`omo sync approve <id>\` with one of: ${waiting.map((row) => row.id).join(", ")}`,
      )
    return 1
  }
  const outcome = await approveDevice({
    ...context,
    clock: dependencies.clock,
    pendingId: chosen.id,
    confirmCode: (code) => dependencies.confirm(`Does the other device show ${spacedCode(code)}?`),
  })
  switch (outcome.kind) {
    case "approved":
      dependencies.output("The device is approved and will start syncing.")
      return 0
    case "declined":
      dependencies.error(
        "Not approved. If the codes differed, someone may be intercepting the pairing; start again from the new device.",
      )
      return 1
    case "expired":
      dependencies.error("The request expired. Run `omo sync enable` on the new device again.")
      return 1
    case "refused":
      dependencies.error(`Not approved: ${outcome.reason}.`)
      return 1
  }
}
