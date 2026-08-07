import { describe, expect, test } from "bun:test"

import { FakeExtensionAPI } from "../../../test-support/fake-extension-api"
import { createSkillInvocationTracker } from "./skill-invocation-tracker"

const CTX_A = { sessionManager: { getSessionId: () => "sess-a" } }
const CTX_B = { sessionManager: { getSessionId: () => "sess-b" } }

describe("createSkillInvocationTracker - plan-artifact reference counting", () => {
  function toolResult(toolName: string, input: Record<string, unknown>, isError = false) {
    return { type: "tool_result", toolCallId: "c9", toolName, input, content: [], isError }
  }

  test("#given three reads of plan A and one edit of plan B #when references are queried #then counts accumulate per path with the most-referenced first", async () => {
    // given
    const pi = new FakeExtensionAPI()
    const tracker = createSkillInvocationTracker(pi)

    // when
    await pi.dispatch("tool_result", toolResult("read", { path: "/repo/.omo/plans/alpha.md" }), CTX_A)
    await pi.dispatch("tool_result", toolResult("read", { path: "/repo/.omo/plans/alpha.md" }), CTX_A)
    await pi.dispatch("tool_result", toolResult("read", { path: "/repo/.omo/plans/alpha.md" }), CTX_A)
    await pi.dispatch("tool_result", toolResult("edit", { path: "/repo/.omo/plans/beta.md" }), CTX_A)

    // then
    const state = tracker.stateFor("sess-a")
    expect(state.hasPlanArtifact()).toBe(true)
    expect(state.planArtifactReferences()).toEqual([
      { path: "/repo/.omo/plans/alpha.md", count: 3, lastTouchedAt: 3 },
      { path: "/repo/.omo/plans/beta.md", count: 1, lastTouchedAt: 4 },
    ])
  })

  test("#given apply_patch events mentioning plan paths #when they arrive #then each distinct path counts once per event", async () => {
    // given
    const pi = new FakeExtensionAPI()
    const tracker = createSkillInvocationTracker(pi)
    const patch =
      "*** Begin Patch\n" +
      "*** Update File: .omo/plans/alpha.md\n" +
      "@@ see .omo/plans/alpha.md and .omo/plans/beta.md\n" +
      "*** End Patch"

    // when
    await pi.dispatch("tool_result", toolResult("apply_patch", { input: patch }), CTX_A)

    // then equal counts fall to the recency tie-break (beta touched later sorts first)
    expect(tracker.stateFor("sess-a").planArtifactReferences()).toEqual([
      { path: ".omo/plans/beta.md", count: 1, lastTouchedAt: 2 },
      { path: ".omo/plans/alpha.md", count: 1, lastTouchedAt: 1 },
    ])

    // when a second patch touches alpha again
    await pi.dispatch(
      "tool_result",
      toolResult("apply_patch", { input: "*** Begin Patch\n*** Delete File: .omo/plans/alpha.md\n*** End Patch" }),
      CTX_A,
    )

    // then alpha pulls ahead by count
    expect(tracker.stateFor("sess-a").planArtifactReferences()).toEqual([
      { path: ".omo/plans/alpha.md", count: 2, lastTouchedAt: 3 },
      { path: ".omo/plans/beta.md", count: 1, lastTouchedAt: 2 },
    ])
  })

  test("#given two plans touched once each #when references are queried #then the most recently touched wins the tie until one pulls ahead", async () => {
    // given
    const pi = new FakeExtensionAPI()
    const tracker = createSkillInvocationTracker(pi)

    // when
    await pi.dispatch("tool_result", toolResult("read", { path: "/repo/.omo/plans/alpha.md" }), CTX_A)
    await pi.dispatch("tool_result", toolResult("read", { path: "/repo/.omo/plans/beta.md" }), CTX_A)

    // then the recency tie-break puts beta first on a monotonically increasing sequence
    const tied = tracker.stateFor("sess-a").planArtifactReferences()
    expect(tied.map((ref) => ref.path)).toEqual(["/repo/.omo/plans/beta.md", "/repo/.omo/plans/alpha.md"])
    expect(tied[0]?.lastTouchedAt).toBeGreaterThan(tied[1]?.lastTouchedAt ?? 0)

    // when alpha is touched again
    await pi.dispatch("tool_result", toolResult("read", { path: "/repo/.omo/plans/alpha.md" }), CTX_A)

    // then count outranks recency
    expect(tracker.stateFor("sess-a").planArtifactReferences().map((ref) => [ref.path, ref.count])).toEqual([
      ["/repo/.omo/plans/alpha.md", 2],
      ["/repo/.omo/plans/beta.md", 1],
    ])
  })

  test("#given plan touches followed by session shutdown #when references are queried #then the map is cleared", async () => {
    // given
    const pi = new FakeExtensionAPI()
    const tracker = createSkillInvocationTracker(pi)
    await pi.dispatch("tool_result", toolResult("write", { path: ".omo/plans/x.md" }), CTX_A)

    // when
    await pi.dispatch("session_shutdown", {}, CTX_A)

    // then
    expect(tracker.stateFor("sess-a").planArtifactReferences()).toEqual([])
    expect(tracker.stateFor("sess-a").hasPlanArtifact()).toBe(false)
  })

  test("#given an unknown session id #when references are queried #then it reports none and no artifact", () => {
    // given
    const pi = new FakeExtensionAPI()
    const tracker = createSkillInvocationTracker(pi)

    // when / then
    expect(tracker.stateFor("sess-unknown").planArtifactReferences()).toEqual([])
    expect(tracker.stateFor("sess-unknown").hasPlanArtifact()).toBe(false)
  })

  test("#given windows and posix spellings of the same plan path #when both arrive #then they merge into one normalized reference", async () => {
    // given
    const pi = new FakeExtensionAPI()
    const tracker = createSkillInvocationTracker(pi)

    // when
    await pi.dispatch("tool_result", toolResult("read", { path: "C:\\repo\\.omo\\plans\\win.md" }), CTX_A)
    await pi.dispatch("tool_result", toolResult("read", { path: "C:/repo/.omo/plans/win.md" }), CTX_A)

    // then
    expect(tracker.stateFor("sess-a").planArtifactReferences()).toEqual([
      { path: "C:/repo/.omo/plans/win.md", count: 2, lastTouchedAt: 2 },
    ])
  })

  test("#given the same plan suffix under two worktree roots #when both arrive #then the roots stay distinct", async () => {
    // given
    const pi = new FakeExtensionAPI()
    const tracker = createSkillInvocationTracker(pi)

    // when
    await pi.dispatch("tool_result", toolResult("read", { path: "/wt/one/.omo/plans/a.md" }), CTX_A)
    await pi.dispatch("tool_result", toolResult("read", { path: "/wt/two/.omo/plans/a.md" }), CTX_A)

    // then
    const refs = tracker.stateFor("sess-a").planArtifactReferences()
    expect(refs).toHaveLength(2)
    expect(refs.every((ref) => ref.count === 1)).toBe(true)
    expect(refs.map((ref) => ref.path).sort()).toEqual(["/wt/one/.omo/plans/a.md", "/wt/two/.omo/plans/a.md"])
  })
})
