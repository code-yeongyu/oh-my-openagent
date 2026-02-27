import { describe, it, expect, mock } from "bun:test"

import {
  isCouncilMemberAgent,
  hasCouncilResponseTag,
  sendCouncilContinuationNudge,
  resetCouncilNudgeCount,
} from "./council-continuation-enforcer"
import type { BackgroundTask } from "./types"

function createRunningTask(overrides: Partial<BackgroundTask> = {}): BackgroundTask {
  return {
    id: "task-1",
    sessionID: "ses-council-1",
    parentSessionID: "parent-ses-1",
    parentMessageID: "msg-1",
    description: "council test",
    prompt: "test",
    agent: "Council: deep-1",
    status: "running",
    startedAt: new Date(),
    model: { providerID: "anthropic", modelID: "claude-opus-4-6" },
    progress: { lastUpdate: new Date(), toolCalls: 0 },
    ...overrides,
  }
}

function createMockClient() {
  return { session: { promptAsync: mock(() => Promise.resolve()) } }
}

describe("isCouncilMemberAgent", () => {
  describe('#given agent name starts with "Council: "', () => {
    it("#then should return true", () => {
      //#given
      const agentName = "Council: deep-1"

      //#when
      const result = isCouncilMemberAgent(agentName)

      //#then
      expect(result).toBe(true)
    })

    it("#when name has only the prefix #then should return true", () => {
      //#given
      const agentName = "Council: "

      //#when
      const result = isCouncilMemberAgent(agentName)

      //#then
      expect(result).toBe(true)
    })
  })

  describe("#given agent name does not start with the council prefix", () => {
    it('#when name is "explore" #then should return false', () => {
      //#given
      const agentName = "explore"

      //#when
      const result = isCouncilMemberAgent(agentName)

      //#then
      expect(result).toBe(false)
    })

    it('#when name is "oracle" #then should return false', () => {
      //#given
      const agentName = "oracle"

      //#when
      const result = isCouncilMemberAgent(agentName)

      //#then
      expect(result).toBe(false)
    })

    it('#when name is "sisyphus" #then should return false', () => {
      //#given
      const agentName = "sisyphus"

      //#when
      const result = isCouncilMemberAgent(agentName)

      //#then
      expect(result).toBe(false)
    })

    it("#when name is empty string #then should return false", () => {
      //#given
      const agentName = ""

      //#when
      const result = isCouncilMemberAgent(agentName)

      //#then
      expect(result).toBe(false)
    })
  })

  describe("#given agent name is undefined", () => {
    it("#then should return false", () => {
      //#when
      const result = isCouncilMemberAgent(undefined)

      //#then
      expect(result).toBe(false)
    })
  })
})

describe("hasCouncilResponseTag", () => {
  describe("#given empty messages array", () => {
    it("#then should return false", () => {
      //#when
      const result = hasCouncilResponseTag([])

      //#then
      expect(result).toBe(false)
    })
  })

  describe("#given no assistant messages", () => {
    it("#then should return false", () => {
      //#given
      const messages = [
        {
          info: { role: "user" },
          parts: [{ type: "text", text: "</COUNCIL_MEMBER_RESPONSE>" }],
        },
      ]

      //#when
      const result = hasCouncilResponseTag(messages)

      //#then
      expect(result).toBe(false)
    })
  })

  describe("#given assistant message contains the response tag", () => {
    it("#then should return true", () => {
      //#given
      const messages = [
        {
          info: { role: "assistant" },
          parts: [{ type: "text", text: "My analysis </COUNCIL_MEMBER_RESPONSE>" }],
        },
      ]

      //#when
      const result = hasCouncilResponseTag(messages)

      //#then
      expect(result).toBe(true)
    })

    it("#when tag is in the last assistant message #then should return true", () => {
      //#given
      const messages = [
        {
          info: { role: "assistant" },
          parts: [{ type: "text", text: "no tag here" }],
        },
        {
          info: { role: "user" },
          parts: [{ type: "text", text: "user message" }],
        },
        {
          info: { role: "assistant" },
          parts: [{ type: "text", text: "final answer </COUNCIL_MEMBER_RESPONSE>" }],
        },
      ]

      //#when
      const result = hasCouncilResponseTag(messages)

      //#then
      expect(result).toBe(true)
    })
  })

  describe("#given assistant messages without the response tag", () => {
    it("#then should return false", () => {
      //#given
      const messages = [
        {
          info: { role: "assistant" },
          parts: [{ type: "text", text: "analysis without closing tag" }],
        },
      ]

      //#when
      const result = hasCouncilResponseTag(messages)

      //#then
      expect(result).toBe(false)
    })
  })

  describe("#given user message contains the tag but no assistant message does", () => {
    it("#then should return false", () => {
      //#given
      const messages = [
        {
          info: { role: "user" },
          parts: [{ type: "text", text: "</COUNCIL_MEMBER_RESPONSE>" }],
        },
        {
          info: { role: "assistant" },
          parts: [{ type: "text", text: "no tag in assistant" }],
        },
      ]

      //#when
      const result = hasCouncilResponseTag(messages)

      //#then
      expect(result).toBe(false)
    })
  })

  describe("#given messages with missing parts", () => {
    it("#then should handle gracefully and return false", () => {
      //#given
      const messages = [
        { info: { role: "assistant" } },
        { info: { role: "assistant" }, parts: [] },
        { info: { role: "assistant" }, parts: [{ type: "text" }] },
      ]

      //#when
      const result = hasCouncilResponseTag(messages)

      //#then
      expect(result).toBe(false)
    })
  })
})

