import { describe, expect, test } from "bun:test"

import { discoverSharedSkills } from "."

// `<start-work-blocked-external>` is a machine-consumed sentinel, not prose: the Codex Stop hook
// greps for it in `hasAllowedExternalBlockerMarker()` and ends the turn when it appears. No
// OpenCode code path reads it - `handleAtlasSessionIdle()` decides purely from Boulder progress
// and tool iterations - so telling an OpenCode agent to emit it produces a stop that OpenCode
// ignores, and the continuation loop keeps going. The contract therefore belongs to the Codex
// channel only (the start-work-continuation component directive), never to the shared bundle
// that OpenCode loads verbatim.
const CODEX_ONLY_STOP_MARKER = "<start-work-blocked-external>"

describe("shared skills reaching the OpenCode harness", () => {
  test("#given the shared start-work skill #when OpenCode discovers it #then it carries no Codex-only stop marker", async () => {
    // given
    const sharedSkills = await discoverSharedSkills()
    const startWork = sharedSkills.find((skill) => skill.name === "start-work")

    // when
    const content = (await startWork?.lazyContent?.load()) ?? ""

    // then
    expect(startWork).toBeDefined()
    expect(content.length).toBeGreaterThan(0)
    expect(content).not.toContain(CODEX_ONLY_STOP_MARKER)
  })
})
