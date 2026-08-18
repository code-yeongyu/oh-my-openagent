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

describe("createSkillInvocationTracker - user-request channel", () => {
  test("#given a plain user input asking for ulw plan #when it arrives #then it is recorded as a user request but not an invocation", async () => {
    // given
    const pi = new FakeExtensionAPI()
    const tracker = createSkillInvocationTracker(pi)

    // when
    await pi.dispatch("input", { text: "ulw plan \uc73c\ub85c \uc791\uc5c5\uacc4\ud68d\uc11c \ub9cc\ub4e4\uc5b4\uc918" }, CTX_A)

    // then
    expect(tracker.stateFor("sess-a").hasUserRequested("ulw-plan")).toBe(true)
    expect(tracker.stateFor("sess-a").hasInvoked("ulw-plan")).toBe(false)
  })

  test("#given a slash skill input #when it arrives #then it counts as both an invocation and a user request", async () => {
    // given
    const pi = new FakeExtensionAPI()
    const tracker = createSkillInvocationTracker(pi)

    // when
    await pi.dispatch("input", { text: "/skill:ulw-plan plan the auth refactor" }, CTX_A)

    // then
    expect(tracker.stateFor("sess-a").hasInvoked("ulw-plan")).toBe(true)
    expect(tracker.stateFor("sess-a").hasUserRequested("ulw-plan")).toBe(true)
  })

  test("#given an ulw-plan mention only inside an ultrawork-mode block #when the input arrives #then no user request is recorded", async () => {
    // given
    const pi = new FakeExtensionAPI()
    const tracker = createSkillInvocationTracker(pi)

    // when
    await pi.dispatch(
      "input",
      { text: "fix the login bug\n<ultrawork-mode>\nTrigger ONLY when a ulw-plan run produced a plan file.\n</ultrawork-mode>" },
      CTX_A,
    )

    // then
    expect(tracker.stateFor("sess-a").hasUserRequested("ulw-plan")).toBe(false)
  })

  test("#given an ulw-plan mention only inside a system-reminder block #when the input arrives #then no user request is recorded", async () => {
    // given
    const pi = new FakeExtensionAPI()
    const tracker = createSkillInvocationTracker(pi)

    // when
    await pi.dispatch(
      "input",
      { text: "<system-reminder>senpi ulw-plan overrides pending</system-reminder>\ncontinue the migration" },
      CTX_A,
    )

    // then
    expect(tracker.stateFor("sess-a").hasUserRequested("ulw-plan")).toBe(false)
  })
})

