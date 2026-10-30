import { afterEach, describe, expect, mock, test } from "bun:test"
import { unsafeTestValue } from "../../../../../test-support/unsafe-test-value"
import { executeSyncContinuation } from "./sync-continuation"
import type { SyncContinuationDeps } from "./sync-continuation-deps"
import { cancelSyncSessionDeletion } from "./sync-session-cleanup"
import type { ExecutorContext } from "./executor-types"
import type { OpencodeClient, ToolContextWithMetadata } from "./types"

const parentContext = { sessionID: "parent-session", messageID: "parent-message" }
const toolContext: ToolContextWithMetadata = {
  ...parentContext,
  agent: "test-agent",
  abort: new AbortController().signal,
  metadata: () => {},
}

const notFound = (sessionID: string) => ({
  data: undefined,
  error: { name: "NotFoundError", data: { message: `Session not found: ${sessionID}` } },
})

function createClient(get: (input: { path: { id: string } }) => Promise<unknown>) {
  const promptAsync = mock(async () => ({}))
  const prompt = mock(async () => ({}))
  const client = unsafeTestValue<OpencodeClient>({
    session: {
      get: mock(get),
      messages: async (input: { path: { id: string } }) => notFound(input.path.id),
      promptAsync,
      prompt,
      status: async () => ({ data: {} }),
      abort: async () => ({}),
      delete: async () => ({}),
    },
  })
  return { client, promptAsync, prompt }
}

function createExecutorContext(client: OpencodeClient, attachSyncContinuation = mock(() => () => {})): ExecutorContext {
  return unsafeTestValue<ExecutorContext>({ client, manager: { attachSyncContinuation } })
}

describe("executeSyncContinuation for a deleted session", () => {
  afterEach(() => {
    cancelSyncSessionDeletion("ses_deleted_child")
    cancelSyncSessionDeletion("ses_live_child")
  })

  test("#given the child session was deleted #when it is continued #then it fails fast without prompting or polling", async () => {
    // given
    const { client, promptAsync, prompt } = createClient(async (input) => notFound(input.path.id))
    const pollSyncSession = mock(async () => "Poll inactivity timeout reached after 1800000ms")
    const deps: SyncContinuationDeps = {
      pollSyncSession,
      fetchSyncResult: async () => ({ ok: true, textContent: "unexpected" }),
    }
    const attachSyncContinuation = mock(() => () => {})

    // when
    const result = await executeSyncContinuation(
      { task_id: "ses_deleted_child", description: "round 2", prompt: "continue", run_in_background: false, load_skills: [] },
      toolContext, createExecutorContext(client, attachSyncContinuation), parentContext, deps,
    )

    // then
    expect(result.startsWith("Error:")).toBe(true)
    expect(result).toContain("ses_deleted_child")
    expect(result).toContain("no longer exists")
    expect(result).toContain("new task")
    expect(promptAsync).not.toHaveBeenCalled()
    expect(prompt).not.toHaveBeenCalled()
    expect(pollSyncSession).not.toHaveBeenCalled()
    expect(attachSyncContinuation).not.toHaveBeenCalled()
  })

  test("#given the session lookup fails for an unknown reason #when it is continued #then the continuation still runs", async () => {
    // given
    const { client } = createClient(async () => { throw new Error("socket hang up") })
    const pollSyncSession = mock(async () => null)
    const deps: SyncContinuationDeps = {
      pollSyncSession,
      fetchSyncResult: async () => ({ ok: true, textContent: "round 2 answer" }),
    }

    // when
    const result = await executeSyncContinuation(
      { task_id: "ses_live_child", description: "round 2", prompt: "continue", run_in_background: false, load_skills: [] },
      toolContext, createExecutorContext(client), parentContext, deps,
    )

    // then
    expect(pollSyncSession).toHaveBeenCalledTimes(1)
    expect(result).toContain("round 2 answer")
  })
})
