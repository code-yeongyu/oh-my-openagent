import { describe, expect, test } from "bun:test"

import { DISPLAY_UNSAFE, ORDINARY, unsafeCodeUnits } from "@oh-my-opencode/utils/testing/display-unsafe"
import type { Status } from "../../device-service-core/src/index.ts"
import type { DeviceRow, SessionsList } from "../../omo-senpi/src/components/remote/index"
import type { ThreadToolResult } from "../../omo-senpi/src/components/thread/contracts"
import {
  candidateLines,
  deviceLines,
  personNextAction,
  refusalLines,
  sendWaitNotice,
  sessionEndedLine,
  sessionLines,
  sessionVerbLines,
  statusLines,
  undeliveredPromptLines,
} from "../remote-render"

const result = (value: unknown): ThreadToolResult => value as ThreadToolResult

function verbResults(value: string): (readonly [Parameters<typeof sessionVerbLines>[0], ThreadToolResult])[] {
  return [
    ["open", result({ kind: "ok", deduplicated: false, name: value, thread: value, device: value })],
    [
      "send",
      result({
        kind: "ok",
        delivery: { kind: "queued", queue_position: 2, waiting_on: { kind: "approval", device: value } },
      }),
    ],
    ["send", result({ kind: "ok", delivery: { kind: "steered", turn_id: value } })],
    ["send", result({ kind: "ok", delivery: { kind: "started", turn_id: value } })],
    ["model", result({ kind: "ok", model: { provider: value, id: value } })],
    [
      "interrupt",
      result({
        kind: "ok",
        interrupted: true,
        background: {
          status: "ok",
          stopped: [{ id: value, description: value }],
          failed: [{ id: value, reason: value }],
        },
      }),
    ],
    ["close", result({ kind: "ok", closed: false, dropped_deliveries: [value] })],
  ]
}

function everyLine(value: string): string[] {
  const status = {
    state: "connected",
    enabled: true,
    device: { name: value },
    detail: { action: value },
  } as unknown as Status
  const devices = [
    { id: value, name: value, kind: value, platform: value, online: true, last_seen_ms: null },
  ] as unknown as DeviceRow[]
  const listing = {
    rows: [
      {
        thread: value,
        title: value,
        source: "cache",
        state: value,
        project: value,
        device: { name: value },
        updated_ms: 0,
      },
    ],
    unanswered: [{ name: value }],
  } as unknown as SessionsList
  const refusal = {
    code: "ambiguous_target",
    message: value,
    next_action: value,
    details: {
      candidates: [
        { address: value, device_name: value },
        { device: value, name: value },
      ],
    },
  }
  return [
    ...statusLines(status, value, [[value, value]]),
    ...deviceLines(devices, 0),
    ...sessionLines(listing, 0),
    ...candidateLines(refusal),
    ...refusalLines(refusal),
    ...undeliveredPromptLines(value, { message: value, next_action: value }),
    sessionEndedLine(value, value),
    ...verbResults(value).flatMap(([verb, answer]) => sessionVerbLines(verb, value, answer)),
  ].flatMap((line) => line.split("\n"))
}

describe("omo remote human lines", () => {
  test("#given every display fixture in every human field #when the lines are built #then no line carries a listed code unit", () => {
    for (const fixture of DISPLAY_UNSAFE) {
      for (const line of everyLine(fixture))
        expect({ fixture, units: unsafeCodeUnits(line) }).toEqual({ fixture, units: [] })
    }
  })

  test("#given ordinary text in every human field #when the lines are built #then it appears unchanged on each builder", () => {
    for (const text of ORDINARY) {
      const shown = everyLine(text).join("\n")
      expect(shown.split(text).length - 1).toBeGreaterThanOrEqual(20)
    }
  })

  test("#given a fixture-bearing result #when the human lines are built #then the result's JSON form is unchanged", () => {
    for (const fixture of DISPLAY_UNSAFE) {
      for (const [verb, answer] of verbResults(fixture)) {
        const before = JSON.stringify(answer)
        sessionVerbLines(verb, fixture, answer)
        expect(JSON.stringify(answer)).toBe(before)
      }
      expect(personNextAction(fixture)).toBe(fixture)
      const notice = sendWaitNotice(fixture, result({ kind: "ok", delivery: { kind: "queued", queue_position: 1 } }))
      expect(notice).toBe(`Queued on ${fixture} at position 1.`)
    }
  })
})
