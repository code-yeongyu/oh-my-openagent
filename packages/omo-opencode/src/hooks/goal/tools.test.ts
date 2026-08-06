import { describe, expect, test } from "bun:test"
import type { GoalController } from "./controller"
import { createGoalTools } from "./tools"
import type { Goal } from "./types"

function makeGoal(overrides?: Partial<Goal>): Goal {
  const now = Date.now()
  return {
    id: "g1",
    sessionID: "s1",
    objective: "Ship",
    status: "active",
    tokensUsed: 0,
    timeUsedSeconds: 0,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

function makeDeps(controller: Partial<GoalController> = {}, sessionID?: string) {
  return {
    controller: {
      setGoal: () => makeGoal(),
      getGoal: () => null,
      pauseGoal: () => null,
      resumeGoal: () => null,
      clearGoal: () => false,
      markComplete: () => null,
      accountUsage: () => null,
      updateTui: () => {},
      ...controller,
    } as GoalController,
    getSessionID: () => sessionID,
  }
}

describe("createGoalTools", () => {
  test("create_goal calls controller.setGoal with current session", async () => {
    const setGoal = (sessionID: string, objective: string) => makeGoal({ sessionID, objective })
    const deps = makeDeps({ setGoal }, "s1")
    const tools = createGoalTools(deps)

    const result = await tools.create_goal.execute({ objective: "Ship" }, {} as never)

    expect(result).toContain("Ship")
    expect(result).toContain('"status": "active"')
  })

  test("create_goal uses explicit session_id", async () => {
    const calls: [string, string][] = []
    const setGoal = (sessionID: string, objective: string) => {
      calls.push([sessionID, objective])
      return makeGoal()
    }
    const deps = makeDeps({ setGoal }, undefined)
    const tools = createGoalTools(deps)

    await tools.create_goal.execute({ objective: "Ship", session_id: "s2" }, {} as never)

    expect(calls).toEqual([["s2", "Ship"]])
  })

  test("create_goal errors without session", async () => {
    const deps = makeDeps({}, undefined)
    const tools = createGoalTools(deps)

    const result = await tools.create_goal.execute({ objective: "Ship" }, {} as never)

    expect(result).toContain("no session_id")
  })

  test("update_goal completes goal", async () => {
    const markCalls: string[] = []
    const markComplete = (sessionID: string) => {
      markCalls.push(sessionID)
      return makeGoal({ status: "complete" })
    }
    const getGoal = () => makeGoal({ status: "complete" })
    const deps = makeDeps({ markComplete, getGoal }, "s1")
    const tools = createGoalTools(deps)

    const result = await tools.update_goal.execute({ status: "complete" }, {} as never)

    expect(markCalls).toEqual(["s1"])
    expect(result).toContain('"status": "complete"')
  })

  test("update_goal changes objective", async () => {
    const setCalls: [string, string][] = []
    const setGoal = (sessionID: string, objective: string) => {
      setCalls.push([sessionID, objective])
      return makeGoal({ objective })
    }
    const getGoal = () => makeGoal({ objective: "New" })
    const deps = makeDeps({ setGoal, getGoal }, "s1")
    const tools = createGoalTools(deps)

    const result = await tools.update_goal.execute({ objective: "New" }, {} as never)

    expect(setCalls).toEqual([["s1", "New"]])
    expect(result).toContain("New")
  })

  test("get_goal returns current goal", async () => {
    const getCalls: string[] = []
    const getGoal = (sessionID: string) => {
      getCalls.push(sessionID)
      return makeGoal({ objective: "Read" })
    }
    const deps = makeDeps({ getGoal }, "s1")
    const tools = createGoalTools(deps)

    const result = await tools.get_goal.execute({}, {} as never)

    expect(getCalls).toEqual(["s1"])
    expect(result).toContain("Read")
  })

  test("get_goal returns null when absent", async () => {
    const deps = makeDeps({ getGoal: () => null }, "s1")
    const tools = createGoalTools(deps)

    const result = await tools.get_goal.execute({}, {} as never)

    expect(result).toContain('"goal": null')
  })
})
