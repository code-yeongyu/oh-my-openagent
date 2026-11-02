import type { ChildCreationPort, ChildPausePort } from "../pause/ports"

/**
 * The production creation port: admission is checked again after the child exists, at the last
 * moment before its first turn.
 *
 * - Admission open: the first turn starts.
 * - Admission closed by a Stop: the child takes the run's hold (`pause_for_run`) and keeps its first
 *   prompt as held input, so the run's Resume starts it. A runner that can stage (create without
 *   prompting) never starts that turn at all; one that cannot has already sent the prompt, and the
 *   hold stops that turn.
 * - A child without native run hold cannot be held, so it starts as before and the Stop records it
 *   as lost.
 */
export function createStagedChildCreation(pause: ChildPausePort): ChildCreationPort {
  return {
    async startPaused(spec, runner, ticket) {
      const staged = runner.startStaged === undefined ? undefined : await runner.startStaged(spec)
      const child = staged?.child ?? await runner.start(spec)
      return {
        child,
        async activate() {
          const decision = ticket.commit()
          if (decision.kind === "launch" || child.runPause === undefined) {
            return staged?.begin() ?? { turnId: "initial", outcome: child.waitForOutcome() }
          }
          const ack = await pause.pauseForRun(child, decision.owner)
          if ("refused" in ack) throw new Error(`child ${spec.taskId} is held by another parent`)
          if (staged !== undefined) {
            const held = await pause.holdInput(child, { inputId: `${spec.taskId}:first-prompt`, revision: 0, text: staged.firstPrompt }, {
              parentSessionId: decision.owner.parentSessionId,
            })
            if (held.kind !== "held") throw new Error(`child ${spec.taskId} refused to hold its first prompt`)
          }
          return { kind: "paused", childSeq: ack.childSeq, owner: decision.owner }
        },
      }
    },
  }
}
