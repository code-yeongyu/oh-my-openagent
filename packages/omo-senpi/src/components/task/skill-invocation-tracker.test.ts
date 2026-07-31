import { describe, expect, test } from "bun:test"

import { FakeExtensionAPI } from "../../../test-support/fake-extension-api"
import { createSkillInvocationTracker } from "./skill-invocation-tracker"

const CTX_A = { sessionManager: { getSessionId: () => "sess-a" } }
const CTX_B = { sessionManager: { getSessionId: () => "sess-b" } }

function readResult(path: string, isError = false) {
  return { type: "tool_result", toolCallId: "c1", toolName: "read", input: { path }, content: [], isError }
}

describe("createSkillInvocationTracker", () => {
  test("#given a read of an ulw-plan SKILL.md #when the tool result arrives #then the session has invoked ulw-plan", async () => {
    // given
    const pi = new FakeExtensionAPI()
    const tracker = createSkillInvocationTracker(pi)

    // when
    await pi.dispatch("tool_result", readResult("/repo/packages/omo-senpi/plugin/skills/ulw-plan/SKILL.md"), CTX_A)

    // then
    expect(tracker.stateFor("sess-a").hasInvoked("ulw-plan")).toBe(true)
    expect(tracker.stateFor("sess-a").hasInvoked("start-work")).toBe(false)
  })

  test("#given a read of a start-work SKILL.md #when the tool result arrives #then the session has invoked start-work", async () => {
    // given
    const pi = new FakeExtensionAPI()
    const tracker = createSkillInvocationTracker(pi)

    // when
    await pi.dispatch("tool_result", readResult("/home/u/.senpi/agent/skills/start-work/SKILL.md"), CTX_A)

    // then
    expect(tracker.stateFor("sess-a").hasInvoked("start-work")).toBe(true)
  })

  test("#given a read of a non-skill file #when the tool result arrives #then nothing is recorded", async () => {
    // given
    const pi = new FakeExtensionAPI()
    const tracker = createSkillInvocationTracker(pi)

    // when
    await pi.dispatch("tool_result", readResult("/repo/src/skills-notes.md"), CTX_A)
    await pi.dispatch("tool_result", readResult("/repo/src/SKILL.md"), CTX_A)

    // then
    expect(tracker.stateFor("sess-a").hasInvoked("ulw-plan")).toBe(false)
  })

  test("#given a failed read of a skill file #when the tool result arrives #then nothing is recorded", async () => {
    // given
    const pi = new FakeExtensionAPI()
    const tracker = createSkillInvocationTracker(pi)

    // when
    await pi.dispatch("tool_result", readResult("/repo/plugin/skills/ulw-plan/SKILL.md", true), CTX_A)

    // then
    expect(tracker.stateFor("sess-a").hasInvoked("ulw-plan")).toBe(false)
  })

  test("#given a non-read tool result naming a skill path #when it arrives #then nothing is recorded", async () => {
    // given
    const pi = new FakeExtensionAPI()
    const tracker = createSkillInvocationTracker(pi)

    // when
    await pi.dispatch(
      "tool_result",
      { type: "tool_result", toolCallId: "c2", toolName: "grep", input: { path: "/repo/plugin/skills/ulw-plan/SKILL.md" }, content: [], isError: false },
      CTX_A,
    )

    // then
    expect(tracker.stateFor("sess-a").hasInvoked("ulw-plan")).toBe(false)
  })

  test("#given a slash skill input #when the input arrives #then the named skill is recorded", async () => {
    // given
    const pi = new FakeExtensionAPI()
    const tracker = createSkillInvocationTracker(pi)

    // when
    await pi.dispatch("input", { text: "/skill:ulw-plan plan the auth refactor" }, CTX_A)

    // then
    expect(tracker.stateFor("sess-a").hasInvoked("ulw-plan")).toBe(true)
  })

  test("#given a plain input mentioning a skill #when the input arrives #then nothing is recorded", async () => {
    // given
    const pi = new FakeExtensionAPI()
    const tracker = createSkillInvocationTracker(pi)

    // when
    await pi.dispatch("input", { text: "should we use ulw-plan for this?" }, CTX_A)

    // then
    expect(tracker.stateFor("sess-a").hasInvoked("ulw-plan")).toBe(false)
  })

  test("#given an invocation in session A #when session B is queried #then it stays locked", async () => {
    // given
    const pi = new FakeExtensionAPI()
    const tracker = createSkillInvocationTracker(pi)

    // when
    await pi.dispatch("tool_result", readResult("/repo/plugin/skills/ulw-plan/SKILL.md"), CTX_A)

    // then
    expect(tracker.stateFor("sess-a").hasInvoked("ulw-plan")).toBe(true)
    expect(tracker.stateFor("sess-b").hasInvoked("ulw-plan")).toBe(false)
  })

  test("#given an invocation followed by session shutdown #when the session is queried #then the state is dropped", async () => {
    // given
    const pi = new FakeExtensionAPI()
    const tracker = createSkillInvocationTracker(pi)
    await pi.dispatch("tool_result", readResult("/repo/plugin/skills/ulw-plan/SKILL.md"), CTX_A)

    // when
    await pi.dispatch("session_shutdown", {}, CTX_A)

    // then
    expect(tracker.stateFor("sess-a").hasInvoked("ulw-plan")).toBe(false)
  })

  test("#given a windows-style skill path #when the tool result arrives #then the skill is recorded", async () => {
    // given
    const pi = new FakeExtensionAPI()
    const tracker = createSkillInvocationTracker(pi)

    // when
    await pi.dispatch("tool_result", readResult("C:\\repo\\plugin\\skills\\ulw-plan\\SKILL.md"), CTX_A)

    // then
    expect(tracker.stateFor("sess-a").hasInvoked("ulw-plan")).toBe(true)
  })
})
