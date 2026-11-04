/// <reference types="bun-types" />

// Plan row O1b (C3(b) + K1): on the hand of a split session the device's own exec setting decides foreground
// control. A hand has no UI to confirm on; once the user enabled exec on that device, any session acquires
// without a per-session confirm, and until then every remote acquire is refused. Fused sessions keep today's
// confirm exactly (X18, control-confirm.characterization.test.ts).

import { describe, expect, test } from "bun:test"

import type { ControlConfirmRequest } from "@oh-my-opencode/senpi-desktop-tool"

import { confirmComputerControl, type DeviceExecPolicy } from "./control-confirm"

type Context = ControlConfirmRequest["context"]

function request(context: Partial<Context>, signal = new AbortController().signal): ControlConfirmRequest {
  return { context: context as Context, reason: "click Run", signal, budgetMs: 60_000 }
}

function confirmCounter(answer: boolean): { readonly asked: string[]; readonly confirm: (title: string) => Promise<boolean> } {
  const asked: string[] = []
  return { asked, confirm: (title) => { asked.push(title); return Promise.resolve(answer) } }
}

function device(enabled: boolean): DeviceExecPolicy {
  return { enabled: () => enabled }
}

const hand = () => "hand" as const

describe("device exec policy for foreground control on a hand (O1b, C3(b))", () => {
  test("#given a fresh device that never enabled exec #when a hand session acquires #then it is refused and nobody is asked", async () => {
    // given
    const { asked, confirm } = confirmCounter(true)

    // when
    const granted = await confirmComputerControl(request({ hasUI: true, ui: { confirm, notify: () => undefined } } as Partial<Context>), { placement: hand, deviceExec: device(false) })

    // then
    expect(granted).toBe(false)
    expect(asked).toEqual([])
  })

  test("#given a device with exec enabled #when two hand sessions each acquire #then both are granted with zero confirms", async () => {
    // given
    const policy = { placement: hand, deviceExec: device(true) }

    // when
    const first = await confirmComputerControl(request({ hasUI: false }), policy)
    const second = await confirmComputerControl(request({ hasUI: false }), policy)

    // then
    expect([first, second]).toEqual([true, true])
  })

  test("#given a device with exec enabled #when the hand's run is already aborted #then no grant", async () => {
    // given
    const aborted = new AbortController()
    aborted.abort()

    // when
    const granted = await confirmComputerControl(request({ hasUI: false }, aborted.signal), { placement: hand, deviceExec: device(true) })

    // then
    expect(granted).toBe(false)
  })

  test("#given a hand placement with no device policy wired #when it acquires #then it is refused, the fresh-device default", async () => {
    // when
    const granted = await confirmComputerControl(request({ hasUI: false }), { placement: hand })

    // then
    expect(granted).toBe(false)
  })

  test("#given a fused headless session on a device with exec enabled #when it acquires #then today's rule holds and nothing is granted", async () => {
    // when
    const granted = await confirmComputerControl(request({ hasUI: false }), { placement: () => "fused", deviceExec: device(true) })

    // then
    expect(granted).toBe(false)
  })

  test("#given a fused session with UI on a device with exec enabled #when it acquires #then the human is still asked", async () => {
    // given
    const { asked, confirm } = confirmCounter(false)

    // when
    const granted = await confirmComputerControl(request({ hasUI: true, ui: { confirm, notify: () => undefined } } as Partial<Context>), { deviceExec: device(true) })

    // then
    expect(granted).toBe(false)
    expect(asked).toHaveLength(1)
  })
})
