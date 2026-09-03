import { afterEach, describe, expect, mock, test } from "bun:test"

import { OhMyOpenCodeConfigSchema } from "../../config"
import {
  _setFetchImplementationForTesting,
  _setServerBasicAuthHeaderResolverForTesting,
} from "../../shared/opencode-http-api"
import { runPreemptiveCompactionIfNeeded } from "../preemptive-compaction-trigger"
import type { CachedCompactionState, PreemptiveCompactionContext } from "../preemptive-compaction-types"
import { createToolPart } from "./hook.test-support"
import { INTERRUPTED_TOOL_ERROR } from "./tool-result-repair"
import { sanitizeOrphanedToolPartsBeforeSummarize } from "./session-sanitizer"

const SESSION_ID = "ses_orphan"
const DIRECTORY = "/test/dir"

type CapturedPatch = { url: string; body: Record<string, unknown> }

function assistantMessage(parts: unknown[]): Record<string, unknown> {
  return {
    info: { id: "msg_1", role: "assistant", sessionID: SESSION_ID },
    parts,
  }
}

function userMessage(): Record<string, unknown> {
  return {
    info: { id: "msg_0", role: "user", sessionID: SESSION_ID },
    parts: [{ id: "prt_user_1", type: "text", text: "do the work" }],
  }
}

interface SDKClientArgs {
  messagesData?: unknown[]
  messagesError?: Error
  omitMessages?: boolean
}

function createSDKClient(args: SDKClientArgs) {
  const sessionRecord: Record<string, unknown> = {
    summarize: mock(() => Promise.resolve()),
  }
  if (!args.omitMessages) {
    sessionRecord["messages"] = mock(() => {
      if (args.messagesError) return Promise.reject(args.messagesError)
      return Promise.resolve({ data: args.messagesData ?? [] })
    })
  }
  return {
    _client: { getConfig: () => ({ baseUrl: "http://opencode.test" }) },
    session: sessionRecord,
    tui: { showToast: mock(() => Promise.resolve()) },
  }
}

interface Harness {
  patches: CapturedPatch[]
  order: string[]
  client: ReturnType<typeof createSDKClient>
}

function installFetchHarness(): Harness {
  const patches: CapturedPatch[] = []
  const order: string[] = []

  _setServerBasicAuthHeaderResolverForTesting(() => "Basic dGVzdDp0ZXN0")
  _setFetchImplementationForTesting((async (input: unknown, init?: unknown) => {
    const url = String(input)
    const method = (init as { method?: string } | undefined)?.method ?? "GET"
    if (method === "PATCH") {
      const rawBody = (init as { body?: string }).body ?? "{}"
      patches.push({ url, body: JSON.parse(rawBody) as Record<string, unknown> })
      order.push(`patch:${url}`)
      return new Response("{}", { status: 200 })
    }
    order.push(`other:${method}:${url}`)
    return new Response("{}", { status: 404 })
  }) as unknown as typeof fetch)

  return { patches, order, client: createSDKClient({}) }
}

async function runSanitize(harness: Harness, messagesData: unknown[]): Promise<number> {
  harness.client.session["messages"] = mock(() => Promise.resolve({ data: messagesData }))
  return await sanitizeOrphanedToolPartsBeforeSummarize({
    client: harness.client,
    sessionID: SESSION_ID,
    directory: DIRECTORY,
  })
}

