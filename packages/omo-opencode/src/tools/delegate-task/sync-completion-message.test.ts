import { describe, expect, test } from "bun:test"

import { buildRecoveredSyncTaskCompletion, buildSyncTaskCompletion } from "./sync-completion-message"
import type { ParentContext } from "./executor-types"
import type { DelegateTaskArgs } from "./types"

const ARGS: DelegateTaskArgs = {
  description: "Run scoped checks",
  prompt: "do the work",
  run_in_background: false,
  load_skills: [],
}

const PARENT_CONTEXT: ParentContext = { sessionID: "ses_parent", messageID: "msg_parent" }
const START_TIME = new Date(Date.now() - 5_000)

function completionInput(textContent: string) {
  return {
    activeSessionID: "ses_child",
    agentToUse: "explore",
    args: ARGS,
    effectiveCategoryModel: undefined,
    parentContext: PARENT_CONTEXT,
    startTime: START_TIME,
    textContent,
  }
}

describe("buildSyncTaskCompletion", () => {
  test("#given the child session reached a clean terminal finish #then the wrapper keeps the completed headline", () => {
    //#given
    const input = completionInput("All checks green.")

    //#when
    const output = buildSyncTaskCompletion({ ...input, endState: "completed" })

    //#then
    expect(output).toMatch(/^Task completed in /)
  })

  test("#given the child session ended mid-turn without a terminal finish (interrupted) #then the wrapper must not claim the task completed", () => {
    //#given
    const input = completionInput("Partial progress before the session was cut off.")

    //#when
    const output = buildSyncTaskCompletion({ ...input, endState: "interrupted" })

    //#then
    expect(output).toMatch(/^Task ended before completion/)
    expect(output).not.toContain("Task completed")
    expect(output).toContain("Partial progress before the session was cut off.")
  })

  test("#given the child session's final turn carries an error #then the wrapper reports failure instead of success", () => {
    //#given
    const input = completionInput("")

    //#when
    const output = buildSyncTaskCompletion({ ...input, endState: "failed" })

    //#then
    expect(output).toMatch(/^Task failed in /)
    expect(output).not.toContain("Task completed")
  })

  test("#given no endState is supplied by a legacy caller #then the wrapper keeps the historical completed wording", () => {
    //#given
    const input = completionInput("Done.")

    //#when
    const output = buildSyncTaskCompletion(input)

    //#then
    expect(output).toMatch(/^Task completed in /)
  })
})

describe("buildRecoveredSyncTaskCompletion", () => {
  test("#given a recovered result whose session ended cleanly #then the wrapper keeps the completed headline", () => {
    //#given
    const input = completionInput("Salvaged deliverable.")

    //#when
    const output = buildRecoveredSyncTaskCompletion({ ...input, endState: "completed" })

    //#then
    expect(output).toMatch(/^Task completed in /)
  })

  test("#given a recovered result whose session was interrupted mid-turn #then the wrapper must not claim the task completed", () => {
    //#given
    const input = completionInput("Salvaged partial deliverable.")

    //#when
    const output = buildRecoveredSyncTaskCompletion({ ...input, endState: "interrupted" })

    //#then
    expect(output).toMatch(/^Task ended before completion/)
    expect(output).not.toContain("Task completed")
  })

  test("#given a recovered result whose session errored #then the wrapper reports failure instead of success", () => {
    //#given
    const input = completionInput("")

    //#when
    const output = buildRecoveredSyncTaskCompletion({ ...input, endState: "failed" })

    //#then
    expect(output).toMatch(/^Task failed in /)
    expect(output).not.toContain("Task completed")
  })
})
