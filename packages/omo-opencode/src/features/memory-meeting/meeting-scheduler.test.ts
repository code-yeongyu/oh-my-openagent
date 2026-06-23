/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { DEFAULT_MEETING_SCHEDULER_CONFIG, decideMeeting } from "./meeting-scheduler"

function isoHoursAgo(hours: number, now: Date): string {
  return new Date(now.getTime() - hours * 3_600_000).toISOString()
}

function isoMinutesAgo(minutes: number, now: Date): string {
  return new Date(now.getTime() - minutes * 60_000).toISOString()
}

describe("decideMeeting", () => {
  const now = new Date("2026-04-19T20:00:00Z")

  describe("#given user override", () => {
    test("#when decided #then should_hold is true", () => {
      const decision = decideMeeting(
        { inbox_draft_count: 0, has_user_override: true },
        DEFAULT_MEETING_SCHEDULER_CONFIG,
        now,
      )
      expect(decision.should_hold).toBe(true)
      expect(decision.reason).toBe("user override")
    })
  })

  describe("#given last meeting was 1 hour ago (too recent)", () => {
    test("#when decided #then should_hold is false", () => {
      const decision = decideMeeting(
        {
          inbox_draft_count: 10,
          last_meeting_at: isoHoursAgo(1, now),
          has_user_override: false,
        },
        DEFAULT_MEETING_SCHEDULER_CONFIG,
        now,
      )
      expect(decision.should_hold).toBe(false)
      expect(decision.reason).toContain("too recent")
    })
  })

  describe("#given last meeting was 25 hours ago (overdue)", () => {
    test("#when decided #then should_hold is true", () => {
      const decision = decideMeeting(
        {
          inbox_draft_count: 0,
          last_meeting_at: isoHoursAgo(25, now),
          has_user_override: false,
        },
        DEFAULT_MEETING_SCHEDULER_CONFIG,
        now,
      )
      expect(decision.should_hold).toBe(true)
      expect(decision.reason).toContain("overdue")
    })
  })

  describe("#given last meeting 6 hours ago but only 1 inbox draft", () => {
    test("#when decided #then should_hold is false (not enough drafts)", () => {
      const decision = decideMeeting(
        {
          inbox_draft_count: 1,
          last_meeting_at: isoHoursAgo(6, now),
          has_user_override: false,
          idle_since: isoMinutesAgo(10, now),
        },
        DEFAULT_MEETING_SCHEDULER_CONFIG,
        now,
      )
      expect(decision.should_hold).toBe(false)
      expect(decision.reason).toContain("not enough drafts")
    })
  })

  describe("#given 3 drafts but user active (idle < threshold)", () => {
    test("#when decided #then should_hold is false", () => {
      const decision = decideMeeting(
        {
          inbox_draft_count: 5,
          last_meeting_at: isoHoursAgo(6, now),
          has_user_override: false,
          idle_since: isoMinutesAgo(1, now),
        },
        DEFAULT_MEETING_SCHEDULER_CONFIG,
        now,
      )
      expect(decision.should_hold).toBe(false)
      expect(decision.reason).toContain("user active")
    })
  })

  describe("#given all criteria met", () => {
    test("#when decided #then should_hold is true", () => {
      const decision = decideMeeting(
        {
          inbox_draft_count: 5,
          last_meeting_at: isoHoursAgo(6, now),
          has_user_override: false,
          idle_since: isoMinutesAgo(10, now),
        },
        DEFAULT_MEETING_SCHEDULER_CONFIG,
        now,
      )
      expect(decision.should_hold).toBe(true)
      expect(decision.reason).toContain("criteria met")
    })
  })

  describe("#given no last meeting record + enough drafts + idle", () => {
    test("#when decided #then should_hold is true (first-time meeting)", () => {
      const decision = decideMeeting(
        {
          inbox_draft_count: 3,
          has_user_override: false,
          idle_since: isoMinutesAgo(10, now),
        },
        DEFAULT_MEETING_SCHEDULER_CONFIG,
        now,
      )
      expect(decision.should_hold).toBe(true)
    })
  })
})
