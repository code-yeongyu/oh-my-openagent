import { describe, expect, test } from "bun:test"

import { FakeExtensionAPI } from "../../../test-support/fake-extension-api"
import { createSkillInvocationTracker } from "./skill-invocation-tracker"

type Entry = { readonly type: string; readonly inputSource?: unknown; readonly message?: Record<string, unknown> }

function resumedCtx(sessionId: string, branch: readonly Entry[]) {
  return { sessionManager: { getSessionId: () => sessionId, getBranch: () => branch, getEntries: () => branch } }
}

function user(text: string, inputSource?: unknown): Entry {
  return {
    type: "message",
    ...(inputSource === undefined ? {} : { inputSource }),
    message: { role: "user", content: [{ type: "text", text }], timestamp: 1 },
  }
}

function toolCall(id: string, name: string, args: Record<string, unknown>): Entry {
  return {
    type: "message",
    message: { role: "assistant", content: [{ type: "toolCall", id, name, arguments: args }], timestamp: 1 },
  }
}

function toolResult(id: string, name: string, isError = false): Entry {
  return {
    type: "message",
    message: { role: "toolResult", toolCallId: id, toolName: name, content: [], isError, timestamp: 1 },
  }
}

const PLAN = "/repo/.omo/plans/feature.md"

describe("createSkillInvocationTracker - replay on session_start (omo#10378 2b)", () => {
  test("#given a resumed session whose typed input asked for ulw-plan and touched a plan #when session_start fires #then the gate is armed again", async () => {
    // given
    const pi = new FakeExtensionAPI()
    const tracker = createSkillInvocationTracker(pi)
    const branch = [
      user('<skill name="ulw-plan" location="/s/ulw-plan/SKILL.md">body</skill>\n\nplan the login fix', "interactive"),
      toolCall("c1", "write", { path: PLAN, content: "# plan" }),
      toolResult("c1", "write"),
    ]

    // when
    await pi.dispatch("session_start", { type: "session_start", reason: "resume" }, resumedCtx("sess-r", branch))

    // then
    const state = tracker.stateFor("sess-r")
    expect(state.hasUserRequested("ulw-plan")).toBe(true)
    expect(state.hasInvoked("ulw-plan")).toBe(true)
    expect(state.hasPlanArtifact()).toBe(true)
    expect(state.planArtifactReferences().map((ref) => ref.path)).toEqual([PLAN])
  })

  test("#given rpc and own-words requests #when replayed #then both count like the live input event", async () => {
    // given
    const pi = new FakeExtensionAPI()
    const tracker = createSkillInvocationTracker(pi)

    // when
    await pi.dispatch(
      "session_start",
      { type: "session_start", reason: "resume" },
      resumedCtx("sess-o", [user("make a plan before coding", "rpc")]),
    )

    // then
    expect(tracker.stateFor("sess-o").hasUserRequested("ulw-plan")).toBe(true)
  })

  test("#given an extension-injected request #when replayed #then it never arms the user-request channel", async () => {
    // given
    const pi = new FakeExtensionAPI()
    const tracker = createSkillInvocationTracker(pi)

    // when
    await pi.dispatch(
      "session_start",
      { type: "session_start", reason: "resume" },
      resumedCtx("sess-x", [user("/skill:ulw-plan please run ulw-plan", "extension")]),
    )

    // then
    expect(tracker.stateFor("sess-x").hasUserRequested("ulw-plan")).toBe(false)
    expect(tracker.stateFor("sess-x").hasInvoked("ulw-plan")).toBe(false)
  })

  test("#given forged or unrecognised sources #when replayed #then none of them is trusted", async () => {
    // given
    const pi = new FakeExtensionAPI()
    const tracker = createSkillInvocationTracker(pi)
    const forged = ["typed", "Interactive", "", "user", 1, true, { source: "interactive" }]

    // when
    for (const [index, source] of forged.entries()) {
      await pi.dispatch(
        "session_start",
        { type: "session_start", reason: "resume" },
        resumedCtx(`sess-forged-${index}`, [user("/skill:ulw-plan please run ulw-plan", source)]),
      )
    }

    // then
    for (const index of forged.keys()) expect(tracker.stateFor(`sess-forged-${index}`).hasUserRequested("ulw-plan")).toBe(false)
  })

  test("#given a source written on the message instead of the entry #when replayed #then it is not trusted", async () => {
    // given
    const pi = new FakeExtensionAPI()
    const tracker = createSkillInvocationTracker(pi)
    const onMessage: Entry = {
      type: "message",
      message: { role: "user", content: [{ type: "text", text: "ulw-plan this" }], timestamp: 1, inputSource: "interactive" },
    }

    // when
    await pi.dispatch("session_start", { type: "session_start", reason: "resume" }, resumedCtx("sess-msg", [onMessage]))

    // then
    expect(tracker.stateFor("sess-msg").hasUserRequested("ulw-plan")).toBe(false)
  })

  test("#given a user entry written without a source #when replayed #then it never arms the user-request channel", async () => {
    // given
    const pi = new FakeExtensionAPI()
    const tracker = createSkillInvocationTracker(pi)

    // when
    await pi.dispatch(
      "session_start",
      { type: "session_start", reason: "resume" },
      resumedCtx("sess-legacy", [user("ulw-plan this please")]),
    )

    // then
    expect(tracker.stateFor("sess-legacy").hasUserRequested("ulw-plan")).toBe(false)
  })

  test("#given an unsourced session with a skill read and an apply_patch plan touch #when replayed #then the tool-result channels still rebuild", async () => {
    // given
    const pi = new FakeExtensionAPI()
    const tracker = createSkillInvocationTracker(pi)
    const branch = [
      user("old engine input"),
      toolCall("r1", "read", { path: "/repo/plugin/skills/ulw-execute/SKILL.md" }),
      toolResult("r1", "read"),
      toolCall("p1", "apply_patch", { input: "*** Update File: .omo/plans/a.md\n@@\n-x\n+y" }),
      toolResult("p1", "apply_patch"),
    ]

    // when
    await pi.dispatch("session_start", { type: "session_start", reason: "resume" }, resumedCtx("sess-t", branch))

    // then
    const state = tracker.stateFor("sess-t")
    expect(state.hasInvoked("ulw-execute")).toBe(true)
    expect(state.planArtifactReferences().map((ref) => ref.path)).toEqual([".omo/plans/a.md"])
  })

  test("#given a failed plan write and a result with no matching call #when replayed #then neither counts", async () => {
    // given
    const pi = new FakeExtensionAPI()
    const tracker = createSkillInvocationTracker(pi)
    const branch = [
      toolCall("w1", "write", { path: PLAN }),
      toolResult("w1", "write", true),
      toolResult("orphan", "write"),
    ]

    // when
    await pi.dispatch("session_start", { type: "session_start", reason: "resume" }, resumedCtx("sess-f", branch))

    // then
    expect(tracker.stateFor("sess-f").hasPlanArtifact()).toBe(false)
  })

  test("#given a host whose session manager cannot read the branch #when session_start fires #then live state is kept, not wiped", async () => {
    // given
    const pi = new FakeExtensionAPI()
    const tracker = createSkillInvocationTracker(pi)
    const liveCtx = { sessionManager: { getSessionId: () => "sess-live" } }
    await pi.dispatch("input", { type: "input", text: "please ulw-plan this", source: "interactive" }, liveCtx)

    // when
    await pi.dispatch("session_start", { type: "session_start", reason: "reload" }, liveCtx)

    // then
    expect(tracker.stateFor("sess-live").hasUserRequested("ulw-plan")).toBe(true)
  })

  test("#given a reload handoff holding a typed request #when the rebuilt tracker replays an unsourced transcript #then the handed-off request is kept", async () => {
    // given
    const live = new FakeExtensionAPI()
    createSkillInvocationTracker(live)
    const liveCtx = { sessionManager: { getSessionId: () => "sess-handoff" } }
    await live.dispatch("input", { type: "input", text: "please ulw-plan this", source: "interactive" }, liveCtx)
    await live.dispatch("session_shutdown", { type: "session_shutdown", reason: "reload" }, liveCtx)
    const rebuilt = new FakeExtensionAPI()
    const tracker = createSkillInvocationTracker(rebuilt)

    // when
    await rebuilt.dispatch(
      "session_start",
      { type: "session_start", reason: "reload" },
      resumedCtx("sess-handoff", [user("please ulw-plan this"), toolCall("w9", "write", { path: PLAN }), toolResult("w9", "write")]),
    )

    // then
    const state = tracker.stateFor("sess-handoff")
    expect(state.hasUserRequested("ulw-plan")).toBe(true)
    expect(state.planArtifactReferences().map((ref) => ref.count)).toEqual([1])
  })

  test("#given session_start fires twice for one session #when replayed #then touch counts do not double", async () => {
    // given
    const pi = new FakeExtensionAPI()
    const tracker = createSkillInvocationTracker(pi)
    const ctx = resumedCtx("sess-2", [toolCall("e1", "edit", { path: PLAN }), toolResult("e1", "edit")])

    // when
    await pi.dispatch("session_start", { type: "session_start", reason: "resume" }, ctx)
    await pi.dispatch("session_start", { type: "session_start", reason: "reload" }, ctx)

    // then
    expect(tracker.stateFor("sess-2").planArtifactReferences().map((ref) => ref.count)).toEqual([1])
  })
})
