/// <reference types="bun-types" />

// Plan row O4 (comment-checker on a split session; Z2.LIFE.O4). The checker skips a file it already reported in
// the current turn and clears that record on the next turn start. On a split session the edit runs on the hand, so
// the reset must still reach the checker that holds the record; and several sessions in one process stay isolated:
// session A's record survives session B's turn start.

import { afterEach, describe, expect, test } from "bun:test"
import { basename } from "node:path"

import type { CheckResult, RunCommentCheckerInput } from "@oh-my-opencode/comment-checker-core"
import { Type } from "typebox"

import { composeOmoSenpiExtension } from "../../extension/compose"
import type { OmoSenpiComponent } from "../../extension/types"
import { openScriptedSession, type Placement, type ScriptedSession } from "../../../test-support/split-local-session"
import { createCommentCheckerComponent } from "./index"

const violation: CheckResult = { hasComments: true, message: "line 1: redundant comment" }
const sessions: ScriptedSession[] = []
afterEach(async () => {
  for (const session of sessions.splice(0)) await session.close()
})

function checkerComponent(checked: string[], hold?: (input: RunCommentCheckerInput) => Promise<void>): OmoSenpiComponent {
  return createCommentCheckerComponent({
    resolveBinary: () => "/fake/comment-checker",
    downloadBinary: async () => null,
    runCommentChecker: async (input) => {
      checked.push(basename(String(input.hookInput.tool_input.file_path)))
      await hold?.(input)
      return violation
    },
  })
}

function compose(...components: OmoSenpiComponent[]) {
  return composeOmoSenpiExtension(components) as (pi: never) => unknown
}

function gateComponent(reached: PromiseWithResolvers<void>, released: Promise<void>): OmoSenpiComponent {
  return {
    name: "gate",
    register(pi) {
      pi.registerTool({
        name: "gate",
        label: "gate",
        description: "waits until the test releases it",
        parameters: Type.Object({}, { additionalProperties: true }),
        execute: async () => {
          reached.resolve()
          await released
          return { content: [{ type: "text", text: "released" }], details: {} }
        },
      })
    },
  }
}

async function open(placement: Placement, extension: (pi: never) => unknown): Promise<ScriptedSession> {
  const session = await openScriptedSession(placement, extension)
  sessions.push(session)
  return session
}

async function within(signal: Promise<void>, ms: number, what: string): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`waited ${ms} ms for ${what}, never happened`)), ms) })
  try {
    await Promise.race([signal, timeout])
  } finally {
    clearTimeout(timer)
  }
}

const writeA = ["write", { path: "a.ts", content: "// redundant\nexport const a = 1\n" }] as const

describe("comment-checker turn reset on a split session (O4)", () => {
  for (const placement of ["fused", "split-local"] as const) {
    test(`#given ${placement} #when a reported file is written again in the same turn and then in the next turn #then it is skipped in the turn and checked again after the turn starts`, async () => {
      // given
      const checked: string[] = []
      const session = await open(placement, compose(checkerComponent(checked)))

      // when
      await session.turn([writeA, writeA])
      await session.turn([writeA])

      // then
      expect(checked).toEqual(["a.ts", "a.ts"])
      expect(session.handToolCalls()).toBe(placement === "split-local" ? 3 : 0)
    })
  }

  test("#given one comment-checker component loaded by sessions A and B in one process, as omo's entry shares it (MULTI) #when B runs a whole turn between A's two writes of the same file in one turn #then A's second write is still skipped", async () => {
    // given
    const checked: string[] = []
    const [release, aAtGate] = [Promise.withResolvers<void>(), Promise.withResolvers<void>()]
    const shared = checkerComponent(checked)
    const a = await open("split-local", compose(shared, gateComponent(aAtGate, release.promise)))
    const b = await open("split-local", compose(shared))

    // when
    const aTurn = a.turn([writeA, ["gate", {}], writeA])
    await within(aAtGate.promise, 30_000, "session A to reach the gate between its writes")
    await b.turn([["write", { path: "b.ts", content: "// redundant\nexport const b = 1\n" }]])
    release.resolve()
    await aTurn

    // then
    expect(checked).toEqual(["a.ts", "b.ts"])
  })
})
