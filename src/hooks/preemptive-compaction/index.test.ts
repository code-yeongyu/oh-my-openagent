import { describe, it, expect, beforeEach, mock, spyOn } from "bun:test"
import { createPreemptiveCompactionHook } from "./index"
import * as pruningExecutor from "../anthropic-context-window-limit-recovery/pruning-executor"
import * as storage from "../anthropic-context-window-limit-recovery/storage"
import * as compactionLogger from "./compaction-logger"

describe("createPreemptiveCompactionHook", () => {
  let mockClient: {
    tui: { showToast: ReturnType<typeof mock> }
    session: {
      summarize: ReturnType<typeof mock>
      messages: ReturnType<typeof mock>
      promptAsync: ReturnType<typeof mock>
    }
  }
  let mockCtx: { client: typeof mockClient; directory: string }
  let mockExecuteDynamicContextPruning: ReturnType<typeof spyOn>
  let mockTruncateUntilTargetTokens: ReturnType<typeof spyOn>
  let mockLogCompaction: ReturnType<typeof spyOn>

  beforeEach(() => {
    mockClient = {
      tui: {
        showToast: mock(() => Promise.resolve()),
      },
      session: {
        summarize: mock(() => Promise.resolve()),
        messages: mock(() => Promise.resolve([])),
        promptAsync: mock(() => Promise.resolve()),
      },
    }
    mockCtx = {
      client: mockClient,
      directory: "/test/dir",
    }

    // Spy on external dependencies
    mockExecuteDynamicContextPruning = spyOn(pruningExecutor, "executeDynamicContextPruning")
    mockTruncateUntilTargetTokens = spyOn(storage, "truncateUntilTargetTokens")
    mockLogCompaction = spyOn(compactionLogger, "logCompaction")

    // Reset all mocks
    mockExecuteDynamicContextPruning.mockReset()
    mockTruncateUntilTargetTokens.mockReset()
    mockLogCompaction.mockReset()
    mockClient.tui.showToast.mockClear()
    mockClient.session.summarize.mockClear()
    mockClient.session.messages.mockClear()
    mockClient.session.promptAsync.mockClear()

    // Default mock implementations
    mockExecuteDynamicContextPruning.mockResolvedValue({
      itemsPruned: 0,
      totalTokensSaved: 0,
      strategies: { deduplication: 0, supersedeWrites: 0, purgeErrors: 0 },
    })
    mockTruncateUntilTargetTokens.mockReturnValue({
      success: false,
      sufficient: false,
      truncatedCount: 0,
      totalBytesRemoved: 0,
      targetBytesToRemove: 0,
      truncatedTools: [],
    })
    mockLogCompaction.mockImplementation(() => {})
  })

  describe("#given preemptive_compaction explicitly disabled", () => {
    it("#then should return no-op event handler", async () => {
      const hook = createPreemptiveCompactionHook(mockCtx as never, {
        experimental: { preemptive_compaction: false },
      })

      // Should not throw and do nothing
      await hook.event({ event: { type: "message.updated", properties: {} } })
      expect(mockClient.session.summarize).not.toHaveBeenCalled()
    })
  })

  describe("#given default configuration (enabled)", () => {
    let hook: ReturnType<typeof createPreemptiveCompactionHook>

    beforeEach(() => {
      hook = createPreemptiveCompactionHook(mockCtx as never)
    })

    describe("#when message.updated event received", () => {
      describe("#and role is not assistant", () => {
        it("#then should not trigger compaction", async () => {
          await hook.event({
            event: {
              type: "message.updated",
              properties: {
                info: {
                  id: "msg1",
                  role: "user",
                  sessionID: "session1",
                  finish: true,
                },
              },
            },
          })

          expect(mockClient.session.summarize).not.toHaveBeenCalled()
        })
      })

      describe("#and message is not finished", () => {
        it("#then should not trigger compaction", async () => {
          await hook.event({
            event: {
              type: "message.updated",
              properties: {
                info: {
                  id: "msg1",
                  role: "assistant",
                  sessionID: "session1",
                  finish: false,
                  modelID: "claude-sonnet-4",
                  providerID: "anthropic",
                  tokens: { input: 100000, output: 1000, cache: { read: 70000, write: 0 } },
                },
              },
            },
          })

          expect(mockClient.session.summarize).not.toHaveBeenCalled()
        })
      })

      describe("#and message is a summary", () => {
        it("#then should not trigger compaction", async () => {
          await hook.event({
            event: {
              type: "message.updated",
              properties: {
                info: {
                  id: "msg1",
                  role: "assistant",
                  sessionID: "session1",
                  finish: true,
                  summary: true,
                  modelID: "claude-sonnet-4",
                  providerID: "anthropic",
                  tokens: { input: 100000, output: 1000, cache: { read: 70000, write: 0 } },
                },
              },
            },
          })

          expect(mockClient.session.summarize).not.toHaveBeenCalled()
        })
      })

      describe("#and model is not supported", () => {
        it("#then should not trigger compaction", async () => {
          await hook.event({
            event: {
              type: "message.updated",
              properties: {
                info: {
                  id: "msg1",
                  role: "assistant",
                  sessionID: "session1",
                  finish: true,
                  modelID: "gpt-4",
                  providerID: "openai",
                  tokens: { input: 100000, output: 1000, cache: { read: 70000, write: 0 } },
                },
              },
            },
          })

          expect(mockClient.session.summarize).not.toHaveBeenCalled()
        })
      })

      describe("#and tokens below minimum", () => {
        it("#then should not trigger compaction", async () => {
          await hook.event({
            event: {
              type: "message.updated",
              properties: {
                info: {
                  id: "msg1",
                  role: "assistant",
                  sessionID: "session1",
                  finish: true,
                  modelID: "claude-sonnet-4",
                  providerID: "anthropic",
                  tokens: { input: 10000, output: 1000, cache: { read: 5000, write: 0 } },
                },
              },
            },
          })

          expect(mockClient.session.summarize).not.toHaveBeenCalled()
        })
      })

      describe("#and usage below threshold", () => {
        it("#then should not trigger compaction", async () => {
          await hook.event({
            event: {
              type: "message.updated",
              properties: {
                info: {
                  id: "msg1",
                  role: "assistant",
                  sessionID: "session1",
                  finish: true,
                  modelID: "claude-sonnet-4",
                  providerID: "anthropic",
                  // 100k / 200k = 50% usage, below 85% threshold
                  tokens: { input: 50000, output: 1000, cache: { read: 49000, write: 0 } },
                },
              },
            },
          })

          expect(mockClient.session.summarize).not.toHaveBeenCalled()
        })
      })

      describe("#and usage above threshold without DCP enabled", () => {
        it("#then should trigger summarization directly", async () => {
          await hook.event({
            event: {
              type: "message.updated",
              properties: {
                info: {
                  id: "msg1",
                  role: "assistant",
                  sessionID: "session1",
                  finish: true,
                  modelID: "claude-sonnet-4",
                  providerID: "anthropic",
                  // 175k / 200k = 87.5% usage, above 85% threshold
                  tokens: { input: 100000, output: 5000, cache: { read: 70000, write: 0 } },
                },
              },
            },
          })

          expect(mockClient.session.summarize).toHaveBeenCalledTimes(1)
          expect(mockClient.session.summarize).toHaveBeenCalledWith({
            path: { id: "session1" },
            body: { providerID: "anthropic", modelID: "claude-sonnet-4" },
            query: { directory: "/test/dir" },
          })
        })
      })
    })

    describe("#when session.deleted event received", () => {
      it("#then should clean up session state", async () => {
        // This is mainly to ensure no errors - state cleanup is internal
        await hook.event({
          event: {
            type: "session.deleted",
            properties: {
              info: { id: "session1" },
            },
          },
        })

        // No error thrown means success
        expect(true).toBe(true)
      })
    })
  })

  describe("#given DCP enabled configuration", () => {
    let hook: ReturnType<typeof createPreemptiveCompactionHook>

    beforeEach(() => {
      hook = createPreemptiveCompactionHook(mockCtx as never, {
        experimental: {
          dcp_for_compaction: true,
          truncation_protection_messages: 3,
        },
      })
    })

    describe("#when compaction triggered", () => {
      const triggerCompaction = () =>
        hook.event({
          event: {
            type: "message.updated",
            properties: {
              info: {
                id: "msg1",
                role: "assistant",
                sessionID: "session-dcp",
                finish: true,
                modelID: "claude-sonnet-4",
                providerID: "anthropic",
                // 175k / 200k = 87.5% usage
                tokens: { input: 100000, output: 5000, cache: { read: 70000, write: 0 } },
              },
            },
          },
        })

      describe("#and DCP + truncation reduce below threshold", () => {
        it("#then should skip summarization", async () => {
          mockExecuteDynamicContextPruning.mockResolvedValue({
            itemsPruned: 5,
            totalTokensSaved: 20000,
            strategies: { deduplication: 2, supersedeWrites: 2, purgeErrors: 1 },
          })
          mockTruncateUntilTargetTokens.mockReturnValue({
            success: true,
            sufficient: true,
            truncatedCount: 3,
            totalBytesRemoved: 40000, // ~10k tokens at 4 chars/token
            targetBytesToRemove: 40000,
            truncatedTools: [{ toolName: "grep", originalSize: 40000 }],
          })

          await triggerCompaction()

          expect(mockExecuteDynamicContextPruning).toHaveBeenCalledTimes(1)
          expect(mockTruncateUntilTargetTokens).toHaveBeenCalledTimes(1)
          expect(mockClient.session.summarize).not.toHaveBeenCalled()
          
          // Check that "skipped" phase was logged
          const skippedCall = mockLogCompaction.mock.calls.find(
            (call: unknown[]) => (call[0] as { phase: string }).phase === "skipped"
          )
          expect(skippedCall).toBeDefined()
        })
      })

      describe("#and DCP + truncation not sufficient", () => {
        it("#then should proceed to summarization", async () => {
          // With 175k tokens used and 200k limit:
          // DCP saves 1k, truncation saves 1k (4000 bytes / 4)
          // Total saved: 2k, new total: 173k
          // Usage ratio: 173k / 200k = 86.5%, still above 85% threshold
          mockExecuteDynamicContextPruning.mockResolvedValue({
            itemsPruned: 1,
            totalTokensSaved: 1000,
            strategies: { deduplication: 1, supersedeWrites: 0, purgeErrors: 0 },
          })
          mockTruncateUntilTargetTokens.mockReturnValue({
            success: true,
            sufficient: false,
            truncatedCount: 1,
            totalBytesRemoved: 4000, // ~1k tokens at 4 chars/token
            targetBytesToRemove: 40000,
            truncatedTools: [{ toolName: "read", originalSize: 4000 }],
          })

          await triggerCompaction()

          expect(mockExecuteDynamicContextPruning).toHaveBeenCalledTimes(1)
          expect(mockTruncateUntilTargetTokens).toHaveBeenCalledTimes(1)
          expect(mockClient.session.summarize).toHaveBeenCalledTimes(1)
          
          // Check that "summarized" phase was logged
          const summarizedCall = mockLogCompaction.mock.calls.find(
            (call: unknown[]) => (call[0] as { phase: string }).phase === "summarized"
          )
          expect(summarizedCall).toBeDefined()
        })
      })

      describe("#and DCP fails", () => {
        it("#then should continue with truncation and summarization", async () => {
          mockExecuteDynamicContextPruning.mockRejectedValue(new Error("DCP failed"))
          mockTruncateUntilTargetTokens.mockReturnValue({
            success: false,
            sufficient: false,
            truncatedCount: 0,
            totalBytesRemoved: 0,
            targetBytesToRemove: 40000,
            truncatedTools: [],
          })

          await triggerCompaction()

          expect(mockExecuteDynamicContextPruning).toHaveBeenCalledTimes(1)
          expect(mockTruncateUntilTargetTokens).toHaveBeenCalledTimes(1)
          expect(mockClient.session.summarize).toHaveBeenCalledTimes(1)
        })
      })
    })
  })

  describe("#given custom threshold", () => {
    it("#then should use custom threshold for decision", async () => {
      const hook = createPreemptiveCompactionHook(mockCtx as never, {
        experimental: {
          preemptive_compaction_threshold: 0.7,
        },
      })

      // 145k / 200k = 72.5% usage, above 70% custom threshold
      await hook.event({
        event: {
          type: "message.updated",
          properties: {
            info: {
              id: "msg1",
              role: "assistant",
              sessionID: "session-custom",
              finish: true,
              modelID: "claude-sonnet-4",
              providerID: "anthropic",
              tokens: { input: 80000, output: 5000, cache: { read: 60000, write: 0 } },
            },
          },
        },
      })

      expect(mockClient.session.summarize).toHaveBeenCalledTimes(1)
    })
  })

  describe("#given custom model limit callback", () => {
    it("#then should use custom limit for calculation", async () => {
      const hook = createPreemptiveCompactionHook(mockCtx as never, {
        getModelLimit: (providerID, modelID) => {
          if (providerID === "anthropic" && modelID.includes("sonnet")) {
            return 100000 // 100k limit
          }
          return undefined
        },
      })

      // 85k / 100k = 85% usage, at threshold
      await hook.event({
        event: {
          type: "message.updated",
          properties: {
            info: {
              id: "msg1",
              role: "assistant",
              sessionID: "session-limit",
              finish: true,
              modelID: "claude-sonnet-4",
              providerID: "anthropic",
              tokens: { input: 50000, output: 5000, cache: { read: 30000, write: 0 } },
            },
          },
        },
      })

      expect(mockClient.session.summarize).toHaveBeenCalledTimes(1)
    })
  })

  describe("#given onBeforeSummarize callback", () => {
    it("#then should call callback before summarization", async () => {
      const onBeforeSummarize = mock(async () => {})
      const hook = createPreemptiveCompactionHook(mockCtx as never, {
        onBeforeSummarize,
      })

      await hook.event({
        event: {
          type: "message.updated",
          properties: {
            info: {
              id: "msg1",
              role: "assistant",
              sessionID: "session-callback",
              finish: true,
              modelID: "claude-sonnet-4",
              providerID: "anthropic",
              tokens: { input: 100000, output: 5000, cache: { read: 70000, write: 0 } },
            },
          },
        },
      })

      expect(onBeforeSummarize).toHaveBeenCalledTimes(1)
      expect(onBeforeSummarize).toHaveBeenCalledWith({
        sessionID: "session-callback",
        providerID: "anthropic",
        modelID: "claude-sonnet-4",
        usageRatio: expect.any(Number),
        directory: "/test/dir",
      })
      expect(mockClient.session.summarize).toHaveBeenCalledTimes(1)
    })
  })

  describe("cooldown mechanism", () => {
    it("#then should prevent rapid consecutive compactions", async () => {
      const hook = createPreemptiveCompactionHook(mockCtx as never)

      const triggerEvent = {
        event: {
          type: "message.updated",
          properties: {
            info: {
              id: "msg1",
              role: "assistant",
              sessionID: "session-cooldown",
              finish: true,
              modelID: "claude-sonnet-4",
              providerID: "anthropic",
              tokens: { input: 100000, output: 5000, cache: { read: 70000, write: 0 } },
            },
          },
        },
      }

      // First trigger should work
      await hook.event(triggerEvent)
      expect(mockClient.session.summarize).toHaveBeenCalledTimes(1)

      mockClient.session.summarize.mockClear()

      // Second immediate trigger should be blocked by cooldown
      await hook.event(triggerEvent)
      expect(mockClient.session.summarize).not.toHaveBeenCalled()
    })
  })
})