describe("sanitizeOrphanedToolPartsBeforeSummarize", () => {
  let harness: Harness

  afterEach(() => {
    _setFetchImplementationForTesting(undefined)
    _setServerBasicAuthHeaderResolverForTesting(undefined)
  })

  describe("#given an assistant message whose tool part is still running", () => {
    test("#then settles the persisted part into a terminal error state", async () => {
      // given
      harness = installFetchHarness()
      const running = createToolPart({ callID: "call_1", status: "running" })

      // when
      const repaired = await runSanitize(harness, [assistantMessage([running])])

      // then
      expect(repaired).toBe(1)
      expect(harness.patches).toHaveLength(1)
      const patch = harness.patches[0]
      expect(patch.url).toBe(
        `http://opencode.test/session/${SESSION_ID}/message/msg_1/part/prt_call_1`,
      )
      expect(patch.body["id"]).toBe("prt_call_1")
      expect(patch.body["callID"]).toBe("call_1")
      const state = patch.body["state"] as Record<string, unknown>
      expect(state["status"]).toBe("error")
      expect(state["error"]).toBe(INTERRUPTED_TOOL_ERROR)
      expect(typeof state["time"]).toBe("object")
    })

    test("#then preserves the original input and start time", async () => {
      // given
      harness = installFetchHarness()
      const start = 1_700_000_000_000
      const running = createToolPart({ callID: "call_2", status: "running", input: { cmd: "ls" }, start })

      // when
      await runSanitize(harness, [assistantMessage([running])])

      // then
      const state = harness.patches[0].body["state"] as Record<string, unknown>
      expect(state["input"]).toEqual({ cmd: "ls" })
      const time = state["time"] as Record<string, unknown>
      expect(time["start"]).toBe(start)
      expect(typeof time["end"]).toBe("number")
    })
  })

  describe("#given a pending tool part", () => {
    test("#then it is settled too and the raw provider payload is dropped", async () => {
      // given
      harness = installFetchHarness()
      const pending = createToolPart({ callID: "call_3", status: "pending" })

      // when
      const repaired = await runSanitize(harness, [assistantMessage([pending])])

      // then
      expect(repaired).toBe(1)
      const state = harness.patches[0].body["state"] as Record<string, unknown>
      expect(state["status"]).toBe("error")
      expect("raw" in state).toBe(false)
    })
  })

  describe("#given all tool parts already reached a terminal state", () => {
    test("#then nothing is patched and the count is zero", async () => {
      // given
      harness = installFetchHarness()
      const completed = createToolPart({ callID: "call_4", status: "completed" })
      const errored = createToolPart({ callID: "call_5", status: "error" })

      // when
      const repaired = await runSanitize(harness, [assistantMessage([completed, errored])])

      // then
      expect(repaired).toBe(0)
      expect(harness.patches).toHaveLength(0)
    })
  })

  describe("#given only non-assistant messages", () => {
    test("#then nothing is patched", async () => {
      // given
      harness = installFetchHarness()

      // when
      const repaired = await runSanitize(harness, [userMessage()])

      // then
      expect(repaired).toBe(0)
      expect(harness.patches).toHaveLength(0)
    })
  })

  describe("#given a tool part without a part id", () => {
    test("#then it is skipped without crashing", async () => {
      // given
      harness = installFetchHarness()
      const orphaned = createToolPart({ callID: "call_6", status: "running" })
      delete (orphaned as Record<string, unknown>)["id"]

      // when
      const repaired = await runSanitize(harness, [assistantMessage([orphaned])])

      // then
      expect(repaired).toBe(0)
      expect(harness.patches).toHaveLength(0)
    })
  })

  describe("#given the messages request fails", () => {
    test("#then resolves zero without throwing so compaction proceeds", async () => {
      // given
      harness = installFetchHarness()
      harness.client.session["messages"] = mock(() =>
        Promise.reject(new Error("storage unavailable")),
      )

      // when
      const repaired = await sanitizeOrphanedToolPartsBeforeSummarize({
        client: harness.client,
        sessionID: SESSION_ID,
        directory: DIRECTORY,
      })

      // then
      expect(repaired).toBe(0)
    })
  })

  describe("#given a client without session.messages", () => {
    test("#then resolves zero without throwing", async () => {
      // given
      harness = installFetchHarness()
      const bareClient = createSDKClient({ omitMessages: true })

      // when
      const repaired = await sanitizeOrphanedToolPartsBeforeSummarize({
        client: bareClient,
        sessionID: SESSION_ID,
        directory: DIRECTORY,
      })

      // then
      expect(repaired).toBe(0)
    })
  })
})

describe("sanitizeOrphanedToolPartsBeforeSummarize wiring", () => {
  let harness: Harness

  afterEach(() => {
    _setFetchImplementationForTesting(undefined)
    _setServerBasicAuthHeaderResolverForTesting(undefined)
  })

  describe("#given preemptive compaction fires on a session with an orphaned running tool part", () => {
    test("#then the persisted part is patched before summarize is called", async () => {
      // given
      harness = installFetchHarness()
      const order = harness.order
      harness.client.session["messages"] = mock(() =>
        Promise.resolve({
          data: [assistantMessage([createToolPart({ callID: "call_pre", status: "running" })])],
        }),
      )
      harness.client.session["summarize"] = mock(() => {
        order.push("summarize")
        return Promise.resolve()
      })

      const ctx = {
        client: harness.client,
        directory: DIRECTORY,
      } as PreemptiveCompactionContext
      const tokenCache = new Map<string, CachedCompactionState>([
        [
          SESSION_ID,
          {
            providerID: "anthropic",
            modelID: "claude-sonnet-4-5",
            tokens: { input: 5_000_000, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          },
        ],
      ])

      // when
      await runPreemptiveCompactionIfNeeded({
        ctx,
        pluginConfig: OhMyOpenCodeConfigSchema.parse({}),
        sessionID: SESSION_ID,
        tokenCache,
        compactionInProgress: new Set<string>(),
        compactedSessions: new Set<string>(),
        lastCompactionTime: new Map<string, number>(),
      })

      // then
      expect(order.filter((entry) => entry.startsWith("patch:"))).toHaveLength(1)
      expect(order).toContain("summarize")
      expect(order.indexOf("summarize")).toBeGreaterThan(order.findIndex((entry) => entry.startsWith("patch:")))
    })
  })
})