describe("sendCouncilContinuationNudge", () => {
  describe("#given task status is not running", () => {
    it("#then should return false without calling promptAsync", () => {
      //#given
      const client = createMockClient()
      const task = createRunningTask({ status: "completed" })

      //#when
      const result = sendCouncilContinuationNudge(client as never, task, task.sessionID!)

      //#then
      expect(result).toBe(false)
      expect(client.session.promptAsync).not.toHaveBeenCalled()
    })
  })

  describe("#given task is running and nudge count is zero", () => {
    it("#when nudging for the first time #then should return true and call promptAsync", () => {
      //#given
      const client = createMockClient()
      const task = createRunningTask({ id: "task-nudge-first" })
      resetCouncilNudgeCount(task.id)

      //#when
      const result = sendCouncilContinuationNudge(client as never, task, task.sessionID!)

      //#then
      expect(result).toBe(true)
      expect(client.session.promptAsync).toHaveBeenCalledTimes(1)

      // cleanup
      resetCouncilNudgeCount(task.id)
    })

    it("#when nudging #then should update task.progress.lastUpdate", () => {
      //#given
      const client = createMockClient()
      const oldDate = new Date(Date.now() - 10000)
      const task = createRunningTask({
        id: "task-nudge-progress",
        progress: { lastUpdate: oldDate, toolCalls: 0 },
      })
      resetCouncilNudgeCount(task.id)

      //#when
      sendCouncilContinuationNudge(client as never, task, task.sessionID!)

      //#then
      expect(task.progress!.lastUpdate.getTime()).toBeGreaterThan(oldDate.getTime())

      // cleanup
      resetCouncilNudgeCount(task.id)
    })
  })

  describe("#given nudge count increments on each call", () => {
    it("#when nudging multiple times below max #then should return true each time", () => {
      //#given
      const client = createMockClient()
      const task = createRunningTask({ id: "task-nudge-multi" })
      resetCouncilNudgeCount(task.id)

      //#when
      const result1 = sendCouncilContinuationNudge(client as never, task, task.sessionID!)
      const result2 = sendCouncilContinuationNudge(client as never, task, task.sessionID!)
      const result3 = sendCouncilContinuationNudge(client as never, task, task.sessionID!)

      //#then
      expect(result1).toBe(true)
      expect(result2).toBe(true)
      expect(result3).toBe(true)
      expect(client.session.promptAsync).toHaveBeenCalledTimes(3)

      // cleanup
      resetCouncilNudgeCount(task.id)
    })
  })

  describe("#given nudge count reaches MAX_NUDGE_ATTEMPTS (5)", () => {
    it("#when called after max attempts #then should return false and clean up count", () => {
      //#given
      const client = createMockClient()
      const task = createRunningTask({ id: "task-nudge-max" })
      resetCouncilNudgeCount(task.id)

      //#when - exhaust all 5 attempts
      sendCouncilContinuationNudge(client as never, task, task.sessionID!)
      sendCouncilContinuationNudge(client as never, task, task.sessionID!)
      sendCouncilContinuationNudge(client as never, task, task.sessionID!)
      sendCouncilContinuationNudge(client as never, task, task.sessionID!)
      sendCouncilContinuationNudge(client as never, task, task.sessionID!)
      const resultAfterMax = sendCouncilContinuationNudge(client as never, task, task.sessionID!)

      //#then
      expect(resultAfterMax).toBe(false)
      expect(client.session.promptAsync).toHaveBeenCalledTimes(5)
    })
  })

  describe("#given promptAsync throws an error", () => {
    it("#then should handle error gracefully and still return true", () => {
      //#given
      const client = {
        session: { promptAsync: mock(() => Promise.reject(new Error("network error"))) },
      }
      const task = createRunningTask({ id: "task-nudge-error" })
      resetCouncilNudgeCount(task.id)

      //#when
      const result = sendCouncilContinuationNudge(client as never, task, task.sessionID!)

      //#then
      expect(result).toBe(true)

      // cleanup
      resetCouncilNudgeCount(task.id)
    })
  })
})

describe("resetCouncilNudgeCount", () => {
  describe("#given nudge count has been incremented", () => {
    it("#when reset is called #then nudging should start from zero again", () => {
      //#given
      const client = createMockClient()
      const task = createRunningTask({ id: "task-nudge-reset" })
      resetCouncilNudgeCount(task.id)

      // exhaust all attempts
      for (let i = 0; i < 5; i++) {
        sendCouncilContinuationNudge(client as never, task, task.sessionID!)
      }
      const resultBeforeReset = sendCouncilContinuationNudge(client as never, task, task.sessionID!)
      expect(resultBeforeReset).toBe(false)

      //#when
      resetCouncilNudgeCount(task.id)

      //#then - should be able to nudge again
      const clientAfterReset = createMockClient()
      const resultAfterReset = sendCouncilContinuationNudge(
        clientAfterReset as never,
        task,
        task.sessionID!,
      )
      expect(resultAfterReset).toBe(true)
      expect(clientAfterReset.session.promptAsync).toHaveBeenCalledTimes(1)

      // cleanup
      resetCouncilNudgeCount(task.id)
    })
  })
})