describe("createSkillInvocationTracker - plan-artifact channel", () => {
  function toolResult(toolName: string, input: Record<string, unknown>, isError = false) {
    return { type: "tool_result", toolCallId: "c9", toolName, input, content: [], isError }
  }

  test("#given a write into a worktree .omo/plans file #when the tool result arrives #then the session has a plan artifact", async () => {
    // given
    const pi = new FakeExtensionAPI()
    const tracker = createSkillInvocationTracker(pi)

    // when
    await pi.dispatch("tool_result", toolResult("write", { path: "/repo/.local-ignore/worktrees/wt1/.omo/plans/feature.md" }), CTX_A)

    // then
    expect(tracker.stateFor("sess-a").hasPlanArtifact()).toBe(true)
    expect(tracker.stateFor("sess-b").hasPlanArtifact()).toBe(false)
  })

  test("#given an edit of a relative .omo/plans path #when the tool result arrives #then the artifact is recorded", async () => {
    // given
    const pi = new FakeExtensionAPI()
    const tracker = createSkillInvocationTracker(pi)

    // when
    await pi.dispatch("tool_result", toolResult("edit", { path: ".omo/plans/refactor.md" }), CTX_A)

    // then
    expect(tracker.stateFor("sess-a").hasPlanArtifact()).toBe(true)
  })

  test("#given a read of a plan file written by a planning child #when the tool result arrives #then the artifact is recorded", async () => {
    // given
    const pi = new FakeExtensionAPI()
    const tracker = createSkillInvocationTracker(pi)

    // when
    await pi.dispatch("tool_result", toolResult("read", { path: "/other/checkout/.omo/plans/child-authored.md" }), CTX_A)

    // then
    expect(tracker.stateFor("sess-a").hasPlanArtifact()).toBe(true)
  })

  test("#given an apply_patch whose patch body touches .omo/plans #when the tool result arrives #then the artifact is recorded", async () => {
    // given
    const pi = new FakeExtensionAPI()
    const tracker = createSkillInvocationTracker(pi)

    // when
    await pi.dispatch(
      "tool_result",
      toolResult("apply_patch", { input: "*** Begin Patch\n*** Add File: .omo/plans/release.md\n+# Plan\n*** End Patch" }),
      CTX_A,
    )

    // then
    expect(tracker.stateFor("sess-a").hasPlanArtifact()).toBe(true)
  })

  test("#given non-plan writes and failed plan writes #when the tool results arrive #then no artifact is recorded", async () => {
    // given
    const pi = new FakeExtensionAPI()
    const tracker = createSkillInvocationTracker(pi)

    // when
    await pi.dispatch("tool_result", toolResult("write", { path: "/repo/docs/plans.md" }), CTX_A)
    await pi.dispatch("tool_result", toolResult("write", { path: ".omo/plans/broken.md" }, true), CTX_A)
    await pi.dispatch("tool_result", toolResult("grep", { path: ".omo/plans/scan.md" }), CTX_A)

    // then
    expect(tracker.stateFor("sess-a").hasPlanArtifact()).toBe(false)
  })

  test("#given a recorded request and artifact followed by session shutdown #when queried #then all state is dropped", async () => {
    // given
    const pi = new FakeExtensionAPI()
    const tracker = createSkillInvocationTracker(pi)
    await pi.dispatch("input", { text: "ulw plan please" }, CTX_A)
    await pi.dispatch("tool_result", toolResult("write", { path: ".omo/plans/x.md" }), CTX_A)

    // when
    await pi.dispatch("session_shutdown", {}, CTX_A)

    // then
    expect(tracker.stateFor("sess-a").hasUserRequested("ulw-plan")).toBe(false)
    expect(tracker.stateFor("sess-a").hasPlanArtifact()).toBe(false)
  })
})

