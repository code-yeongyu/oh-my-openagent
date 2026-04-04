const { describe, test, expect, mock } = require("bun:test")

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

describe("metadata model unification", () => {
  describe("#given delegate-task executors", () => {
    describe("#when metadata is set during execution", () => {

      test("#then sync-task metadata includes model", async () => {
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
        expect(meta.metadata.model).toEqual(MODEL)
      })

      test("#then background-task metadata includes model", async () => {
        const { executeBackgroundTask } = require("./background-task")
        const ctx = makeMockCtx()
        const args: DelegateTaskArgs = {
          description: "test", prompt: "do it",
          load_skills: [], run_in_background: true, subagent_type: "explore",
        }

        await executeBackgroundTask(args, ctx, {
          manager: {
            launch: async () => ({
              id: "bg_1", description: "test", agent: "explore",
              status: "pending", sessionID: "ses_bg", model: MODEL,
            }),
            getTask: () => undefined,
          },
        } as any, parentContext, "explore", MODEL, undefined)

        const meta = ctx.captured.find((m: any) => m.metadata?.sessionId)
        expect(meta).toBeDefined()
        expect(meta.metadata.model).toEqual(MODEL)
      })

      test("#then unstable-agent-task metadata includes model", async () => {
        const { executeUnstableAgentTask } = require("./unstable-agent-task")
        const ctx = makeMockCtx()
        const args: DelegateTaskArgs = {
          description: "test", prompt: "do it",
          category: "quick", load_skills: [], run_in_background: false,
        }

        const launchedTask = {
          id: "bg_unstable", description: "test", agent: "explore",
          status: "completed", sessionID: "ses_unstable", model: MODEL,
        }
        const result = await executeUnstableAgentTask(
          args, ctx,
          {
            manager: {
              launch: async () => launchedTask,
              getTask: () => launchedTask,
            },
            client: {
              session: {
                status: async () => ({ data: { ses_unstable: { type: "idle" } } }),
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
        expect(meta.metadata.model).toEqual(MODEL)
      })

      test("#then background-continuation metadata includes model from task", async () => {
        const { executeBackgroundContinuation } = require("./background-continuation")
        const ctx = makeMockCtx()
        const args: DelegateTaskArgs = {
          description: "continue", prompt: "keep going",
          load_skills: [], run_in_background: true, session_id: "ses_resumed",
        }

        await executeBackgroundContinuation(args, ctx, {
          manager: {
            resume: async () => ({
              id: "bg_2", description: "continue", agent: "explore",
              status: "running", sessionID: "ses_resumed", model: MODEL,
            }),
          },
        } as any, parentContext)

        const meta = ctx.captured.find((m: any) => m.metadata?.sessionId)
        expect(meta).toBeDefined()
        expect(meta.metadata.model).toEqual(MODEL)
      })

      test("#then sync-continuation metadata includes model from resumed session", async () => {
        const { executeSyncContinuation } = require("./sync-continuation")
        const ctx = makeMockCtx()
        const args: DelegateTaskArgs = {
          description: "continue", prompt: "keep going",
          load_skills: [], run_in_background: false, session_id: "ses_cont",
        }

        const deps = {
          pollSyncSession: async () => null,
          fetchSyncResult: async () => ({ ok: true as const, textContent: "done" }),
        }

        await executeSyncContinuation(args, ctx, {
          client: {
            session: {
              messages: async () => ({
                data: [{ info: { agent: "explore", model: MODEL, providerID: "anthropic", modelID: "claude-sonnet-4-6" } }],
              }),
              prompt: async () => ({}),
            },
          },
        } as any, deps)

        const meta = ctx.captured.find((m: any) => m.metadata?.sessionId)
        expect(meta).toBeDefined()
        expect(meta.metadata.model).toEqual(MODEL)
      })
    })
  })
})
