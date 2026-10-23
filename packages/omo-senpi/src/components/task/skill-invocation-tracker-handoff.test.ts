import { evaluateInvocationGuard } from "@oh-my-opencode/senpi-task"
import { describe, expect, test } from "bun:test"

import { FakeExtensionAPI } from "../../../test-support/fake-extension-api"
import { SESSION_HANDOFF_CAPACITY } from "./skill-invocation-handoff"
import { createSkillInvocationTracker } from "./skill-invocation-tracker"

function ctxFor(sessionId: string) {
  return { sessionManager: { getSessionId: () => sessionId } }
}

function inputEvent(text: string, source?: string) {
  return { type: "input", inputId: "sess:1", text, images: undefined, source, streamingBehavior: undefined }
}

function toolResult(toolName: string, input: Record<string, unknown>) {
  return { type: "tool_result", toolCallId: "c1", toolName, input, content: [], isError: false }
}

const HUMAN_REQUEST = "BAC-492 작업 전에 ulw-plan 으로 계획부터 세워줘"
const PLAN_PATH = "/repo/.omo/plans/bac-492.md"

async function openGate(pi: FakeExtensionAPI, sessionId: string): Promise<void> {
  await pi.dispatch("input", inputEvent(HUMAN_REQUEST), ctxFor(sessionId))
  await pi.dispatch("tool_result", toolResult("write", { path: PLAN_PATH }), ctxFor(sessionId))
}

function verdictFor(sessionId: string, pi: FakeExtensionAPI) {
  return evaluateInvocationGuard("plan-reviewer", createSkillInvocationTracker(pi).stateFor(sessionId))
}

