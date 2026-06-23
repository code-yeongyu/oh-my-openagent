import { describe, expect, it } from "bun:test"
import type { MemoryWorkItem } from "../claude-tasks/memory-work-item"
import { Mem0L2Adapter } from "./adapter"
import { Mem0L2AdapterError } from "./errors"
import type { Mem0AddOptions, Mem0Client, Mem0Memory, Mem0Message } from "./types"

function buildStablePreferenceWorkItem(overrides: Partial<MemoryWorkItem> = {}): MemoryWorkItem {
  return {
    id: "wi-pref-001",
    type: "preference_candidate",
    source: "hook:Stop",
    project: "super-agent",
    contentSessionId: "ses_pref_001",
    candidateTargets: ["l1", "l2"],
    contentKind: "preference",
    importance: 0.92,
    dedupeKey: "preference_candidate:hook:Stop:ses_pref_001",
    payload: {
      preference: "User prefers deterministic verification commands.",
    },
    ...overrides,
  }
}

function createMem0ClientMock(overrides: Partial<Mem0Client> = {}): Mem0Client {
  return {
    add: async () => ({ id: "mem0-default" }),
    search: async () => [],
    get: async () => undefined,
    update: async () => {},
    delete: async () => {},
    history: async () => [],
    batchDelete: async () => {},
    getAll: async () => [],
    ...overrides,
  }
}

function setPrivateClient(adapter: Mem0L2Adapter, client: Mem0Client): void {
  Object.defineProperty(adapter, "client", {
    value: client,
    configurable: true,
    writable: true,
  })
}

function createMem0Memory(overrides: Partial<Mem0Memory> = {}): Mem0Memory {
  return {
    id: "mem0-memory-001",
    memory: "Scoped memory content",
    user_id: "super-agent:hook:Stop",
    metadata: { project_id: "super-agent", memory_id: "wi-pref-001" },
    created_at: "2026-04-14T00:00:00.000Z",
    updated_at: "2026-04-14T00:00:00.000Z",
    ...overrides,
  }
}

function createAdapter(defaultUserId?: string): Mem0L2Adapter {
  return new Mem0L2Adapter({
    clientConfig: { apiKey: "mem0-test-key" },
    projectId: "super-agent",
    defaultUserId,
  })
}

