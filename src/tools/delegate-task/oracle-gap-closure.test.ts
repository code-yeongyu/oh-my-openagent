declare const require: NodeJS.Require

const { describe, test, expect, beforeEach, afterEach, spyOn, mock } = require("bun:test")

import type { DelegateTaskArgs, ToolContextWithMetadata } from "./types"
import type { ParentContext } from "./executor-types"
import * as executor from "./executor"

const runtimeRequire = require as NodeJS.Require & { cache?: Record<string, unknown> }
const MODEL = { providerID: "openai", modelID: "gpt-5.4" }

function clearRequireCache(modulePath: string): void {
  const resolvedPath = runtimeRequire.resolve(modulePath)
  if (runtimeRequire.cache?.[resolvedPath]) {
    delete runtimeRequire.cache[resolvedPath]
  }
}

function makeMockCtx(): ToolContextWithMetadata & {
  captured: Array<{ title?: string; metadata?: Record<string, unknown> }>
} {
  const captured: Array<{ title?: string; metadata?: Record<string, unknown> }> = []

  return {
    sessionID: "ses_parent",
    messageID: "msg_parent",
    agent: "sisyphus",
    abort: new AbortController().signal,
    callID: "call_001",
    metadata: async (input) => {
      captured.push(input)
    },
    captured,
  }
}

const parentContext: ParentContext = {
  sessionID: "ses_parent",
  messageID: "msg_parent",
  agent: "sisyphus",
  model: MODEL,
}

describe("delegate-task Oracle gap closure", () => {
  beforeEach(() => {
    mock.restore()
    clearRequireCache("./tools")
  })

  afterEach(() => {
    mock.restore()
    clearRequireCache("./tools")
  })

  test("#given sync continuation message info has sibling variant #when metadata publishes #then model keeps variant", async () => {
    //#given
    const { executeSyncContinuation } = require("./sync-continuation")
    const ctx = makeMockCtx()
    const args: DelegateTaskArgs = {
      description: "continue",
      prompt: "keep going",
      load_skills: [],
      run_in_background: false,
      task_id: "ses_cont_variant",
    }

    //#when
    await executeSyncContinuation(args, ctx, {
      client: {
        session: {
          messages: async () => ({ data: [{ info: { agent: "explore", model: MODEL, variant: "max" } }] }),
          promptAsync: async () => ({}),
        },
      },
    }, parentContext, {
      pollSyncSession: async () => null,
      fetchSyncResult: async () => ({ ok: true as const, textContent: "done" }),
    })

    //#then
    const published = ctx.captured.find((item) => item.metadata?.sessionId === "ses_cont_variant")
    expect(published?.metadata?.model).toEqual({ ...MODEL, variant: "max" })
  })

  test("#given sync continuation category arg #when result returns task metadata block #then block includes category", async () => {
    //#given
    const { executeSyncContinuation } = require("./sync-continuation")
    const args: DelegateTaskArgs = {
      description: "continue",
      prompt: "keep going",
      category: "quick",
      load_skills: [],
      run_in_background: false,
      task_id: "ses_cont_category",
    }

    //#when
    const result = await executeSyncContinuation(args, makeMockCtx(), {
      client: {
        session: {
          messages: async () => ({ data: [{ info: { agent: "explore", model: MODEL } }] }),
          promptAsync: async () => ({}),
        },
      },
    }, parentContext, {
      pollSyncSession: async () => null,
      fetchSyncResult: async () => ({ ok: true as const, textContent: "done" }),
    })

    //#then
    expect(result).toContain("<task_metadata>")
    expect(result).toContain("category: quick")
  })

  test("#given background continuation task category #when result returns task metadata block #then block includes category", async () => {
    //#given
    const { executeBackgroundContinuation } = require("./background-continuation")
    const args: DelegateTaskArgs = {
      description: "continue",
      prompt: "keep going",
      load_skills: [],
      run_in_background: true,
      task_id: "ses_bg_category",
    }

    //#when
    const result = await executeBackgroundContinuation(args, makeMockCtx(), {
      manager: {
        resume: async () => ({
          id: "bg_category",
          description: "existing",
          agent: "explore",
          status: "running",
          sessionID: "ses_bg_category",
          category: "deep",
          model: MODEL,
        }),
      },
    }, parentContext)

    //#then
    expect(result).toContain("<task_metadata>")
    expect(result).toContain("category: deep")
  })

  test("#given background continuation description changed #when metadata publishes #then title uses args description", async () => {
    //#given
    const { executeBackgroundContinuation } = require("./background-continuation")
    const ctx = makeMockCtx()
    const args: DelegateTaskArgs = {
      description: "new desc",
      prompt: "keep going",
      load_skills: [],
      run_in_background: true,
      task_id: "ses_bg_title",
    }

    //#when
    await executeBackgroundContinuation(args, ctx, {
      manager: {
        resume: async () => ({
          id: "bg_title",
          description: "old desc",
          agent: "explore",
          status: "running",
          sessionID: "ses_bg_title",
          model: MODEL,
        }),
      },
    }, parentContext)

    //#then
    const published = ctx.captured.find((item) => item.metadata?.sessionId === "ses_bg_title")
    expect(published?.title).toBe("Continue: new desc")
  })

  test("#given sync continuation receives system content #when prompt is sent #then system content reaches prompt body", async () => {
    //#given
    const promptCalls: Array<{ body?: { system?: string } }> = []
    const { executeSyncContinuation } = require("./sync-continuation")

    //#when
    await executeSyncContinuation({
      description: "continue",
      prompt: "keep going",
      load_skills: ["playwright"],
      run_in_background: false,
      task_id: "ses_sync_skills",
    }, makeMockCtx(), {
      client: {
        session: {
          messages: async () => ({ data: [{ info: { agent: "explore", model: MODEL } }] }),
          promptAsync: async (input: { body?: { system?: string } }) => {
            promptCalls.push(input)
            return {}
          },
        },
      },
    }, parentContext, {
      pollSyncSession: async () => null,
      fetchSyncResult: async () => ({ ok: true as const, textContent: "done" }),
    }, "skill instructions")

    //#then
    expect(promptCalls[0]?.body?.system).toBe("skill instructions")
  })

  test("#given background continuation loads skills through tool entry #when task resumes #then skill content is threaded into resumed prompt", async () => {
    //#given
    const resumeCalls: Array<{ prompt?: string }> = []
    spyOn(executor, "resolveSkillContent").mockResolvedValue({ content: "skill instructions", contents: undefined, error: null })
    spyOn(executor, "resolveParentContext").mockResolvedValue(parentContext)
    const { createDelegateTask } = require("./tools")
    const delegateTask = createDelegateTask({
      directory: "/tmp",
      manager: {
        resume: async (input: { prompt?: string }) => {
          resumeCalls.push(input)
          return {
            id: "bg_skills",
            description: "existing",
            agent: "explore",
            status: "running",
            sessionID: "ses_bg_skills",
            model: MODEL,
          }
        },
      },
      client: {},
    })

    //#when
    await delegateTask.execute({
      description: "continue",
      prompt: "keep going",
      load_skills: ["playwright"],
      run_in_background: true,
      task_id: "ses_bg_skills",
    }, makeMockCtx())

    //#then
    expect(resumeCalls[0]?.prompt).toContain("skill instructions")
    expect(resumeCalls[0]?.prompt).toContain("keep going")
  })
})
