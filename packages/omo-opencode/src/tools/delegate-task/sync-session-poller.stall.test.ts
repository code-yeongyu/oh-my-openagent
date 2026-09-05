declare const require: (name: string) => any
const { describe, test, expect } = require("bun:test")
const { withAdvancingClock } = require("../../../../../test-support/advancing-clock")

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

function createStalledClient(
  sessionID: string,
  lastFinish: string | undefined,
  parts: Array<{ type: string; text?: string }> = []
) {
  return {
    session: {
      abort: async () => {},
      messages: async () => ({
        data: [
          { info: { id: "msg_001", role: "user", time: { created: 1000 } } },
          { info: { id: "msg_002", role: "assistant", time: { created: 2000 }, finish: lastFinish }, parts },
        ],
      }),
      status: async () => ({ data: { [sessionID]: { type: "idle" } } }),
    },
  }
}

describe.serial("sync session poll stall detection", () => {
  describe("#given an inactive session whose last assistant message has finish=unknown", () => {
    describe("#when no new messages arrive and no deliverable exists", () => {
      test("#then poll fails fast with a stall error instead of waiting for the inactivity timeout", async () => {
        const { pollSyncSession } = require("./sync-session-poller")
        let abortCount = 0
        const client = createStalledClient("ses_stall_no_deliverable", "unknown", [])
        client.session.abort = async () => {
          abortCount++
        }

        await withAdvancingClock(60_000, async (clock) => {
          const result = await pollSyncSession(createMockCtx(), client, {
            sessionID: "ses_stall_no_deliverable",
            agentToUse: "oracle",
            toastManager: null,
            taskId: undefined,
            stallTimeoutMs: 30_000,
            ...clock,
          })

          expect(result).toContain("Subagent stalled")
          expect(result).toContain("finish=\"unknown\"")
          expect(abortCount).toBe(1)
        })
      })
    })

    describe("#when the stalled session still contains a substantive deliverable", () => {
      test("#then poll treats the session as complete and returns the result", async () => {
        const { pollSyncSession } = require("./sync-session-poller")
        const client = createStalledClient("ses_stall_deliverable", "unknown", [
          { type: "text", text: "final report" },
        ])

        await withAdvancingClock(60_000, async (clock) => {
          const result = await pollSyncSession(createMockCtx(), client, {
            sessionID: "ses_stall_deliverable",
            agentToUse: "oracle",
            toastManager: null,
            taskId: undefined,
            stallTimeoutMs: 30_000,
            ...clock,
          })

          expect(result).toBeNull()
        })
      })

      test("#then an earlier deliverable from the same user turn survives a later empty retry", async () => {
        const { pollSyncSession } = require("./sync-session-poller")
        const client = createStalledClient("ses_same_turn_deliverable", "unknown", [])
        client.session.messages = async () => ({
          data: [
            { info: { id: "msg_001", role: "user", time: { created: 1000 } } },
            { info: { id: "msg_002", role: "assistant", time: { created: 2000 }, finish: "unknown" }, parts: [{ type: "text", text: "final report" }] },
            { info: { id: "msg_003", role: "assistant", time: { created: 3000 }, finish: "unknown" }, parts: [] },
          ],
        })

        await withAdvancingClock(60_000, async (clock) => {
          const result = await pollSyncSession(createMockCtx(), client, {
            sessionID: "ses_same_turn_deliverable",
            agentToUse: "oracle",
            toastManager: null,
            taskId: undefined,
            stallTimeoutMs: 30_000,
            ...clock,
          })

          expect(result).toBeNull()
        })
      })
    })

    describe("#when the last assistant message has finish=tool-calls", () => {
      test("#then stall detection does NOT fire and the normal inactivity timeout still applies", async () => {
        const { pollSyncSession } = require("./sync-session-poller")
        const client = createStalledClient("ses_toolcalls", "tool-calls", [])

        await withAdvancingClock(60_000, async (clock) => {
          const result = await pollSyncSession(createMockCtx(), client, {
            sessionID: "ses_toolcalls",
            agentToUse: "test-agent",
            toastManager: null,
            taskId: undefined,
            stallTimeoutMs: 30_000,
            ...clock,
          }, 120_000)

          expect(result).toContain("Poll inactivity timeout reached")
          expect(result).not.toContain("Subagent stalled")
        })
      })
    })

    describe("#when the last assistant message has no finish field at all", () => {
      test("#then stall detection does NOT fire (undefined finish can be a transient mid-generation state)", async () => {
        const { pollSyncSession } = require("./sync-session-poller")
        const client = createStalledClient("ses_no_finish", undefined, [])

        await withAdvancingClock(60_000, async (clock) => {
          const result = await pollSyncSession(createMockCtx(), client, {
            sessionID: "ses_no_finish",
            agentToUse: "test-agent",
            toastManager: null,
            taskId: undefined,
            stallTimeoutMs: 30_000,
            ...clock,
          }, 120_000)

          expect(result).toContain("Poll inactivity timeout reached")
          expect(result).not.toContain("Subagent stalled")
        })
      })
    })

    describe("#when the session is waiting on its own background children", () => {
      test("#then stall detection does NOT fire (session is legitimately quiescent)", async () => {
        const { pollSyncSession } = require("./sync-session-poller")
        const client = createStalledClient("ses_child_wait", "unknown", [])

        await withAdvancingClock(60_000, async (clock) => {
          const result = await pollSyncSession(createMockCtx(), client, {
            sessionID: "ses_child_wait",
            agentToUse: "test-agent",
            toastManager: null,
            taskId: undefined,
            stallTimeoutMs: 30_000,
            hasActiveChildBackgroundTasks: () => true,
            ...clock,
          }, 120_000)

          expect(result).toContain("Poll inactivity timeout reached")
          expect(result).not.toContain("Subagent stalled")
        })
      })
    })

    describe("#when the session becomes active again during the stall window", () => {
      test.each(["busy", "retry", "running"])(
        "#then %s resets the stall timer and requires a fresh contiguous idle window",
        async (activeStatus: string) => {
          const { pollSyncSession } = require("./sync-session-poller")
          let abortCount = 0
          let messageCallCount = 0
          const statusSequence: string[] = ["idle", "idle", activeStatus, "idle", "idle", "idle"]
          let statusCallCount = 0
          const client = createStalledClient("ses_active_reset", "unknown", [])
          client.session.abort = async () => {
            abortCount++
          }
          client.session.status = async () => {
            statusCallCount++
            const type = statusSequence[statusCallCount - 1] ?? "idle"
            // A real opencode status observation carries an increasing revision;
            // without it the poller's staleness dedup would skip message fetches
            // and the mock timeline below would not be exercised as intended.
            return { data: { ses_active_reset: { type, revision: statusCallCount } } }
          }
          client.session.messages = async () => {
            messageCallCount++
            return {
              data: [
                { info: { id: "msg_001", role: "user", time: { created: 1000 } } },
                { info: { id: "msg_002", role: "assistant", time: { created: 2000 }, finish: "unknown" }, parts: [] },
              ],
            }
          }

          // 10s per poll. Without the active-state reset the stall would fire on
          // the 4th poll; with the reset it needs a fresh 30s contiguous idle
          // window and fires later, proving active periods do not count toward
          // the stall timeout.
          await withAdvancingClock(10_000, async (clock) => {
            const result = await pollSyncSession(createMockCtx(), client, {
              sessionID: "ses_active_reset",
              agentToUse: "test-agent",
              toastManager: null,
              taskId: undefined,
              stallTimeoutMs: 30_000,
              ...clock,
            })

            expect(result).toContain("Subagent stalled")
            expect(abortCount).toBe(1)
            expect(messageCallCount).toBeGreaterThan(3)
          })
        }
      )
    })

    describe("#when status observation is unavailable during the stall window", () => {
      test.each(["throw", "missing"])(
        "#then a %s observation resets the timer while message completion remains available",
        async (unavailableKind: string) => {
          const { pollSyncSession } = require("./sync-session-poller")
          let statusCallCount = 0
          let messageCallCount = 0
          const client = createStalledClient("ses_status_unavailable", "unknown", [])
          client.session.status = async () => {
            statusCallCount++
            if (statusCallCount === 3) {
              if (unavailableKind === "throw") throw new Error("status unavailable")
              return { data: {} }
            }
            // Carry an increasing revision (as real opencode status does) so the
            // poller's staleness dedup keeps fetching messages after the
            // transient outage.
            return { data: { ses_status_unavailable: { type: "idle", revision: statusCallCount } } }
          }
          client.session.messages = async () => {
            messageCallCount++
            const assistant =
              messageCallCount >= 5
                ? { info: { id: "msg_003", role: "assistant", time: { created: 3000 }, finish: "stop" }, parts: [{ type: "text", text: "recovered" }] }
                : { info: { id: "msg_002", role: "assistant", time: { created: 2000 }, finish: "unknown" }, parts: [] }
            return { data: [{ info: { id: "msg_001", role: "user", time: { created: 1000 } } }, assistant] }
          }

          await withAdvancingClock(1_000, async (clock) => {
            const result = await pollSyncSession(createMockCtx(), client, {
              sessionID: "ses_status_unavailable",
              agentToUse: "test-agent",
              toastManager: null,
              taskId: undefined,
              stallTimeoutMs: 30_000,
              ...clock,
            })

            expect(result).toBeNull()
            expect(messageCallCount).toBeGreaterThanOrEqual(5)
          })
        }
      )
    })

    describe("#when a successful status response omits the session (real-world idle)", () => {
      test("#then the stall timer accumulates and the poll fails fast", async () => {
        // Real OpenCode (verified end-to-end on 1.18.15) drops idle sessions
        // from the status map entirely: a session that settles idle after an
        // interrupted stream is simply ABSENT from a successful response.
        // Absent-from-success must therefore count as inactive.
        const { pollSyncSession } = require("./sync-session-poller")
        let abortCount = 0
        const client = createStalledClient("ses_absent_idle", "unknown", [])
        client.session.status = async () => ({ data: {} })
        client.session.abort = async () => {
          abortCount++
        }

        await withAdvancingClock(10_000, async (clock) => {
          const result = await pollSyncSession(createMockCtx(), client, {
            sessionID: "ses_absent_idle",
            agentToUse: "test-agent",
            toastManager: null,
            taskId: undefined,
            stallTimeoutMs: 30_000,
            ...clock,
          })

          expect(result).toContain("Subagent stalled")
          expect(abortCount).toBe(1)
        })
      })

      test("#then a deliverable in the absent session is still handed back", async () => {
        const { pollSyncSession } = require("./sync-session-poller")
        const client = createStalledClient("ses_absent_deliverable", "unknown", [
          { type: "text", text: "final answer" },
        ])
        client.session.status = async () => ({ data: {} })

        await withAdvancingClock(10_000, async (clock) => {
          const result = await pollSyncSession(createMockCtx(), client, {
            sessionID: "ses_absent_deliverable",
            agentToUse: "test-agent",
            toastManager: null,
            taskId: undefined,
            stallTimeoutMs: 30_000,
            ...clock,
          })

          expect(result).toBeNull()
        })
      })
    })

    describe("#when the status API throws on every observation", () => {
      test("#then the stall timer never accumulates and the inactivity timeout still applies", async () => {
        const { pollSyncSession } = require("./sync-session-poller")
        let abortCount = 0
        const client = createStalledClient("ses_status_throws", "unknown", [])
        client.session.status = async () => {
          throw new Error("status endpoint down")
        }
        client.session.abort = async () => {
          abortCount++
        }

        await withAdvancingClock(60_000, async (clock) => {
          const result = await pollSyncSession(createMockCtx(), client, {
            sessionID: "ses_status_throws",
            agentToUse: "test-agent",
            toastManager: null,
            taskId: undefined,
            stallTimeoutMs: 30_000,
            ...clock,
          }, 120_000)

          expect(result).toContain("Poll inactivity timeout reached")
          expect(result).not.toContain("Subagent stalled")
        })
      })
    })

    describe("#when a short status outage interrupts an accumulated stall window", () => {
      test("#then the outage resets the timer and the stall waits for a fresh window after recovery", async () => {
        // Timing: each now() call adds 1000ms and a poll round advances the
        // clock by ~3s (inactiveElapsed + statusChanged reset + stallNow);
        // every 10th poll adds ~1s more for the periodic log. With
        // stallTimeoutMs=30s:
        //   - idle polls 1..4 accumulate a stall window from poll ~2 (t≈4s);
        //     by poll 4 the window is only ~6s: far from the 30s threshold.
        //   - polls 5..6: status THROWS. The staleness guard would `continue`
        //     (no revision -> statusChanged=false) WITHOUT the pre-guard reset,
        //     preserving the window accumulated so far.
        //   - poll 7+: idle with a NEW revision -> guard breaks through.
        //     WITHOUT the pre-guard reset the pre-outage window (stallSince
        //     from t≈4s) keeps aging and the stall fires around poll 12.
        //     WITH it: stallSince was zeroed during the outage, so poll 7
        //     restarts from scratch and the stall needs a fresh ~30s window
        //     (~10 more polls): completion comes around poll 17+.
        const { pollSyncSession } = require("./sync-session-poller")
        let statusCallCount = 0
        let result
        const client = createStalledClient("ses_outage_recovery", "unknown", [])
        client.session.status = async () => {
          statusCallCount++
          if (statusCallCount >= 5 && statusCallCount <= 6) {
            throw new Error("status unavailable")
          }
          return { data: { ses_outage_recovery: { type: "idle", revision: statusCallCount } } }
        }

        await withAdvancingClock(1_000, async (clock) => {
          result = await pollSyncSession(createMockCtx(), client, {
            sessionID: "ses_outage_recovery",
            agentToUse: "test-agent",
            toastManager: null,
            taskId: undefined,
            stallTimeoutMs: 30_000,
            ...clock,
          }, 300_000)
        })

        expect(result).toContain("Subagent stalled")
        // The stall must NOT fire using the pre-outage window (~poll 12); it
        // restarts at recovery (poll 7), so completion comes only after a
        // fresh ~30s window (statusCallCount ~17+).
        expect(statusCallCount).toBeGreaterThanOrEqual(14)
      })
    })

    describe("#when status observation returns an unrecognized state", () => {
      test("#then it does not count as inactive while terminal-message detection remains available", async () => {
        const { pollSyncSession } = require("./sync-session-poller")
        let messageCallCount = 0
        const client = createStalledClient("ses_unrecognized_status", "unknown", [])
        client.session.status = async () => ({
          data: { ses_unrecognized_status: { type: "connecting" } },
        })
        client.session.messages = async () => {
          messageCallCount++
          const assistant =
            messageCallCount >= 5
              ? { info: { id: "msg_003", role: "assistant", time: { created: 3000 }, finish: "stop" }, parts: [{ type: "text", text: "recovered" }] }
              : { info: { id: "msg_002", role: "assistant", time: { created: 2000 }, finish: "unknown" }, parts: [] }
          return { data: [{ info: { id: "msg_001", role: "user", time: { created: 1000 } } }, assistant] }
        }

        await withAdvancingClock(10_000, async (clock) => {
          const result = await pollSyncSession(createMockCtx(), client, {
            sessionID: "ses_unrecognized_status",
            agentToUse: "test-agent",
            toastManager: null,
            taskId: undefined,
            stallTimeoutMs: 30_000,
            ...clock,
          })

          expect(result).toBeNull()
          expect(messageCallCount).toBeGreaterThanOrEqual(5)
        })
      })
    })

    describe("#when relevant assistant content mutates without changing message count", () => {
      test.each([
        {
          name: "assistant id",
          prior: { id: "msg_002", finish: "stop", type: "text", text: "prior" },
          candidate: { id: "msg_004", finish: "unknown", type: "text", text: "draft-a" },
        },
        {
          name: "assistant finish",
          prior: { id: "msg_002", finish: "tool-calls", type: "text", text: "prior" },
          candidate: { id: "msg_003", finish: "unknown", type: "text", text: "draft-a" },
        },
        {
          name: "part type",
          prior: { id: "msg_002", finish: "stop", type: "text", text: "prior" },
          candidate: { id: "msg_003", finish: "unknown", type: "reasoning", text: "draft-a" },
        },
        {
          name: "part text",
          prior: { id: "msg_002", finish: "stop", type: "text", text: "prior" },
          candidate: { id: "msg_003", finish: "unknown", type: "text", text: "draft-b" },
        },
      ])("#then a same-length $name mutation resets the stall timer", async ({ prior, candidate }) => {
        const { pollSyncSession } = require("./sync-session-poller")
        let messageCallCount = 0
        const baseline = {
          prior: { id: "msg_002", finish: "stop", type: "text", text: "prior" },
          candidate: { id: "msg_003", finish: "unknown", type: "text", text: "draft-a" },
        }
        const recovered = {
          prior,
          candidate: { id: "msg_005", finish: "stop", type: "text", text: "recovered" },
        }
        const states = [baseline, baseline, { prior, candidate }, { prior, candidate }, recovered]
        const client = createStalledClient("ses_same_length_progress", "unknown", [])
        client.session.messages = async () => {
          const state = states[Math.min(messageCallCount, states.length - 1)]
          messageCallCount++
          return {
            data: [
              { info: { id: "msg_001", role: "user", time: { created: 1000 } } },
              { info: { id: state.prior.id, role: "assistant", time: { created: 2000 }, finish: state.prior.finish }, parts: [{ type: state.prior.type, text: state.prior.text }] },
              { info: { id: state.candidate.id, role: "assistant", time: { created: 3000 }, finish: state.candidate.finish }, parts: [{ type: state.candidate.type, text: state.candidate.text }] },
            ],
          }
        }

        await withAdvancingClock(1_000, async (clock) => {
          const result = await pollSyncSession(createMockCtx(), client, {
            sessionID: "ses_same_length_progress",
            agentToUse: "test-agent",
            toastManager: null,
            taskId: undefined,
            stallTimeoutMs: 3_000,
            ...clock,
          })

          expect(result).toBeNull()
          expect(messageCallCount).toBe(states.length)
        })
      })
    })

    describe("#given an anchored continuation", () => {
      test("#then stale prior-turn text is not a deliverable for an empty current-turn assistant", async () => {
        const { pollSyncSession } = require("./sync-session-poller")
        const client = createStalledClient("ses_stale_deliverable", "unknown", [])
        client.session.messages = async () => ({
          data: [
            { info: { id: "msg_000", role: "assistant", time: { created: 500 }, finish: "stop" } },
            { info: { id: "msg_001", role: "user", time: { created: 1000 } } },
            { info: { id: "msg_002", role: "assistant", time: { created: 2000 }, finish: "stop" }, parts: [{ type: "text", text: "old result" }] },
            { info: { id: "msg_003", role: "user", time: { created: 3000 } } },
            { info: { id: "msg_004", role: "assistant", time: { created: 4000 }, finish: "unknown" }, parts: [] },
          ],
        })

        await withAdvancingClock(10_000, async (clock) => {
          const result = await pollSyncSession(createMockCtx(), client, {
            sessionID: "ses_stale_deliverable",
            agentToUse: "test-agent",
            toastManager: null,
            taskId: undefined,
            anchorMessageCount: 1,
            stallTimeoutMs: 30_000,
            ...clock,
          })

          expect(result).toContain("Subagent stalled")
        })
      })

      test.each([
        {
          name: "pre-anchor assistant",
          messages: [
            { info: { id: "msg_001", role: "user", time: { created: 1000 } } },
            { info: { id: "msg_002", role: "assistant", time: { created: 2000 }, finish: "unknown" }, parts: [] },
            { info: { id: "msg_003", role: "user", time: { created: 3000 } } },
          ],
          anchorMessageCount: 2,
        },
        {
          name: "assistant superseded by a newer user",
          messages: [
            { info: { id: "msg_001", role: "user", time: { created: 1000 } } },
            { info: { id: "msg_002", role: "assistant", time: { created: 2000 }, finish: "stop" }, parts: [{ type: "text", text: "old result" }] },
            { info: { id: "msg_003", role: "user", time: { created: 3000 } } },
            { info: { id: "msg_004", role: "assistant", time: { created: 4000 }, finish: "unknown" }, parts: [] },
            { info: { id: "msg_005", role: "user", time: { created: 5000 } } },
          ],
          anchorMessageCount: 2,
        },
      ])("#then $name cannot trigger current-turn stall detection", async ({ messages, anchorMessageCount }) => {
        const { pollSyncSession } = require("./sync-session-poller")
        const client = createStalledClient("ses_anchor_candidate", "unknown", [])
        client.session.messages = async () => ({ data: messages })

        await withAdvancingClock(10_000, async (clock) => {
          const result = await pollSyncSession(createMockCtx(), client, {
            sessionID: "ses_anchor_candidate",
            agentToUse: "test-agent",
            toastManager: null,
            taskId: undefined,
            anchorMessageCount,
            stallTimeoutMs: 30_000,
            ...clock,
          }, 80_000)

          expect(result).toContain("Poll inactivity timeout reached")
          expect(result).not.toContain("Subagent stalled")
        })
      })
    })

    describe("#when new messages arrive during the stall window", () => {
      test("#then the stall timer resets and poll keeps waiting", async () => {
        const { pollSyncSession } = require("./sync-session-poller")
        let messageCallCount = 0
        const client = createStalledClient("ses_reset", "unknown", [])
        client.session.messages = async () => {
          messageCallCount++
          const extra =
            messageCallCount > 2
              ? [{ info: { id: "msg_003", role: "assistant", time: { created: 3000 }, finish: "stop" }, parts: [{ type: "text", text: "recovered" }] }]
              : []
          return {
            data: [
              { info: { id: "msg_001", role: "user", time: { created: 1000 } } },
              { info: { id: "msg_002", role: "assistant", time: { created: 2000 }, finish: "unknown" }, parts: [] },
              ...extra,
            ],
          }
        }

        await withAdvancingClock(60_000, async (clock) => {
          const result = await pollSyncSession(createMockCtx(), client, {
            sessionID: "ses_reset",
            agentToUse: "test-agent",
            toastManager: null,
            taskId: undefined,
            stallTimeoutMs: 30_000,
            ...clock,
          })

          expect(result).toBeNull()
        })
      })
    })
  })
})
