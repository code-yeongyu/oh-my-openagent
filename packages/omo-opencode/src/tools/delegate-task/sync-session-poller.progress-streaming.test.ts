declare const require: (name: string) => any
const { describe, test, expect, beforeEach, afterEach } = require("bun:test")
import { __setTimingConfig, __resetTimingConfig } from "./timing"
import type { SessionMessage } from "./executor-types"

function createMockCtx(aborted = false) {
  const controller = new AbortController()
  if (aborted) controller.abort()
  return {
    sessionID: "parent-session",
    messageID: "parent-message",
    agent: "test-agent",
    abort: controller.signal,
  }
}

async function withMockedDateNow(stepMs: number, run: () => Promise<void>) {
  const originalDateNow = Date.now
  let now = 0

  Date.now = () => {
    const current = now
    now += stepMs
    return current
  }

  try {
    await run()
  } finally {
    Date.now = originalDateNow
  }
}

type ProgressSnapshot = {
  elapsedMs: number
  assistantTurns: number
  toolCalls: number
  latestTool?: string
}

function createUserMessage(id: string): SessionMessage {
  return { info: { id, role: "user", time: { created: 1000 } }, parts: [{ type: "text", text: "do work" }] }
}

function createAssistantMessage(id: string, parts: SessionMessage["parts"], finish?: string): SessionMessage {
  return {
    info: { id, role: "assistant", time: { created: 2000 }, ...(finish !== undefined ? { finish } : {}) },
    parts,
  }
}

