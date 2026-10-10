import { describe, expect, test } from "bun:test"

import { FakeExtensionAPI } from "../../../test-support/fake-extension-api"
import {
  createSkillInvocationStore,
  createSkillInvocationTracker,
  sharedSkillInvocationStore,
  SKILL_INVOCATION_STORE_KEY,
} from "./skill-invocation-tracker"

const CTX = { sessionManager: { getSessionId: () => "rereg-session" } }

// A config edit rebuilds the extension runtime for the same session: senpi emits session_shutdown with
// reason "reload" to the retiring runner and registers every component again. These cases drive the
// process-lifetime store both registrations default to, which is what the gate reads afterwards.
describe("createSkillInvocationTracker - component re-registration", () => {
  test("#given a user request for ulw-plan #when a reload re-registers the component #then the gate is still armed", async () => {
    // given
    const pi = new FakeExtensionAPI()
    const beforeReload = createSkillInvocationTracker(pi)

    // when
    await pi.dispatch("input", { text: "/skill:ulw-plan plan the auth refactor" }, CTX)
    await pi.dispatch("session_shutdown", { type: "session_shutdown", reason: "reload" }, CTX)
    const afterReload = createSkillInvocationTracker(new FakeExtensionAPI())

    // then
    expect(beforeReload.stateFor("rereg-session").hasUserRequested("ulw-plan")).toBe(true)
    expect(afterReload.stateFor("rereg-session").hasUserRequested("ulw-plan")).toBe(true)
    expect(afterReload.stateFor("rereg-session").hasInvoked("ulw-plan")).toBe(true)
    expect(afterReload.stateFor("rereg-session").hasInvoked("ulw-execute")).toBe(false)
  })

  test("#given a touched plan artifact #when a reload re-registers the component #then the gate still sees the artifact", async () => {
    // given
    const pi = new FakeExtensionAPI()
    const beforeReload = createSkillInvocationTracker(pi)

    // when
    await pi.dispatch(
      "tool_result",
      { type: "tool_result", toolCallId: "c1", toolName: "edit", input: { path: "/repo/.omo/plans/alpha.md" }, content: [], isError: false },
      CTX,
    )
    await pi.dispatch(
      "tool_result",
      { type: "tool_result", toolCallId: "c2", toolName: "read", input: { path: "/repo/.omo/plans/alpha.md" }, content: [], isError: false },
      CTX,
    )
    await pi.dispatch("session_shutdown", { type: "session_shutdown", reason: "reload" }, CTX)
    const afterReload = createSkillInvocationTracker(new FakeExtensionAPI())

    // then
    expect(beforeReload.stateFor("rereg-session").hasPlanArtifact()).toBe(true)
    expect(afterReload.stateFor("rereg-session").hasPlanArtifact()).toBe(true)
    expect(afterReload.stateFor("rereg-session").planArtifactReferences()).toEqual([
      { path: "/repo/.omo/plans/alpha.md", count: 2, lastTouchedAt: 2 },
    ])
  })

  test("#given an armed session #when it ends for a reason other than a reload #then the state is dropped", async () => {
    // given
    const pi = new FakeExtensionAPI()
    const armed = createSkillInvocationTracker(pi)
    const endedCtx = { sessionManager: { getSessionId: () => "ended-session" } }

    // when
    await pi.dispatch("input", { text: "/skill:ulw-plan plan the auth refactor" }, endedCtx)
    await pi.dispatch("session_shutdown", { type: "session_shutdown", reason: "new" }, endedCtx)

    // then
    expect(armed.stateFor("ended-session").hasUserRequested("ulw-plan")).toBe(false)
  })

  test("#given a tracker on its own store #when another registers on the process store #then neither store sees the other's evidence", async () => {
    // given
    const isolatedPi = new FakeExtensionAPI()
    const isolated = createSkillInvocationTracker(isolatedPi, createSkillInvocationStore())
    const processPi = new FakeExtensionAPI()
    const processWide = createSkillInvocationTracker(processPi)

    // when
    await isolatedPi.dispatch("input", { text: "/skill:ulw-plan plan the auth refactor" }, {
      sessionManager: { getSessionId: () => "isolated-session" },
    })
    await processPi.dispatch("input", { text: "/skill:ulw-plan plan the auth refactor" }, {
      sessionManager: { getSessionId: () => "process-session" },
    })

    // then
    expect(isolated.stateFor("isolated-session").hasUserRequested("ulw-plan")).toBe(true)
    expect(isolated.stateFor("process-session").hasUserRequested("ulw-plan")).toBe(false)
    expect(processWide.stateFor("process-session").hasUserRequested("ulw-plan")).toBe(true)
    expect(processWide.stateFor("isolated-session").hasUserRequested("ulw-plan")).toBe(false)
  })

  test("#given a store slot left by an older bundle #when the shared store is asked for #then a fresh store replaces it", () => {
    // given
    const planted = {
      revision: -1,
      invokedBySession: new Map([["sess-from-old-bundle", new Set(["ulw-plan"])]]),
      requestedBySession: new Map(),
      planTouchesBySession: new Map(),
      planTouchSequence: 0,
    }
    const registry = globalThis as unknown as Record<symbol, unknown>
    registry[SKILL_INVOCATION_STORE_KEY] = planted

    // when
    const store = sharedSkillInvocationStore()

    // then
    expect(store).not.toBe(planted)
    expect(createSkillInvocationTracker(new FakeExtensionAPI()).stateFor("sess-from-old-bundle").hasInvoked("ulw-plan")).toBe(
      false,
    )
  })
})