describe("createSkillInvocationTracker - own-words plan request", () => {
  // The ulw-plan SKILL.md contract (both editions) activates the workflow when the user says
  // ulw-plan/ulw plan/-skill:ulw-plan OR "asks in their own words for a work plan before coding".
  // The final clause had no implementation, so users who asked plainly got metis/momus denied.
  const OWN_WORDS: readonly string[] = [
    "plan this before coding",
    "make a plan first",
    "\uacc4\ud68d\ubd80\ud130 \uc138\uc6cc\uc918",
    "\uc791\uc5c5 \uacc4\ud68d\uc744 \uba3c\uc800 \uc138\uc6b0\uc790",
    "before you code, write a work plan",
  ]

  for (const text of OWN_WORDS) {
    test(`#given the user asks in their own words (${text}) #when the input arrives #then it counts as a user request`, async () => {
      // given
      const pi = new FakeExtensionAPI()
      const tracker = createSkillInvocationTracker(pi)

      // when
      await pi.dispatch("input", { type: "input", text, source: "interactive" }, CTX_A)

      // then
      expect(tracker.stateFor("sess-a").hasUserRequested("ulw-plan")).toBe(true)
    })
  }

  test("#given an ordinary work instruction with no plan request #when the input arrives #then no user request is recorded", async () => {
    // given
    const pi = new FakeExtensionAPI()
    const tracker = createSkillInvocationTracker(pi)

    // when
    for (const text of ["fix the login bug", "\ubc84\uadf8 \uace0\uccd0\uc918", "run the tests and report", "what does this function do?"]) {
      await pi.dispatch("input", { type: "input", text, source: "interactive" }, CTX_A)
    }

    // then
    expect(tracker.stateFor("sess-a").hasUserRequested("ulw-plan")).toBe(false)
  })

  // A pasted transcript that MENTIONS plan-writing as a noun ("\uacc4\ud68d \uc791\uc131\uae4c\uc9c0\ub9cc \ud5c8\uac00") is not a
  // request to plan. Found by auditing the matcher against 687 real user messages: it was the only
  // false positive, and it armed the gate off the agent's own quoted output.
  test("#given a pasted transcript merely mentioning plan writing #when the input arrives #then no user request is recorded", async () => {
    // given
    const pi = new FakeExtensionAPI()
    const tracker = createSkillInvocationTracker(pi)

    // when
    await pi.dispatch(
      "input",
      {
        type: "input",
        text: "\uc2b9\uc778\uc740 \uacc4\ud68d \uc791\uc131\uae4c\uc9c0\ub9cc \ud5c8\uac00\ud558\ub294 \uac83\uc774\uace0, \uc2e4\ud589\uc740 \ubcc4\ub3c4\ub85c /start-work\ub85c \uc2dc\uc791\ud569\ub2c8\ub2e4",
        source: "interactive",
      },
      CTX_A,
    )

    // then
    expect(tracker.stateFor("sess-a").hasUserRequested("ulw-plan")).toBe(false)
  })

  test("#given an explicit korean request to write the plan #when the input arrives #then it counts as a user request", async () => {
    // given
    const pi = new FakeExtensionAPI()
    const tracker = createSkillInvocationTracker(pi)

    // when
    await pi.dispatch("input", { type: "input", text: "\uacc4\ud68d \uc791\uc131\ud574\uc918", source: "interactive" }, CTX_A)

    // then
    expect(tracker.stateFor("sess-a").hasUserRequested("ulw-plan")).toBe(true)
  })

  test("#given a plan request inside an injected ultrawork block #when the input arrives #then no user request is recorded", async () => {
    // given
    const pi = new FakeExtensionAPI()
    const tracker = createSkillInvocationTracker(pi)

    // when
    await pi.dispatch(
      "input",
      { type: "input", text: "<ultrawork-mode>\nmake a plan first, then execute\n</ultrawork-mode>\nfix the bug", source: "interactive" },
      CTX_A,
    )

    // then
    expect(tracker.stateFor("sess-a").hasUserRequested("ulw-plan")).toBe(false)
  })
})

