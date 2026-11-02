import { NativePauseUnavailableError, type NativeRunPause } from "../../pause/native-child-pause"
import type { RunnerOutcome } from "../in-process/child-handle"
import { TaskParentControlError, type createTaskParentControl } from "../task-parent-control"

type TaskParentControl = ReturnType<typeof createTaskParentControl>

/**
 * An RPC child's run hold over its task_parent connection; `control` answers for the CURRENT
 * connection (a daemon child's port moves on reattach). A Resume turn the engine starts is CLAIMED
 * before the command goes out, so its agent_start re-arms this handle's turn tracking without
 * announcing a self-resumed run (which would reopen and complete the record twice).
 */
export function createRpcRunPause(input: {
  readonly taskId: string
  control(): TaskParentControl
  claimNextTurn(): () => void
  currentOutcome(): Promise<RunnerOutcome>
}): NativeRunPause {
  const unsupported = async <T>(run: (control: TaskParentControl) => Promise<T>): Promise<T> => {
    try {
      return await run(input.control())
    } catch (error) {
      if (error instanceof TaskParentControlError && error.code === "unsupported") throw new NativePauseUnavailableError(input.taskId)
      throw error
    }
  }
  return {
    pauseForRun: owner => unsupported(control => control.pauseForRun(owner)),
    async resumeForRun(request) {
      const releaseClaim = input.claimNextTurn()
      try {
        const receipt = await unsupported(control => control.resumeForRun(request))
        if (!receipt.released) {
          releaseClaim()
          return receipt
        }
        if (receipt.otherHoldLive === true || receipt.turnId === undefined) {
          releaseClaim()
          return { released: true, otherHoldLive: true }
        }
        // The engine answers after the turn's agent_start, which this connection already delivered.
        return { released: true, turnId: receipt.turnId, outcome: input.currentOutcome() }
      } catch (error) {
        releaseClaim()
        throw error
      }
    },
    holdInput: (parentSessionId, held) => unsupported(control => control.holdInput(parentSessionId, held)),
    observeHold: parentSessionId => unsupported(control => control.observeHold(parentSessionId)),
  }
}
