/// <reference types="bun-types" />

// Characterization (plan P0-06i, behaviour X18). Guards a security contract: who may take foreground
// computer control without a human yes. Any row changing is a behaviour change, not a refactor.

import { describe, expect, test } from "bun:test"
import type { ComputerHostContext } from "@oh-my-opencode/senpi-desktop-tool"

import { type ControlTimeoutScheduler, confirmComputerControl, fullAccessControlNote } from "./control-confirm"

const REASON = "click Run"
const SETTLE_LIMIT_MS = 5_000

type FullAccess = "on" | "off" | "absent"

interface Row {
  readonly name: string
  readonly hasUI: boolean | undefined
  readonly aborted: boolean
  readonly fullAccess: FullAccess
  readonly notify: boolean
  readonly confirm: boolean | "absent"
  readonly expected: {
    readonly granted: boolean
    readonly prompts: number
    readonly notes: ReadonlyArray<{ readonly message: string; readonly level: string }>
  }
}

const NOTE = [{ message: fullAccessControlNote(REASON), level: "info" }] as const

const ROWS: readonly Row[] = [
  {
    name: "no UI (hasUI false) in full access with every surface -> no grant, no prompt, no note",
    hasUI: false,
    aborted: false,
    fullAccess: "on",
    notify: true,
    confirm: true,
    expected: { granted: false, prompts: 0, notes: [] },
  },
  {
    name: "no UI (hasUI false) outside full access -> no grant, no prompt",
    hasUI: false,
    aborted: false,
    fullAccess: "off",
    notify: true,
    confirm: true,
    expected: { granted: false, prompts: 0, notes: [] },
  },
  {
    name: "aborted run in full access with UI and every surface -> no grant, no prompt, no note",
    hasUI: true,
    aborted: true,
    fullAccess: "on",
    notify: true,
    confirm: true,
    expected: { granted: false, prompts: 0, notes: [] },
  },
  {
    name: "full access with UI and a notify surface -> grants without asking and posts the in-session note",
    hasUI: true,
    aborted: false,
    fullAccess: "on",
    notify: true,
    confirm: false,
    expected: { granted: true, prompts: 0, notes: NOTE },
  },
  {
    name: "full access with UI and a notify surface but no confirm surface -> still grants with the note",
    hasUI: true,
    aborted: false,
    fullAccess: "on",
    notify: true,
    confirm: "absent",
    expected: { granted: true, prompts: 0, notes: NOTE },
  },
  {
    name: "full access with UI but no notify surface -> the human confirm is asked and decides",
    hasUI: true,
    aborted: false,
    fullAccess: "on",
    notify: false,
    confirm: false,
    expected: { granted: false, prompts: 1, notes: [] },
  },
  {
    name: "full access with hasUI unset and a notify surface -> the human confirm is asked, no note",
    hasUI: undefined,
    aborted: false,
    fullAccess: "on",
    notify: true,
    confirm: true,
    expected: { granted: true, prompts: 1, notes: [] },
  },
  {
    name: "not full access with UI -> the human confirm is asked; yes grants",
    hasUI: true,
    aborted: false,
    fullAccess: "off",
    notify: true,
    confirm: true,
    expected: { granted: true, prompts: 1, notes: [] },
  },
  {
    name: "not full access with UI -> the human confirm is asked; no refuses",
    hasUI: true,
    aborted: false,
    fullAccess: "off",
    notify: true,
    confirm: false,
    expected: { granted: false, prompts: 1, notes: [] },
  },
  {
    name: "no fullAccess option with UI -> the human confirm is asked and decides",
    hasUI: true,
    aborted: false,
    fullAccess: "absent",
    notify: true,
    confirm: true,
    expected: { granted: true, prompts: 1, notes: [] },
  },
  {
    name: "not full access with UI and no confirm surface -> no grant, no note",
    hasUI: true,
    aborted: false,
    fullAccess: "off",
    notify: true,
    confirm: "absent",
    expected: { granted: false, prompts: 0, notes: [] },
  },
  {
    name: "full access with UI and no ui surfaces at all -> no grant",
    hasUI: true,
    aborted: false,
    fullAccess: "on",
    notify: false,
    confirm: "absent",
    expected: { granted: false, prompts: 0, notes: [] },
  },
]

async function settledWithin<T>(promise: Promise<T>, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const limit = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`waited ${SETTLE_LIMIT_MS} ms for ${label} to settle; it never did`)), SETTLE_LIMIT_MS)
  })
  try {
    return await Promise.race([promise, limit])
  } finally {
    clearTimeout(timer)
  }
}

describe("X18 characterization: confirmComputerControl decision table (K10, today's behaviour)", () => {
  for (const row of ROWS) {
    test(`#given ${row.name}`, async () => {
      // given
      let prompts = 0
      const notes: Array<{ message: string; level: string }> = []
      const answer = row.confirm
      const ui = {
        ...(row.notify
          ? { notify: (message: string, level: "info" | "warning" | "error") => notes.push({ message, level }) }
          : {}),
        ...(answer === "absent"
          ? {}
          : {
              confirm: () => {
                prompts += 1
                return Promise.resolve(answer)
              },
            }),
      }
      const context: ComputerHostContext = {
        cwd: "/work",
        model: undefined,
        sessionManager: { getSessionId: () => "session-x18", getSessionDir: () => "/work/.session-x18" },
        ...(row.hasUI === undefined ? {} : { hasUI: row.hasUI }),
        ...(Object.keys(ui).length === 0 ? {} : { ui }),
      }
      const controller = new AbortController()
      if (row.aborted) controller.abort()
      // A scheduler that never fires: no row may depend on the confirm timeout.
      const scheduleTimeout: ControlTimeoutScheduler = () => () => undefined
      const options =
        row.fullAccess === "absent"
          ? { scheduleTimeout }
          : { scheduleTimeout, fullAccess: () => row.fullAccess === "on" }

      // when
      const granted = await settledWithin(
        confirmComputerControl({ context, reason: REASON, signal: controller.signal }, options),
        row.name,
      )

      // then
      expect({ granted, prompts, notes }).toEqual({
        granted: row.expected.granted,
        prompts: row.expected.prompts,
        notes: [...row.expected.notes],
      })
    })
  }
})