describe("pollSyncSession progress streaming (#3588)", () => {
  beforeEach(() => {
    __setTimingConfig({
      POLL_INTERVAL_MS: 10,
      MIN_STABILITY_TIME_MS: 0,
      STABILITY_POLLS_REQUIRED: 1,
      MAX_POLL_TIME_MS: 5000,
    })
  })

  afterEach(() => {
    __resetTimingConfig()
  })

  describe("#given a busy sync child session whose transcript accumulates tool parts while it runs", () => {
    describe("#when the parent polls the session with an onProgress callback", () => {
      test("#then progress snapshots stream in while the child is still busy, tracking growing toolCalls and the newest tool", async () => {
        // given
        const { pollSyncSession } = require("./sync-session-poller")
        const transcripts: SessionMessage[][] = [
          [createUserMessage("msg_001")],
          [
            createUserMessage("msg_001"),
            createAssistantMessage("msg_002", [{ type: "tool", tool: "bash" }]),
          ],
          [
            createUserMessage("msg_001"),
            createAssistantMessage("msg_002", [{ type: "tool", tool: "bash" }]),
            createAssistantMessage("msg_003", [{ type: "tool", tool: "read" }]),
          ],
          [
            createUserMessage("msg_001"),
            createAssistantMessage("msg_002", [{ type: "tool", tool: "bash" }]),
            createAssistantMessage("msg_003", [{ type: "tool", tool: "read" }]),
            createAssistantMessage("msg_004", [{ type: "text", text: "All done" }], "stop"),
          ],
        ]
        let messageFetchCount = 0
        let statusCallCount = 0
        const mockClient = {
          session: {
            abort: async () => {},
            messages: async () => {
              const index = Math.min(messageFetchCount, transcripts.length - 1)
              messageFetchCount++
              return { data: transcripts[index] }
            },
            status: async () => {
              statusCallCount++
              return { data: { ses_progress: { type: statusCallCount <= 3 ? "busy" : "idle" } } }
            },
          },
        }
        const snapshots: ProgressSnapshot[] = []

        // when
        let result: string | null = "not-run"
        await withMockedDateNow(25, async () => {
          result = await pollSyncSession(createMockCtx(), mockClient, {
            sessionID: "ses_progress",
            agentToUse: "explore",
            toastManager: null,
            taskId: undefined,
            progressIntervalMs: 20,
            onProgress: (snapshot: ProgressSnapshot) => {
              snapshots.push(snapshot)
            },
          })
        })

        // then: progress streamed DURING the busy phase, before completion
        expect(result).toBeNull()
        expect(snapshots.length).toBeGreaterThanOrEqual(2)
        for (let i = 1; i < snapshots.length; i++) {
          expect(snapshots[i].toolCalls).toBeGreaterThanOrEqual(snapshots[i - 1].toolCalls)
        }
        expect(snapshots.some((s) => s.latestTool === "bash")).toBe(true)
        expect(snapshots.some((s) => s.latestTool === "read")).toBe(true)
        expect(snapshots.every((s) => s.elapsedMs >= 0)).toBe(true)
      })
    })
  })

  describe("#given a busy sync child session that spans two assistant turns", () => {
    describe("#when the transcript grows to a second assistant message before completing", () => {
      test("#then the streamed progress reports the rising assistantTurns count", async () => {
        // given
        const { pollSyncSession } = require("./sync-session-poller")
        const transcripts: SessionMessage[][] = [
          [createUserMessage("msg_001")],
          [
            createUserMessage("msg_001"),
            createAssistantMessage("msg_002", [{ type: "tool", tool: "grep" }]),
          ],
          [
            createUserMessage("msg_001"),
            createAssistantMessage("msg_002", [{ type: "tool", tool: "grep" }]),
            createAssistantMessage("msg_003", [{ type: "text", text: "second turn done" }], "stop"),
          ],
        ]
        let messageFetchCount = 0
        let statusCallCount = 0
        const mockClient = {
          session: {
            abort: async () => {},
            messages: async () => {
              const index = Math.min(messageFetchCount, transcripts.length - 1)
              messageFetchCount++
              return { data: transcripts[index] }
            },
            status: async () => {
              statusCallCount++
              return { data: { ses_turns: { type: statusCallCount <= 3 ? "busy" : "idle" } } }
            },
          },
        }
        const snapshots: ProgressSnapshot[] = []

        // when
        let result: string | null = "not-run"
        await withMockedDateNow(25, async () => {
          result = await pollSyncSession(createMockCtx(), mockClient, {
            sessionID: "ses_turns",
            agentToUse: "explore",
            toastManager: null,
            taskId: undefined,
            progressIntervalMs: 20,
            onProgress: (snapshot: ProgressSnapshot) => {
              snapshots.push(snapshot)
            },
          })
        })

        // then
        expect(result).toBeNull()
        expect(snapshots.length).toBeGreaterThanOrEqual(1)
        expect(Math.max(...snapshots.map((s) => s.assistantTurns))).toBeGreaterThanOrEqual(2)
      })
    })
  })

  describe("#given a busy session whose transcript stays frozen", () => {
    describe("#when every observation sees the identical activity signature before the child goes idle unfinished", () => {
      test("#then onProgress fires exactly once instead of once per poll", async () => {
        // given
        const { pollSyncSession } = require("./sync-session-poller")
        const frozenTranscript: SessionMessage[] = [
          createUserMessage("msg_001"),
          createAssistantMessage("msg_002", [{ type: "tool", tool: "bash" }], "unknown"),
        ]
        let statusCallCount = 0
        const mockClient = {
          session: {
            abort: async () => {},
            messages: async () => ({ data: frozenTranscript }),
            status: async () => {
              statusCallCount++
              return { data: { ses_frozen: { type: statusCallCount <= 4 ? "busy" : "idle" } } }
            },
          },
        }
        const snapshots: ProgressSnapshot[] = []

        // when
        let result: string | null = "not-run"
        await withMockedDateNow(25, async () => {
          result = await pollSyncSession(createMockCtx(), mockClient, {
            sessionID: "ses_frozen",
            agentToUse: "explore",
            toastManager: null,
            taskId: undefined,
            progressIntervalMs: 20,
            onProgress: (snapshot: ProgressSnapshot) => {
              snapshots.push(snapshot)
            },
          })
        })

        // then: one publish for the first observation, none for repeats; loop still bounded by timeout
        expect(result).toContain("Poll inactivity timeout reached")
        expect(snapshots.length).toBe(1)
      })
    })
  })

  describe("#given an onProgress callback that throws", () => {
    describe("#when the child session completes normally anyway", () => {
      test("#then the poll still resolves the completed task instead of propagating the progress error", async () => {
        // given
        const { pollSyncSession } = require("./sync-session-poller")
        const doneTranscript: SessionMessage[] = [
          createUserMessage("msg_001"),
          createAssistantMessage("msg_002", [{ type: "text", text: "finished" }], "stop"),
        ]
        let statusCallCount = 0
        const mockClient = {
          session: {
            abort: async () => {},
            messages: async () => ({ data: doneTranscript }),
            status: async () => {
              statusCallCount++
              return { data: { ses_throwing: { type: statusCallCount <= 2 ? "busy" : "idle" } } }
            },
          },
        }

        // when
        let result: string | null = "not-run"
        await withMockedDateNow(25, async () => {
          result = await pollSyncSession(createMockCtx(), mockClient, {
            sessionID: "ses_throwing",
            agentToUse: "explore",
            toastManager: null,
            taskId: undefined,
            progressIntervalMs: 20,
            onProgress: () => {
              throw new Error("publisher exploded")
            },
          })
        })

        // then
        expect(result).toBeNull()
      })
    })
  })

  describe("#given an anchorMessageCount the transcript never exceeds", () => {
    describe("#when the child runs busy below the anchor and then goes idle unfinished", () => {
      test("#then no progress is published before the first new child message", async () => {
        // given
        const { pollSyncSession } = require("./sync-session-poller")
        const anchoredTranscript: SessionMessage[] = [
          createUserMessage("msg_001"),
          createAssistantMessage("msg_002", [{ type: "tool", tool: "bash" }], "unknown"),
        ]
        let statusCallCount = 0
        const mockClient = {
          session: {
            abort: async () => {},
            messages: async () => ({ data: anchoredTranscript }),
            status: async () => {
              statusCallCount++
              return { data: { ses_anchor: { type: statusCallCount <= 4 ? "busy" : "idle" } } }
            },
          },
        }
        const snapshots: ProgressSnapshot[] = []

        // when
        let result: string | null = "not-run"
        await withMockedDateNow(25, async () => {
          result = await pollSyncSession(createMockCtx(), mockClient, {
            sessionID: "ses_anchor",
            agentToUse: "explore",
            toastManager: null,
            taskId: undefined,
            anchorMessageCount: 5,
            progressIntervalMs: 20,
            onProgress: (snapshot: ProgressSnapshot) => {
              snapshots.push(snapshot)
            },
          })
        })

        // then
        expect(result).toContain("Poll inactivity timeout reached")
        expect(snapshots.length).toBe(0)
      })
    })
  })

  describe("#given a progressIntervalMs far larger than the whole run", () => {
    describe("#when the busy phase is shorter than one progress interval", () => {
      test("#then the active-phase progress fetch never fires and no snapshots are published", async () => {
        // given
        const { pollSyncSession } = require("./sync-session-poller")
        const doneTranscript: SessionMessage[] = [
          createUserMessage("msg_001"),
          createAssistantMessage("msg_002", [{ type: "text", text: "quick job" }], "stop"),
        ]
        let statusCallCount = 0
        let messageFetchCount = 0
        const mockClient = {
          session: {
            abort: async () => {},
            messages: async () => {
              messageFetchCount++
              return { data: doneTranscript }
            },
            status: async () => {
              statusCallCount++
              return { data: { ses_throttled: { type: statusCallCount <= 2 ? "busy" : "idle" } } }
            },
          },
        }
        const snapshots: ProgressSnapshot[] = []

        // when
        let result: string | null = "not-run"
        await withMockedDateNow(25, async () => {
          result = await pollSyncSession(createMockCtx(), mockClient, {
            sessionID: "ses_throttled",
            agentToUse: "explore",
            toastManager: null,
            taskId: undefined,
            progressIntervalMs: 10_000_000,
            onProgress: (snapshot: ProgressSnapshot) => {
              snapshots.push(snapshot)
            },
          })
        })

        // then: only the terminal idle-path fetch happened; no active-phase progress traffic
        expect(result).toBeNull()
        expect(snapshots.length).toBe(0)
        expect(messageFetchCount).toBe(1)
      })
    })
  })
})
