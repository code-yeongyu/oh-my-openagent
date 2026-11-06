import { existsSync } from "node:fs"

import { getBoulderFilePath, getWorkForSession, readBoulderState, type BoulderWorkStatus } from "@oh-my-opencode/boulder-state"

/**
 * Tells the engine's session lifecycle (senpi#3864) when this session's own ulw-execute work reaches its stop
 * condition, so the epoch's `done` reads `completion.kind = "run"` (#10782 item 5).
 *
 * Only a transition this session observed counts: the work was `active` or `paused` here (or did not exist yet when
 * the session first looked), and is now `completed`. A work that was already completed the first time this session
 * saw it was finished by an earlier run and is not this epoch's completion; `abandoned` and `paused` are not
 * completions at all. Each work id is reported once per session; the engine also ignores a repeated run id.
 *
 * A `boulder.json` that exists but cannot be read is an unknown state, not "no work": it neither marks nor counts as
 * the session's first look, so an inherited completion behind an unreadable first read is never mistaken for one
 * that appeared during the session. The first look is tracked per (cwd, session).
 */
export interface RunCompletionTracker {
  observe(cwd: string, sessionId: string): void
}

export function createRunCompletionTracker(markRunCompleted: (runId: string) => void): RunCompletionTracker {
  const lastSeen = new Map<string, BoulderWorkStatus>()
  const reported = new Set<string>()
  const looked = new Set<string>()

  return {
    observe(cwd, sessionId) {
      if (existsSync(getBoulderFilePath(cwd)) && readBoulderState(cwd) === null) return
      const work = getWorkForSession(cwd, `senpi:${sessionId}`)
      const lookKey = `${cwd}\0${sessionId}`
      const firstLook = !looked.has(lookKey)
      looked.add(lookKey)
      if (!work) return

      const status = work.status ?? "active"
      const previous = lastSeen.get(work.work_id)
      lastSeen.set(work.work_id, status)
      if (status !== "completed" || reported.has(work.work_id)) return

      const sawItRunning = previous === "active" || previous === "paused"
      const appearedDuringThisSession = previous === undefined && !firstLook
      if (!sawItRunning && !appearedDuringThisSession) return

      reported.add(work.work_id)
      markRunCompleted(`ulw-execute:${work.work_id}`)
    },
  }
}
