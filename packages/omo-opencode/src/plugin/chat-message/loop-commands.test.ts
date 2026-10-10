import { describe, expect, mock, test } from "bun:test"
import { AUTO_SLASH_COMMAND_TAG_OPEN } from "../../hooks/auto-slash-command/constants"
import { validateObjective } from "../../hooks/goal/validation"
import { handleGoalMessage } from "./loop-commands"

function setup(text: string, defaultGoal = false) {
  const goal = {
    setGoal: mock((_sessionID: string, objective: string) => ({ objective: validateObjective(objective), status: "active" })),
    getGoal: mock(() => null),
    pauseGoal: mock(() => null),
    resumeGoal: mock(() => null),
    clearGoal: mock(() => true),
    markComplete: mock(() => null),
  }
  const args = {
    hooks: { goal },
    input: { sessionID: "session-goal-regression" },
    output: { message: {}, parts: [{ type: "text", text }] },
    isFirstMessage: true,
    pluginConfig: { default_mode: { goal: defaultGoal }, git_master: {} },
    nativeGoalCommand: false,
  }
  return { goal, args, run: () => handleGoalMessage(args) }
}

describe("chat goal command boundary", () => {
  for (const text of ["ordinary request", "pause", "resume", "clear", "x".repeat(2708), "/goalkeeper"]) {
    test(`does not interpret ordinary chat (${text.slice(0, 24)}) as a command`, () => {
      const { goal, args, run } = setup(text)
      expect(run).not.toThrow()
      expect(goal.setGoal).not.toHaveBeenCalled()
      expect(goal.pauseGoal).not.toHaveBeenCalled()
      expect(goal.resumeGoal).not.toHaveBeenCalled()
      expect(goal.clearGoal).not.toHaveBeenCalled()
      expect(args.output.parts[0].text).toBe(text)
    })
  }

  test("explicit multiline objective excludes the command prefix", () => {
    const { goal, run } = setup(" /goal first line\nsecond line ")
    run()
    expect(goal.setGoal).toHaveBeenCalledWith("session-goal-regression", "first line\nsecond line")
  })

  for (const [command, method] of [["pause", "pauseGoal"], ["resume", "resumeGoal"], ["clear", "clearGoal"]] as const) {
    test(`explicit /goal ${command} remains a command`, () => {
      const { goal, run } = setup(`/goal ${command}`)
      run()
      expect(goal[method]).toHaveBeenCalledWith("session-goal-regression")
      expect(goal.setGoal).not.toHaveBeenCalled()
    })
  }

  test("bare /goal never auto-starts a literal command objective", () => {
    const { goal, run } = setup("/goal", true)
    run()
    expect(goal.setGoal).not.toHaveBeenCalled()
  })

  test("explicit oversized objectives still reject", () => {
    const { run } = setup(`/goal ${"x".repeat(2001)}`)
    expect(run).toThrow("Objective exceeds maximum length of 2000 characters")
  })

  test("automatic goal captures a short first message", () => {
    const { goal, run } = setup("  short objective  ", true)
    run()
    expect(goal.setGoal).toHaveBeenCalledWith("session-goal-regression", "short objective")
  })

  test("automatic goal skips an oversized message without changing user text", () => {
    const text = "x".repeat(2001)
    const { goal, args, run } = setup(text, true)
    expect(run).not.toThrow()
    expect(goal.setGoal).not.toHaveBeenCalled()
    expect(args.output.parts[0].text).toBe(text)
  })

  test("automatic goal does not capture later messages", () => {
    const { goal, args, run } = setup("later message", true)
    args.isFirstMessage = false
    run()
    expect(goal.setGoal).not.toHaveBeenCalled()
  })

  test("injected instructions are not captured as the automatic objective", () => {
    const { goal, args } = setup("injected instructions".repeat(200), true)
    handleGoalMessage({ ...args, originalPromptText: "original task" })
    expect(goal.setGoal).toHaveBeenCalledWith("session-goal-regression", "original task")
    expect(args.output.parts[0].text).toBe("injected instructions".repeat(200))
  })

  test("native command and expanded slash payload retain their early returns", () => {
    const native = setup("/goal objective")
    native.args.nativeGoalCommand = true
    native.run()
    expect(native.goal.setGoal).not.toHaveBeenCalled()
    const expanded = setup(`${AUTO_SLASH_COMMAND_TAG_OPEN}${"x".repeat(2708)}`, true)
    expanded.run()
    expect(expanded.goal.setGoal).not.toHaveBeenCalled()
  })
})