describe("Mem0L2Adapter integration", () => {
  it("indexes a stable preference work item into L2 with session provenance", async () => {
    let receivedMessages: Mem0Message[] | undefined
    let receivedOptions: Mem0AddOptions | undefined
    const adapter = new Mem0L2Adapter({
      clientConfig: { apiKey: "mem0-test-key" },
      projectId: "super-agent",
    })

    setPrivateClient(
      adapter,
      createMem0ClientMock({
        add: async (messagesOrText, options) => {
          receivedMessages = Array.isArray(messagesOrText) ? messagesOrText : []
          receivedOptions = options
          return { id: "mem0-pref-001" }
        },
      }),
    )

    const result = await adapter.indexWorkItem(buildStablePreferenceWorkItem())

    expect(result).toBe("mem0-pref-001")
    expect(receivedMessages).toHaveLength(1)
    expect(receivedMessages?.[0]?.role).toBe("user")
    expect(receivedMessages?.[0]?.content).toContain("User prefers deterministic verification commands.")
    expect(receivedOptions).toEqual({
      user_id: "super-agent:hook:Stop",
      run_id: "ses_pref_001",
      metadata: {
        memory_id: "wi-pref-001",
        project_id: "super-agent",
        memory_type: "convention",
        promotion_origin: "L1",
        source_kind: "session",
      },
      infer: true,
      enable_graph: true,
    })
  })

  it("returns undefined when getById resolves a foreign project memory", async () => {
    const adapter = createAdapter()
    setPrivateClient(
      adapter,
      createMem0ClientMock({
        get: async () => createMem0Memory({ metadata: { project_id: "other-project" } }),
      }),
    )

    await expect(adapter.getById("foreign-id")).resolves.toBeUndefined()
  })

  it("rejects update for a foreign project memory", async () => {
    const adapter = createAdapter()
    setPrivateClient(
      adapter,
      createMem0ClientMock({
        get: async () => createMem0Memory({ metadata: { project_id: "other-project" } }),
      }),
    )

    await expect(adapter.update("foreign-id", { summary: "Updated" })).rejects.toThrow(Mem0L2AdapterError)
  })

  it("rejects delete for a foreign project memory", async () => {
    const adapter = createAdapter()
    setPrivateClient(
      adapter,
      createMem0ClientMock({
        get: async () => createMem0Memory({ metadata: { project_id: "other-project" } }),
      }),
    )

    await expect(adapter.delete("foreign-id")).rejects.toThrow(Mem0L2AdapterError)
  })

  it("fails batchDelete closed when any id is out of project scope", async () => {
    const adapter = createAdapter()
    let batchDeleteCalls = 0
    setPrivateClient(
      adapter,
      createMem0ClientMock({
        get: async (id) =>
          id === "foreign-id"
            ? createMem0Memory({ id, metadata: { project_id: "other-project" } })
            : createMem0Memory({ id }),
        batchDelete: async () => {
          batchDeleteCalls++
        },
      }),
    )

    await expect(adapter.batchDelete(["scoped-id", "foreign-id"])).rejects.toThrow(Mem0L2AdapterError)
    expect(batchDeleteCalls).toBe(0)
  })

  it("keeps in-scope object-by-id operations working", async () => {
    const adapter = createAdapter("super-agent:hook:Stop")
    const updateCalls: Array<{ id: string; content: string; metadata?: Record<string, unknown> }> = []
    const deleteCalls: string[] = []
    const batchDeleteCalls: string[][] = []
    setPrivateClient(
      adapter,
      createMem0ClientMock({
        get: async (id) => createMem0Memory({ id }),
        update: async (id, content, metadata) => {
          updateCalls.push({ id, content, metadata })
        },
        delete: async (id) => {
          deleteCalls.push(id)
        },
        batchDelete: async (ids) => {
          batchDeleteCalls.push(ids)
        },
      }),
    )

    await expect(adapter.getById("scoped-id")).resolves.toMatchObject({ provider_external_id: "scoped-id" })
    await expect(adapter.update("scoped-id", { summary: "Updated" })).resolves.toBeUndefined()
    await expect(adapter.delete("scoped-id")).resolves.toBeUndefined()
    await expect(adapter.batchDelete(["scoped-id", "scoped-id-2"])).resolves.toBeUndefined()
    expect(updateCalls).toHaveLength(1)
    expect(deleteCalls).toEqual(["scoped-id"])
    expect(batchDeleteCalls).toEqual([["scoped-id", "scoped-id-2"]])
  })

  it("returns no history for a foreign project memory", async () => {
    const adapter = createAdapter()
    let historyCalls = 0
    setPrivateClient(
      adapter,
      createMem0ClientMock({
        get: async () => createMem0Memory({ metadata: { project_id: "other-project" } }),
        history: async () => {
          historyCalls++
          return [{ event: "UPDATE", previous_value: "A", new_value: "B", created_at: "2026-04-14T00:00:00.000Z" }]
        },
      }),
    )

    await expect(adapter.getHistory("foreign-id")).resolves.toEqual([])
    expect(historyCalls).toBe(0)
  })

  it("returns history for an in-scope memory", async () => {
    const adapter = createAdapter()
    setPrivateClient(
      adapter,
      createMem0ClientMock({
        get: async (id) => createMem0Memory({ id }),
        history: async () => [{ event: "UPDATE", previous_value: "A", new_value: "B", created_at: "2026-04-14T00:00:00.000Z" }],
      }),
    )

    await expect(adapter.getHistory("scoped-id")).resolves.toEqual([
      {
        provider_external_id: "scoped-id",
        previous_value: "A",
        new_value: "B",
        action: "UPDATE",
        changed_at: "2026-04-14T00:00:00.000Z",
      },
    ])
  })

  it("treats a different user_id as foreign when defaultUserId is configured", async () => {
    const adapter = createAdapter("super-agent:hook:Stop")
    setPrivateClient(
      adapter,
      createMem0ClientMock({
        get: async () => createMem0Memory({ user_id: "super-agent:hook:Other" }),
      }),
    )

    await expect(adapter.getById("foreign-user-id")).resolves.toBeUndefined()
  })
})
