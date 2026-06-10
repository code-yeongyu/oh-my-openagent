/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"

import { TeamModeConfigSchema } from "./team-mode"

describe("TeamModeConfigSchema", () => {
  describe("#given all fields are omitted", () => {
    test("#when parsed #then it returns the default team mode config", () => {
      // given
      const input = {}

      // when
      const result = TeamModeConfigSchema.parse(input)

      // then
      expect(result).toEqual({
        enabled: false,
        tmux_visualization: false,
        max_parallel_members: 4,
        max_members: 8,
        max_messages_per_run: 10000,
        max_wall_clock_minutes: 120,
        max_member_turns: 500,
        message_payload_max_bytes: 32768,
        recipient_unread_max_bytes: 262144,
        mailbox_poll_interval_ms: 3000,
      })
    })
  })

  describe("#given invalid bounds are provided", () => {
    test("#when parsed #then it rejects out of range values", () => {
      // given
      const invalidInputs = [
        { max_parallel_members: -1 },
        { max_members: 9 },
        { message_payload_max_bytes: 512 },
      ]

      // when
      const results = invalidInputs.map((input) => TeamModeConfigSchema.safeParse(input))

      // then
      expect(results.every((result) => !result.success)).toBe(true)
    })
  })
})
