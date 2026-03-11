import { describe, expect, it, mock, beforeEach } from "bun:test"
import { launchCouncilMember } from "./council-launcher"
import type { CouncilLaunchContext } from "./council-launcher"
import type { BackgroundManager } from "../../features/background-agent"
import type { CouncilMemberConfig } from "../../config/schema/athena"
import { ATHENA_JUNIOR_COUNCIL_MEMBER_KEY_PREFIX } from "../../agents/builtin-agents/council-member-agents"
import { COUNCIL_DEFAULTS } from "../../agents/athena/constants"

const makeManager = (overrides?: Partial<BackgroundManager>): BackgroundManager =>
  ({
    launch: mock(async () => ({
      id: "task-123",
      sessionID: undefined,
      status: "running",
    })),
    getTask: mock(() => undefined),
    ...overrides,
  }) as unknown as BackgroundManager

const makeContext = (): CouncilLaunchContext => ({
  parentSessionID: "ses-parent",
  parentMessageID: "msg-parent",
  parentAgent: "athena",
})

describe("launchCouncilMember", () => {
  describe("#given a valid member with provider/model format", () => {
    describe("#when launched successfully", () => {
      let manager: BackgroundManager
      let result: Awaited<ReturnType<typeof launchCouncilMember>>

      beforeEach(async () => {
        manager = makeManager()
        const member: CouncilMemberConfig = {
          name: "Claude Opus",
          model: "anthropic/claude-opus-4-6",
        }
        result = await launchCouncilMember(member, "analyze this", manager, makeContext())
      })

      it("#then returns the member in the outcome", () => {
        expect(result.member.name).toBe("Claude Opus")
      })

      it("#then returns a task with an id", () => {
        expect(result.task.id).toBe("task-123")
      })

      it("#then calls manager.launch once", () => {
        expect(manager.launch).toHaveBeenCalledTimes(1)
      })

      it("#then passes the correct agent key with Council: prefix", () => {
        const launchArgs = (manager.launch as ReturnType<typeof mock>).mock.calls[0][0]
        expect(launchArgs.agent).toBe("Council: claude_opus")
      })

      it("#then passes the prompt content", () => {
        const launchArgs = (manager.launch as ReturnType<typeof mock>).mock.calls[0][0]
        expect(launchArgs.prompt).toBe("analyze this")
      })

      it("#then passes the correct providerID", () => {
        const launchArgs = (manager.launch as ReturnType<typeof mock>).mock.calls[0][0]
        expect(launchArgs.model.providerID).toBe("anthropic")
      })

      it("#then passes the correct modelID", () => {
        const launchArgs = (manager.launch as ReturnType<typeof mock>).mock.calls[0][0]
        expect(launchArgs.model.modelID).toBe("claude-opus-4-6")
      })

      it("#then passes the parent session ID", () => {
        const launchArgs = (manager.launch as ReturnType<typeof mock>).mock.calls[0][0]
        expect(launchArgs.parentSessionID).toBe("ses-parent")
      })
    })
  })

  describe("#given a member with a variant", () => {
    describe("#when launched", () => {
      it("#then passes the variant through to the model config", async () => {
        const manager = makeManager()
        const member: CouncilMemberConfig = {
          name: "GPT Codex",
          model: "openai/gpt-5.3-codex",
          variant: "medium",
        }
        await launchCouncilMember(member, "prompt", manager, makeContext())
        const launchArgs = (manager.launch as ReturnType<typeof mock>).mock.calls[0][0]
        expect(launchArgs.model.variant).toBe("medium")
      })
    })
  })

  describe("#given Athena-Junior launched the council member", () => {
    describe("#when launched successfully", () => {
      it("#then uses the Athena-Junior council key prefix", async () => {
        const manager = makeManager()
        const member: CouncilMemberConfig = {
          name: "Claude Opus",
          model: "anthropic/claude-opus-4-6",
        }
        const context: CouncilLaunchContext = {
          ...makeContext(),
          parentAgent: "athena-junior",
        }

        await launchCouncilMember(member, "analyze this", manager, context)

        const launchArgs = (manager.launch as ReturnType<typeof mock>).mock.calls[0][0]
        expect(launchArgs.agent).toBe(`${ATHENA_JUNIOR_COUNCIL_MEMBER_KEY_PREFIX}claude_opus`)
      })
    })
  })

  describe("#given a member without a variant", () => {
    describe("#when launched", () => {
      it("#then does not include variant in the model config", async () => {
        const manager = makeManager()
        const member: CouncilMemberConfig = {
          name: "Gemini Flash",
          model: "google/gemini-3-flash",
        }
        await launchCouncilMember(member, "prompt", manager, makeContext())
        const launchArgs = (manager.launch as ReturnType<typeof mock>).mock.calls[0][0]
        expect(launchArgs.model.variant).toBeUndefined()
      })
    })
  })

  describe("#given a member with an invalid model format (no slash)", () => {
    describe("#when launched", () => {
      it("#then throws an error about invalid model format", () => {
        const manager = makeManager()
        const member: CouncilMemberConfig = {
          name: "Bad Model",
          model: "not-a-valid-model",
        }
        expect(launchCouncilMember(member, "prompt", manager, makeContext())).rejects.toThrow(
          'Invalid model format: "not-a-valid-model"',
        )
      })
    })
  })

  describe("#given a member with an empty model string", () => {
    describe("#when launched", () => {
      it("#then throws an error about invalid model format", () => {
        const manager = makeManager()
        const member: CouncilMemberConfig = {
          name: "Empty Model",
          model: "",
        }
        expect(launchCouncilMember(member, "prompt", manager, makeContext())).rejects.toThrow(
          "Invalid model format",
        )
      })
    })
  })

  describe("#given a council member is launched", () => {
    describe("#when launched", () => {
      it("#then uses COUNCIL_MEMBER_TTL_MS (2 hours) for the task TTL", async () => {
        const manager = makeManager()
        const member: CouncilMemberConfig = {
          name: "Claude Opus",
          model: "anthropic/claude-opus-4-6",
        }
        await launchCouncilMember(member, "analyze this", manager, makeContext())
        const launchArgs = (manager.launch as ReturnType<typeof mock>).mock.calls[0][0]
        expect(launchArgs.ttl).toBe(COUNCIL_DEFAULTS.COUNCIL_MEMBER_TTL_MS)
        expect(launchArgs.ttl).toBe(2 * 60 * 60 * 1000) // 2 hours in milliseconds
      })
    })
  })
})
