/// <reference types="bun-types" />

// Plan row O4 split-session proof (Z2.LIFE.O4, with #12442's per-session fix covering several sessions). On a split
// session the edit runs on the hand; the per-turn reset must still reach the checker that holds the record, exactly as
// on a fused session. Needs the engine release that forwards a two-sided extension's tool hooks (S29).

import { afterEach, describe, expect, test } from "bun:test"
import { basename } from "node:path"

import type { CheckResult } from "@oh-my-opencode/comment-checker-core"

import { composeOmoSenpiExtension } from "../../extension/compose"
import { openScriptedSession, type ScriptedSession } from "../../../test-support/split-local-session"
import { createCommentCheckerComponent } from "./index"

const violation: CheckResult = { hasComments: true, message: "line 1: redundant comment" }
const sessions: ScriptedSession[] = []
afterEach(async () => {
  for (const session of sessions.splice(0)) await session.close()
})

const writeA = ["write", { path: "a.ts", content: "// redundant\nexport const a = 1\n" }] as const

describe("comment-checker turn reset on a split session (O4)", () => {
  for (const placement of ["fused", "split-local"] as const) {
    test(`#given ${placement} #when a reported file is written again in the same turn and then in the next turn #then it is skipped in the turn and checked again after the turn starts`, async () => {
      // given
      const checked: string[] = []
      const component = createCommentCheckerComponent({
        resolveBinary: () => "/fake/comment-checker",
        downloadBinary: async () => null,
        runCommentChecker: async (input) => {
          checked.push(basename(String(input.hookInput.tool_input.file_path)))
          return violation
        },
      })
      const session = await openScriptedSession(placement, composeOmoSenpiExtension([component]) as (pi: never) => unknown)
      sessions.push(session)

      // when
      await session.turn([writeA, writeA])
      await session.turn([writeA])

      // then
      expect(checked).toEqual(["a.ts", "a.ts"])
      expect(session.handToolCalls()).toBe(placement === "split-local" ? 3 : 0)
    })
  }
})
