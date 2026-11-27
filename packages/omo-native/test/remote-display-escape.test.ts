import { describe, expect, test } from "bun:test"

import { DISPLAY_UNSAFE, ORDINARY, unsafeCodeUnits } from "@oh-my-opencode/utils/testing/display-unsafe"
import type {
  DeviceRow,
  InterruptResult,
  SendReceipt,
  ServiceStatus,
  SessionsList,
} from "../../omo-senpi/src/components/remote/index"
import {
  candidateLines,
  closeLines,
  deviceLines,
  interruptLines,
  modelLines,
  openedLines,
  personNextAction,
  refusalLines,
  sendLines,
  sendWaitNotice,
  sessionEndedLine,
  sessionLines,
  statusLines,
  undeliveredPromptLines,
} from "../remote-render"

const receipt = (value: unknown): SendReceipt => value as SendReceipt

function receipts(value: string): SendReceipt[] {
  return [
    receipt({ lane: "queued", queue_position: 2, waiting_on: { kind: "approval", device: value } }),
    receipt({ lane: "steered", turn_id: value }),
    receipt({ lane: "started", turn_id: value }),
  ]
}

const interrupted = (value: string): InterruptResult => ({
  thread: value,
  interrupted: true,
  background: {
    status: "stopped",
    stopped: [{ kind: "task", id: value, description: value }],
    failed: [{ kind: "task", id: value, reason: value }],
  },
})

// Every session verb's success lines (#14890 moved them from sessionVerbLines onto one builder per verb).
function verbLines(value: string): string[] {
  return [
    ...openedLines(value),
    ...receipts(value).flatMap((sent) => sendLines(value, sent)),
    ...modelLines(value, value),
    ...interruptLines(value, interrupted(value)),
    ...closeLines(value, { closed: false, dropped_deliveries: [value] }),
  ]
}

function everyLine(value: string): string[] {
  const status = {
    state: "connected",
    enabled: true,
    device: { name: value },
    detail: { action: value },
  } as unknown as ServiceStatus
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
    ...verbLines(value),
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
      for (const sent of receipts(fixture)) {
        const before = JSON.stringify(sent)
        sendLines(fixture, sent)
        expect(JSON.stringify(sent)).toBe(before)
      }
      const stopped = interrupted(fixture)
      const before = JSON.stringify(stopped)
      interruptLines(fixture, stopped)
      expect(JSON.stringify(stopped)).toBe(before)
      expect(personNextAction(fixture)).toBe(fixture)
      const notice = sendWaitNotice(fixture, receipt({ lane: "queued", queue_position: 1 }))
      expect(notice).toBe(`Queued on ${fixture} at position 1.`)
    }
  })
})