describe("createSkillInvocationTracker - cross-generation handoff", () => {
  test("#given a live tracker #when the same tracker returns to a suspended session #then its gate remains open", async () => {
    // given
    const pi = new FakeExtensionAPI()
    const tracker = createSkillInvocationTracker(pi)
    await openGate(pi, "sess-same-tracker")
    // when
    await pi.dispatch("session_shutdown", { type: "session_shutdown", reason: "resume" }, ctxFor("sess-same-tracker"))
    // then
    expect(evaluateInvocationGuard("plan-reviewer", tracker.stateFor("sess-same-tracker"))).toEqual({ kind: "allow" })
  })

  test("#given a human ulw-plan request and a plan artifact #when a reload rebuilds the tracker for the same session #then plan-reviewer stays spawnable", async () => {
    // given
    const retiring = new FakeExtensionAPI()
    const tracker = createSkillInvocationTracker(retiring)
    await openGate(retiring, "sess-reload")
    expect(evaluateInvocationGuard("plan-reviewer", tracker.stateFor("sess-reload"))).toEqual({ kind: "allow" })

    // when
    await retiring.dispatch("session_shutdown", { type: "session_shutdown", reason: "reload" }, ctxFor("sess-reload"))

    // then
    const rebuilt = new FakeExtensionAPI()
    const state = createSkillInvocationTracker(rebuilt).stateFor("sess-reload")
    expect(state.hasUserRequested("ulw-plan")).toBe(true)
    expect(state.hasPlanArtifact()).toBe(true)
    expect(state.planArtifactReferences().map((reference) => [reference.path, reference.count])).toEqual([[PLAN_PATH, 1]])
    expect(evaluateInvocationGuard("plan-reviewer", state)).toEqual({ kind: "allow" })
  })

  test("#given the session set aside for another one #when the user returns to it #then the gate is still open", async () => {
    // given
    const retiring = new FakeExtensionAPI()
    createSkillInvocationTracker(retiring)
    await openGate(retiring, "sess-resume")

    // when
    await retiring.dispatch("session_shutdown", { type: "session_shutdown", reason: "resume" }, ctxFor("sess-resume"))

    // then
    expect(verdictFor("sess-resume", new FakeExtensionAPI())).toEqual({ kind: "allow" })
  })

  test("#given a retired session #when a later generation serves the same session id #then the gate is closed again", async () => {
    // given
    const retiring = new FakeExtensionAPI()
    createSkillInvocationTracker(retiring)
    await openGate(retiring, "sess-quit")

    // when
    await retiring.dispatch("session_shutdown", { type: "session_shutdown", reason: "quit" }, ctxFor("sess-quit"))

    // then
    expect(verdictFor("sess-quit", new FakeExtensionAPI()).kind).toBe("deny")
  })

  test("#given a shutdown whose reason the host does not report #when a later generation serves the same session #then the gate is closed again", async () => {
    // given
    const retiring = new FakeExtensionAPI()
    createSkillInvocationTracker(retiring)
    await openGate(retiring, "sess-no-reason")

    // when
    await retiring.dispatch("session_shutdown", {}, ctxFor("sess-no-reason"))

    // then
    expect(verdictFor("sess-no-reason", new FakeExtensionAPI()).kind).toBe("deny")
  })

  test("#given only extension-injected text requesting ulw-plan #when a reload rebuilds the tracker #then the gate stays closed", async () => {
    // given
    const retiring = new FakeExtensionAPI()
    createSkillInvocationTracker(retiring)
    await retiring.dispatch("input", inputEvent(HUMAN_REQUEST, "extension"), ctxFor("sess-injected"))
    await retiring.dispatch("tool_result", toolResult("write", { path: PLAN_PATH }), ctxFor("sess-injected"))

    // when
    await retiring.dispatch("session_shutdown", { type: "session_shutdown", reason: "reload" }, ctxFor("sess-injected"))

    // then
    const state = createSkillInvocationTracker(new FakeExtensionAPI()).stateFor("sess-injected")
    expect(state.hasUserRequested("ulw-plan")).toBe(false)
    expect(evaluateInvocationGuard("plan-reviewer", state).kind).toBe("deny")
  })

  test("#given ulw-execute already invoked #when a reload rebuilds the tracker #then the forbidding verdict survives", async () => {
    // given
    const retiring = new FakeExtensionAPI()
    createSkillInvocationTracker(retiring)
    await openGate(retiring, "sess-executing")
    await retiring.dispatch(
      "tool_result",
      toolResult("read", { path: "/repo/plugin/skills/ulw-execute/SKILL.md" }),
      ctxFor("sess-executing"),
    )

    // when
    await retiring.dispatch("session_shutdown", { type: "session_shutdown", reason: "reload" }, ctxFor("sess-executing"))

    // then
    const verdict = evaluateInvocationGuard(
      "plan-reviewer",
      createSkillInvocationTracker(new FakeExtensionAPI()).stateFor("sess-executing"),
    )
    expect(verdict.kind).toBe("deny")
    expect(verdict.kind === "deny" && verdict.message).toContain("ulw-execute skill was already invoked")
  })

  test("#given a handoff adopted by a rebuilt generation #when a third generation queries the session without another shutdown #then the record is gone", async () => {
    // given
    const retiring = new FakeExtensionAPI()
    createSkillInvocationTracker(retiring)
    await openGate(retiring, "sess-taken")
    await retiring.dispatch("session_shutdown", { type: "session_shutdown", reason: "reload" }, ctxFor("sess-taken"))
    expect(verdictFor("sess-taken", new FakeExtensionAPI())).toEqual({ kind: "allow" })

    // when
    const verdict = verdictFor("sess-taken", new FakeExtensionAPI())

    // then
    expect(verdict.kind).toBe("deny")
  })

  test("#given a session reloaded twice #when the third generation serves it #then the gate is still open", async () => {
    // given
    const first = new FakeExtensionAPI()
    createSkillInvocationTracker(first)
    await openGate(first, "sess-twice")
    await first.dispatch("session_shutdown", { type: "session_shutdown", reason: "reload" }, ctxFor("sess-twice"))
    const second = new FakeExtensionAPI()
    expect(evaluateInvocationGuard("plan-reviewer", createSkillInvocationTracker(second).stateFor("sess-twice"))).toEqual({ kind: "allow" })

    // when
    await second.dispatch("session_shutdown", { type: "session_shutdown", reason: "reload" }, ctxFor("sess-twice"))

    // then
    expect(verdictFor("sess-twice", new FakeExtensionAPI())).toEqual({ kind: "allow" })
  })

  test("#given more sessions set aside than the store holds #when the oldest is revisited #then its record was evicted and the newest survives", async () => {
    // given
    const retiring = new FakeExtensionAPI()
    createSkillInvocationTracker(retiring)
    const ids = Array.from({ length: SESSION_HANDOFF_CAPACITY + 1 }, (_, index) => `sess-cap-${index}`)
    for (const id of ids) {
      await openGate(retiring, id)
      await retiring.dispatch("session_shutdown", { type: "session_shutdown", reason: "new" }, ctxFor(id))
    }

    // when
    const oldest = verdictFor(ids[0] ?? "", new FakeExtensionAPI())
    const newest = verdictFor(ids[ids.length - 1] ?? "", new FakeExtensionAPI())

    // then
    expect(oldest.kind).toBe("deny")
    expect(newest).toEqual({ kind: "allow" })
  })

  test("#given a handed-off session #when another session is queried in the rebuilt generation #then it stays locked", async () => {
    // given
    const retiring = new FakeExtensionAPI()
    createSkillInvocationTracker(retiring)
    await openGate(retiring, "sess-owner")

    // when
    await retiring.dispatch("session_shutdown", { type: "session_shutdown", reason: "reload" }, ctxFor("sess-owner"))

    // then
    expect(verdictFor("sess-other", new FakeExtensionAPI()).kind).toBe("deny")
  })
})