describe("createSkillInvocationTracker - expanded skill block channel", () => {
  // senpi expands `-skill:ulw-plan` into an `<skill name="..." location="...">` block BEFORE the
  // input event fires, so the raw "-skill:" prefix never reaches this handler in practice. Arming
  // must key off the NAME ATTRIBUTE, never an incidental substring in some other skill's body.
  test("#given an expanded ulw-plan skill block #when the input arrives #then it counts as invocation and user request", async () => {
    // given
    const pi = new FakeExtensionAPI()
    const tracker = createSkillInvocationTracker(pi)

    // when
    await pi.dispatch(
      "input",
      {
        type: "input",
        text: '<skill name="ulw-plan" location="/Users/u/.bun/install/global/node_modules/omo-ai/plugin/skills/ulw-plan/SKILL.md"> References are relative to the skill dir.',
        source: "interactive",
      },
      CTX_A,
    )

    // then
    expect(tracker.stateFor("sess-a").hasUserRequested("ulw-plan")).toBe(true)
    expect(tracker.stateFor("sess-a").hasInvoked("ulw-plan")).toBe(true)
  })

  test("#given an expanded block for an unrelated skill whose body mentions ulw-plan #when it arrives #then the gate is not armed", async () => {
    // given
    const pi = new FakeExtensionAPI()
    const tracker = createSkillInvocationTracker(pi)

    // when
    await pi.dispatch(
      "input",
      {
        type: "input",
        text: '<skill name="review-work" location="/skills/review-work/SKILL.md"> Pairs with ulw-plan for planning.',
        source: "interactive",
      },
      CTX_A,
    )

    // then
    expect(tracker.stateFor("sess-a").hasUserRequested("ulw-plan")).toBe(false)
    expect(tracker.stateFor("sess-a").hasInvoked("ulw-plan")).toBe(false)
    expect(tracker.stateFor("sess-a").hasInvoked("review-work")).toBe(true)
  })

  // Real senpi expansion is `<skill name="X" ...>...body...</skill>` FOLLOWED BY the user's own
  // typed text. Recording the block name must not swallow that trailing text, or invoking any other
  // skill in the same message would hide a genuine plan request sitting right after it.
  test("#given another skill block followed by an own-words plan request #when it arrives #then both are recorded", async () => {
    // given
    const pi = new FakeExtensionAPI()
    const tracker = createSkillInvocationTracker(pi)

    // when
    await pi.dispatch(
      "input",
      {
        type: "input",
        text: '<skill name="review-work" location="/s/review-work/SKILL.md">\nreview the finished work.\n</skill>\n\nmake a plan first',
        source: "interactive",
      },
      CTX_A,
    )

    // then
    expect(tracker.stateFor("sess-a").hasInvoked("review-work")).toBe(true)
    expect(tracker.stateFor("sess-a").hasUserRequested("ulw-plan")).toBe(true)
  })

  test("#given an unrelated skill block whose body mentions ulw-plan and no trailing request #when it arrives #then the gate stays closed", async () => {
    // given
    const pi = new FakeExtensionAPI()
    const tracker = createSkillInvocationTracker(pi)

    // when
    await pi.dispatch(
      "input",
      {
        type: "input",
        text: '<skill name="review-work" location="/s/review-work/SKILL.md">\nPairs with ulw-plan. Run ulw plan first.\n</skill>\n\nreview the diff',
        source: "interactive",
      },
      CTX_A,
    )

    // then
    expect(tracker.stateFor("sess-a").hasUserRequested("ulw-plan")).toBe(false)
  })

  test("#given an expanded start-work skill block #when it arrives #then start-work counts as invoked for the forbids check", async () => {
    // given
    const pi = new FakeExtensionAPI()
    const tracker = createSkillInvocationTracker(pi)

    // when
    await pi.dispatch(
      "input",
      { type: "input", text: '<skill name="start-work" location="/skills/start-work/SKILL.md"> Execute the plan.', source: "interactive" },
      CTX_A,
    )

    // then
    expect(tracker.stateFor("sess-a").hasInvoked("start-work")).toBe(true)
  })
})

describe("createSkillInvocationTracker - agent-manufacturable sources stay closed", () => {
  // senpi marks extension-injected text with source "extension" (agent-session emitInput call sites).
  // An extension is code the model can drive, so that channel must never arm a security gate.
  test("#given an extension-sourced input naming ulw-plan #when it arrives #then no user request is recorded", async () => {
    // given
    const pi = new FakeExtensionAPI()
    const tracker = createSkillInvocationTracker(pi)

    // when
    await pi.dispatch("input", { type: "input", text: "ulw-plan please", source: "extension" }, CTX_A)

    // then
    expect(tracker.stateFor("sess-a").hasUserRequested("ulw-plan")).toBe(false)
  })

  test("#given an extension-sourced expanded skill block #when it arrives #then the gate is not armed", async () => {
    // given
    const pi = new FakeExtensionAPI()
    const tracker = createSkillInvocationTracker(pi)

    // when
    await pi.dispatch(
      "input",
      { type: "input", text: '<skill name="ulw-plan" location="/skills/ulw-plan/SKILL.md">', source: "extension" },
      CTX_A,
    )

    // then
    expect(tracker.stateFor("sess-a").hasUserRequested("ulw-plan")).toBe(false)
  })

  test("#given an interactive input with no explicit source #when it arrives #then it is treated as user input", async () => {
    // given
    const pi = new FakeExtensionAPI()
    const tracker = createSkillInvocationTracker(pi)

    // when
    await pi.dispatch("input", { text: "ulw plan for the refactor" }, CTX_A)

    // then
    expect(tracker.stateFor("sess-a").hasUserRequested("ulw-plan")).toBe(true)
  })
})
