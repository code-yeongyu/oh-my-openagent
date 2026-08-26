import { describe, expect, test } from "bun:test"

import { discoverSharedSkills } from "."

// `<ulw-execute-blocked-external>` is a machine-consumed sentinel, not prose: the Codex Stop hook
// greps for it in `hasAllowedExternalBlockerMarker()` and ends the turn when it appears. No
// OpenCode code path reads it - `handleAtlasSessionIdle()` decides purely from Boulder progress
// and tool iterations - so telling an OpenCode agent to emit it produces a stop that OpenCode
// ignores, and the continuation loop keeps going. The contract therefore belongs to the Codex
// channel only (the ulw-execute-continuation component directive), never to the shared bundle
// that OpenCode loads verbatim.
const CODEX_ONLY_STOP_MARKER = "<ulw-execute-blocked-external>"

describe("shared skills reaching the OpenCode harness", () => {
  test("#given the shared ulw-execute skill #when OpenCode discovers it #then it carries no Codex-only stop marker", async () => {
    // given
    const sharedSkills = await discoverSharedSkills()
    const ulwExecute = sharedSkills.find((skill) => skill.name === "ulw-execute")

    // when
    const content = (await ulwExecute?.lazyContent?.load()) ?? ""

    // then
    expect(ulwExecute).toBeDefined()
    expect(content.length).toBeGreaterThan(0)
    expect(content).not.toContain(CODEX_ONLY_STOP_MARKER)
  })
})
