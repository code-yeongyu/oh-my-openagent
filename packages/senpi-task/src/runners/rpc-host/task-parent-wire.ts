import type { RunRef } from "../../pause/ports"
import { TaskParentControlError, type TaskParentWire } from "../task-parent-control"

/**
 * The engine RpcClient's run hold methods (senpi#3871). Optional: the pinned engine may predate
 * them, and a connection whose client lacks one refuses as `unsupported` (native pause unavailable).
 * Refusals arrive as thrown engine errors (`wrong_parent: ...`); a stale release is an answer.
 */
export type HostRunHoldClient = {
  setClientInfo?(width: number, capabilities?: string[]): Promise<void>
  pauseForRun?(owner: { parentSessionId: string; parentPauseSeq: number; runRef: RunRef }): Promise<unknown>
  resumeForRun?(request: { parentSessionId: string; parentPauseSeq: number; resumeId: string; childSeqCutoff: number }): Promise<unknown>
  holdInput?(input: { inputId: string; revision: number; text: string; parentSessionId?: string; origin?: "human" }): Promise<unknown>
  getState?(): Promise<unknown>
}

const WIDTH = 80

export function createHostTaskParentWire(client: HostRunHoldClient): TaskParentWire {
  const answer = async (run: () => Promise<unknown>) => {
    try {
      return { success: true as const, data: await run() }
    } catch (error) {
      if (error instanceof TaskParentControlError) throw error
      return { success: false as const, error: error instanceof Error ? error.message : String(error) }
    }
  }
  const unsupported = (): never => { throw new TaskParentControlError("unsupported") }
  return {
    width: WIDTH,
    send: command => {
      switch (command.type) {
        case "set_client_info": {
          const declare = client.setClientInfo
          return declare === undefined ? unsupported() : answer(() => declare.call(client, command.width, [...command.capabilities]))
        }
        case "pause_for_run": {
          const pause = client.pauseForRun
          return pause === undefined ? unsupported() : answer(() => pause.call(client, {
            parentSessionId: command.parentSessionId, parentPauseSeq: command.parentPauseSeq, runRef: command.runRef,
          }))
        }
        case "resume_for_run": {
          const resume = client.resumeForRun
          return resume === undefined ? unsupported() : answer(() => resume.call(client, {
            parentSessionId: command.parentSessionId, parentPauseSeq: command.parentPauseSeq,
            resumeId: command.resumeId, childSeqCutoff: command.childSeqCutoff,
          }))
        }
        case "hold_input": {
          const hold = client.holdInput
          return hold === undefined ? unsupported() : answer(() => hold.call(client, {
            inputId: command.inputId, revision: command.revision, text: command.text,
            parentSessionId: command.parentSessionId, origin: command.origin,
          }))
        }
        case "get_state": {
          const state = client.getState
          return state === undefined ? unsupported() : answer(() => state.call(client))
        }
      }
    },
  }
}
