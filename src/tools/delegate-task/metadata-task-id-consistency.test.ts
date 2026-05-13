const { describe, test, expect } = require("bun:test")

import type { DelegateTaskArgs, ToolContextWithMetadata } from "./types"
import type { ParentContext } from "./executor-types"

const MODEL = { providerID: "anthropic", modelID: "claude-sonnet-4-6" }

function makeMockCtx(): ToolContextWithMetadata & { captured: any[] } {
  const captured: any[] = []
  return {
    sessionID: "ses_parent",
    messageID: "msg_parent",
    agent: "sisyphus",
    abort: new AbortController().signal,
    callID: "call_001",
    metadata: async (input: any) => { captured.push(input) },
    captured,
  }
}

const parentContext: ParentContext = {
  sessionID: "ses_parent",
  messageID: "msg_parent",
  agent: "sisyphus",
  model: MODEL,
}

describe("taskId and backgroundTaskId metadata consistency", () => {
  describe("#given sync-task runs", () => {
    test("#when publishing metadata #then taskId equals sessionId", async () => {
      const { executeSyncTask } = require("./sync-task")
      const ctx = makeMockCtx()
      const deps = {
        createSyncSession: async () => ({ ok: true, sessionID: "ses_sync" }),
        sendSyncPrompt: async () => null,
        pollSyncSession: async () => null,
        fetchSyncResult: async () => ({ ok: true as const, textContent: "done" }),
      }
      const args: DelegateTaskArgs = {
        description: "test", prompt: "do it",
        category: "quick", load_skills: [], run_in_background: false,
      }

      await executeSyncTask(args, ctx, {
        client: { session: { create: async () => ({ data: { id: "ses_sync" } }) } },
        directory: "/tmp",
        onSyncSessionCreated: null,
      }, parentContext, "explore", MODEL, undefined, undefined, undefined, deps)

      const meta = ctx.captured.find((m: any) => m.metadata?.sessionId)
      expect(meta).toBeDefined()
      expect(meta.metadata.taskId).toBe("ses_sync")
      expect(meta.metadata.sessionId).toBe("ses_sync")
      expect(meta.metadata.taskId).toBe(meta.metadata.sessionId)
    })
  })

  describe("#given background-task runs", () => {
    test("#when publishing metadata #then taskId is sessionID and backgroundTaskId is task.id", async () => {
      const { executeBackgroundTask } = require("./background-task")
      const ctx = makeMockCtx()
      const args: DelegateTaskArgs = {
        description: "test", prompt: "do it",
        load_skills: [], run_in_background: true, subagent_type: "explore",
      }

      await executeBackgroundTask(args, ctx, {
        manager: {
          launch: async () => ({
            id: "bg_abc123", description: "test", agent: "explore",
            status: "pending", sessionId: "ses_xyz789",
          }),
          getTask: () => undefined,
        },
      } as any, parentContext, "explore", MODEL, undefined)

      const meta = ctx.captured.find((m: any) => m.metadata?.sessionId)
      expect(meta).toBeDefined()
      expect(meta.metadata.taskId).toBe("ses_xyz789")
      expect(meta.metadata.sessionId).toBe("ses_xyz789")
      expect(meta.metadata.backgroundTaskId).toBe("bg_abc123")
    })
  })

  describe("#given unstable-agent-task runs", () => {
    test("#when publishing metadata #then taskId and backgroundTaskId are both included", async () => {
      const { executeUnstableAgentTask } = require("./unstable-agent-task")
      const ctx = makeMockCtx()
      const args: DelegateTaskArgs = {
        description: "test", prompt: "do it",
        category: "quick", load_skills: [], run_in_background: false,
      }

      const launchedTask = {
        id: "bg_unstable_abc", description: "test", agent: "explore",
        status: "completed", sessionId: "ses_unstable_xyz",
      }

      await executeUnstableAgentTask(
        args, ctx,
        {
          manager: {
            launch: async () => launchedTask,
            getTask: () => launchedTask,
          },
          client: {
            session: {
              status: async () => ({ data: { ses_unstable_xyz: { type: "idle" } } }),
              messages: async () => ({
                data: [{
                  info: { role: "assistant", time: { created: 1 } },
                  parts: [{ type: "text", text: "done" }],
                }],
              }),
            },
          },
          syncPollTimeoutMs: 100,
        } as any,
        parentContext, "explore", MODEL, undefined, "anthropic/claude-sonnet-4-6",
      )

      const meta = ctx.captured.find((m: any) => m.metadata?.sessionId)
      expect(meta).toBeDefined()
      expect(meta.metadata.taskId).toBe("ses_unstable_xyz")
      expect(meta.metadata.sessionId).toBe("ses_unstable_xyz")
      expect(meta.metadata.backgroundTaskId).toBe("bg_unstable_abc")
    })
  })

  describe("#given background-continuation runs", () => {
    test("#when publishing metadata #then taskId is sessionID and backgroundTaskId is bg.id", async () => {
      const { executeBackgroundContinuation } = require("./background-continuation")
      const ctx = makeMockCtx()
      const args: DelegateTaskArgs = {
        description: "continue", prompt: "keep going",
        load_skills: [], run_in_background: true, task_id: "ses_resumed_x",
      }

      await executeBackgroundContinuation(args, ctx, {
        manager: {
          resume: async () => ({
            id: "bg_resumed_y", description: "continue", agent: "explore",
            status: "running", sessionId: "ses_resumed_x", model: MODEL,
          }),
        },
      } as any, parentContext)

      const meta = ctx.captured.find((m: any) => m.metadata?.sessionId)
      expect(meta).toBeDefined()
      expect(meta.metadata.taskId).toBe("ses_resumed_x")
      expect(meta.metadata.sessionId).toBe("ses_resumed_x")
      expect(meta.metadata.backgroundTaskId).toBe("bg_resumed_y")
    })

    test("#when resumed task has category #then metadata.category equals task.category", async () => {
      const { executeBackgroundContinuation } = require("./background-continuation")
      const ctx = makeMockCtx()
      const args: DelegateTaskArgs = {
        description: "continue", prompt: "keep going",
        load_skills: [], run_in_background: true, task_id: "ses_resumed_x",
      }

      await executeBackgroundContinuation(args, ctx, {
        manager: {
          resume: async () => ({
            id: "bg_resumed_y", description: "continue", agent: "explore",
            status: "running", sessionId: "ses_resumed_x", model: MODEL, category: "deep",
          }),
        },
      } as any, parentContext)

      const meta = ctx.captured.find((item: any) => item.metadata?.sessionId)
      expect(meta).toBeDefined()
      expect(meta.metadata.category).toBe("deep")
    })

    test("#when publishing metadata with requested_subagent_type #then metadata.requested_subagent_type preserves original", async () => {
      const { executeBackgroundContinuation } = require("./background-continuation")
      const ctx = makeMockCtx()
      const args = {
        description: "continue",
        prompt: "keep going",
        category: "quick",
        requested_subagent_type: "oracle",
        load_skills: [],
        run_in_background: true,
        task_id: "ses_resumed_x",
      }

      await executeBackgroundContinuation(args, ctx, {
        manager: {
          resume: async () => ({
            id: "bg_resumed_y", description: "continue", agent: "explore",
            status: "running", sessionId: "ses_resumed_x", model: MODEL,
          }),
        },
      } as any, parentContext)

      const meta = ctx.captured.find((item: any) => item.metadata?.sessionId)
      expect(meta).toBeDefined()
      expect(meta.metadata.requested_subagent_type).toBe("oracle")
    })
  })

  describe("#given sync-continuation runs", () => {
    test("#when publishing metadata #then taskId is sessionID", async () => {
      const { executeSyncContinuation } = require("./sync-continuation")
      const ctx = makeMockCtx()
      const args: DelegateTaskArgs = {
        description: "continue", prompt: "keep going",
        load_skills: [], run_in_background: false, task_id: "ses_cont_abc",
      }

      const deps = {
        pollSyncSession: async () => null,
        fetchSyncResult: async () => ({ ok: true as const, textContent: "done" }),
      }

      await executeSyncContinuation(args, ctx, {
        client: {
          session: {
            messages: async () => ({
              data: [{ info: { agent: "explore", model: MODEL } }],
            }),
            prompt: async () => ({}),
          },
        },
      } as any, parentContext, deps)

      const meta = ctx.captured.find((m: any) => m.metadata?.sessionId)
      expect(meta).toBeDefined()
      expect(meta.metadata.taskId).toBe("ses_cont_abc")
      expect(meta.metadata.sessionId).toBe("ses_cont_abc")
    })

    test("#when resumeAgent is resolved #then metadata.agent equals resumeAgent", async () => {
      const { executeSyncContinuation } = require("./sync-continuation")
      const ctx = makeMockCtx()
      const args: DelegateTaskArgs = {
        description: "continue", prompt: "keep going",
        load_skills: [], run_in_background: false, task_id: "ses_cont_abc",
      }

      const deps = {
        pollSyncSession: async () => null,
        fetchSyncResult: async () => ({ ok: true as const, textContent: "done" }),
      }

      await executeSyncContinuation(args, ctx, {
        client: {
          session: {
            messages: async () => ({
              data: [{ info: { agent: "explore", model: MODEL } }],
            }),
            prompt: async () => ({}),
          },
        },
      } as any, parentContext, deps)

      const meta = ctx.captured.find((item: any) => item.metadata?.sessionId)
      expect(meta).toBeDefined()
      expect(meta.metadata.agent).toBe("explore")
    })

    test("#when called with category arg #then metadata.category equals args.category", async () => {
      const { executeSyncContinuation } = require("./sync-continuation")
      const ctx = makeMockCtx()
      const args: DelegateTaskArgs = {
        description: "continue", prompt: "keep going",
        category: "quick", load_skills: [], run_in_background: false, task_id: "ses_cont",
      }

      const deps = {
        pollSyncSession: async () => null,
        fetchSyncResult: async () => ({ ok: true as const, textContent: "done" }),
      }

      await executeSyncContinuation(args, ctx, {
        client: {
          session: {
            messages: async () => ({
              data: [{ info: { agent: "explore", model: MODEL } }],
            }),
            prompt: async () => ({}),
          },
        },
      } as any, parentContext, deps)

      const meta = ctx.captured.find((item: any) => item.metadata?.sessionId)
      expect(meta).toBeDefined()
      expect(meta.metadata.category).toBe("quick")
    })

    test("#when publishing metadata with requested_subagent_type #then metadata.requested_subagent_type preserves original", async () => {
      const { executeSyncContinuation } = require("./sync-continuation")
      const ctx = makeMockCtx()
      const args = {
        description: "continue",
        prompt: "keep going",
        category: "quick",
        requested_subagent_type: "oracle",
        load_skills: [],
        run_in_background: false,
        task_id: "ses_cont",
      }

      const deps = {
        pollSyncSession: async () => null,
        fetchSyncResult: async () => ({ ok: true as const, textContent: "done" }),
      }

      await executeSyncContinuation(args, ctx, {
        client: {
          session: {
            messages: async () => ({
              data: [{ info: { agent: "explore", model: MODEL } }],
            }),
            prompt: async () => ({}),
          },
        },
      } as any, parentContext, deps)

      const meta = ctx.captured.find((item: any) => item.metadata?.sessionId)
      expect(meta).toBeDefined()
      expect(meta.metadata.requested_subagent_type).toBe("oracle")
    })
  })

  describe("#given user calls with requested_subagent_type plus category", () => {
    test("#when sync-task publishes metadata #then metadata.requested_subagent_type preserves original", async () => {
      const { executeSyncTask } = require("./sync-task")
      const ctx = makeMockCtx()
      const deps = {
        createSyncSession: async () => ({ ok: true, sessionID: "ses_sync" }),
        sendSyncPrompt: async () => null,
        pollSyncSession: async () => null,
        fetchSyncResult: async () => ({ ok: true as const, textContent: "done" }),
      }
      const args = {
        description: "test",
        prompt: "do it",
        category: "quick",
        requested_subagent_type: "oracle",
        load_skills: [],
        run_in_background: false,
      }

      await executeSyncTask(args, ctx, {
        client: { session: { create: async () => ({ data: { id: "ses_sync" } }) } },
        directory: "/tmp",
        onSyncSessionCreated: null,
      }, parentContext, "Sisyphus-Junior", MODEL, undefined, undefined, undefined, deps)

      const meta = ctx.captured.find((item: any) => item.metadata?.sessionId)
      expect(meta).toBeDefined()
      expect(meta.metadata.requested_subagent_type).toBe("oracle")
    })

    test("#when background-task publishes metadata #then metadata.requested_subagent_type preserves original", async () => {
      const { executeBackgroundTask } = require("./background-task")
      const ctx = makeMockCtx()
      const args = {
        description: "test",
        prompt: "do it",
        category: "quick",
        requested_subagent_type: "oracle",
        load_skills: [],
        run_in_background: true,
      }

      await executeBackgroundTask(args, ctx, {
        manager: {
          launch: async () => ({
            id: "bg_abc123", description: "test", agent: "Sisyphus-Junior",
            status: "pending", sessionId: "ses_xyz789",
          }),
          getTask: () => undefined,
        },
      } as any, parentContext, "Sisyphus-Junior", MODEL, undefined)

      const meta = ctx.captured.find((item: any) => item.metadata?.sessionId)
      expect(meta).toBeDefined()
      expect(meta.metadata.requested_subagent_type).toBe("oracle")
    })

    test("#when unstable-agent-task publishes metadata #then metadata.requested_subagent_type preserves original", async () => {
      const { executeUnstableAgentTask } = require("./unstable-agent-task")
      const ctx = makeMockCtx()
      const args = {
        description: "test",
        prompt: "do it",
        category: "quick",
        requested_subagent_type: "oracle",
        load_skills: [],
        run_in_background: false,
      }

      const launchedTask = {
        id: "bg_unstable_abc", description: "test", agent: "Sisyphus-Junior",
        status: "completed", sessionId: "ses_unstable_xyz",
      }

      await executeUnstableAgentTask(
        args, ctx,
        {
          manager: {
            launch: async () => launchedTask,
            getTask: () => launchedTask,
          },
          client: {
            session: {
              status: async () => ({ data: { ses_unstable_xyz: { type: "idle" } } }),
              messages: async () => ({
                data: [{
                  info: { role: "assistant", time: { created: 1 } },
                  parts: [{ type: "text", text: "done" }],
                }],
              }),
            },
          },
          syncPollTimeoutMs: 100,
        } as any,
        parentContext, "Sisyphus-Junior", MODEL, undefined, "anthropic/claude-sonnet-4-6",
      )

      const meta = ctx.captured.find((item: any) => item.metadata?.sessionId)
      expect(meta).toBeDefined()
      expect(meta.metadata.requested_subagent_type).toBe("oracle")
    })
  })

  describe("#given background_output runs", () => {
    test("#when publishing metadata #then backgroundTaskId is task.id not task_id", async () => {
      const { createBackgroundOutput } = require("../background-task/create-background-output")
      const ctx = makeMockCtx()
      const manager = {
        getTask: (id: string) => ({
          id,
          sessionId: "ses_bg_session",
          agent: "explore",
          category: "deep",
          description: "test",
          status: "completed" as const,
        }),
      }
      const client = {
        session: {
          messages: async () => ({ data: [] }),
        },
      }

      const bgOutput = createBackgroundOutput(manager as any, client as any)
      await bgOutput.execute({ task_id: "bg_output_xyz" } as any, ctx as any)

      const meta = ctx.captured.find((m: any) => m.metadata?.backgroundTaskId)
      expect(meta).toBeDefined()
      expect(meta.metadata.backgroundTaskId).toBe("bg_output_xyz")
      expect(meta.metadata.sessionId).toBe("ses_bg_session")
      expect(meta.metadata.taskId).toBe("ses_bg_session")
    })
  })
})
