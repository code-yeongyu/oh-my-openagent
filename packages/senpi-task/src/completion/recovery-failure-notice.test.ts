import { describe, expect, test } from "bun:test"
import { recoveryFailureNotice } from "./recovery-failure-notice"

describe("recovery failure corrective actions", () => {
  for (const [reason, action] of [
    ["model_unavailable", /(?:choose|select).*(?:model|category)/i],
    ["tools_unavailable", /(?:enable|restore).*tools/i],
    ["host_incompatible", /(?:update|restart).*omo/i],
    ["spawn_spec_unavailable", /(?:new task|launch instructions)/i],
    ["transcript_unavailable", /(?:new task|saved conversation)/i],
    ["store_index_unavailable", /(?:access|permissions).*(?:data|directory)/i],
    ["isolated_not_revivable", /(?:checkout|retained).*(?:inspect|review)|(?:inspect|review).*(?:checkout|retained)/i],
  ] as const) {
    test(`${reason} requires correcting the cause before another attempt`, () => {
      // given
      const record = { description: "Investigate logs", revival_deferred_reason: reason }
      // when
      const notice = recoveryFailureNotice(record, true)
      // then: the action must change the missing prerequisite, not repeat the same request
      expect(notice).toMatch(action)
      expect(notice).not.toMatch(/Retry .*with the task tool using its original request/i)
    })
  }
})
