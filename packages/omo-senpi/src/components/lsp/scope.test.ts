/// <reference types="bun-types" />

// Plan row O5 (lsp on a split session; Z2.LIFE.O5). Post-edit diagnostics remember, per session, which file
// extensions have no language server and skip them for the rest of the session. On a split session the edit runs
// on the hand, so that record must still be keyed to the session that owns the call; and several sessions in one
// process keep separate records.

import { afterEach, describe, expect, test } from "bun:test"
import { basename } from "node:path"

import { composeOmoSenpiExtension } from "../../extension/compose"
import type { OmoSenpiComponent } from "../../extension/types"
import { createFormatterStep } from "../formatter/formatter"
import { openScriptedSession, type Placement, type ScriptedSession } from "../../../test-support/split-local-session"
import { createLspComponent } from "./index"

const sessions: ScriptedSession[] = []
afterEach(async () => {
  for (const session of sessions.splice(0)) await session.close()
})

function notConfigured(filePath: string) {
  const extension = filePath.slice(filePath.lastIndexOf(".")).toLowerCase()
  return {
    content: [{ type: "text" as const, text: `No LSP server configured for extension: ${extension}` }],
    details: { availability: { kind: "not_configured", extension } },
  }
}

function lspComponent(checked: string[]): OmoSenpiComponent {
  return createLspComponent({
    formatter: createFormatterStep({ config: { mode: "off" } }),
    callDaemonTool: async (name, args) => {
      if (name !== "lsp_diagnostics") throw new Error(`unexpected daemon tool ${name}`)
      const filePath = String(args["filePath"])
      checked.push(basename(filePath))
      return notConfigured(filePath)
    },
  })
}

function compose(component: OmoSenpiComponent) {
  return composeOmoSenpiExtension([component]) as (pi: never) => unknown
}

async function open(placement: Placement, extension: (pi: never) => unknown): Promise<ScriptedSession> {
  const session = await openScriptedSession(placement, extension)
  sessions.push(session)
  return session
}

const write = (path: string) => ["write", { path, content: "x\n" }] as const

describe("lsp post-edit skip on a split session (O5)", () => {
  for (const placement of ["fused", "split-local"] as const) {
    test(`#given ${placement} #when an extension reported not configured is edited again in a later turn #then the session still skips it`, async () => {
      // given
      const checked: string[] = []
      const session = await open(placement, compose(lspComponent(checked)))

      // when
      await session.turn([write("a.foo")])
      await session.turn([write("b.foo")])

      // then
      expect(checked).toEqual(["a.foo"])
      expect(session.handToolCalls()).toBe(placement === "split-local" ? 2 : 0)
    })
  }

  test("#given one lsp component loaded by sessions A and B in one process, as omo's entry shares it (MULTI) #when A learns an extension is not configured #then B still checks it once and A keeps skipping", async () => {
    // given
    const checked: string[] = []
    const shared = lspComponent(checked)
    const a = await open("split-local", compose(shared))
    const b = await open("split-local", compose(shared))

    // when
    await a.turn([write("a.foo")])
    await b.turn([write("b.foo")])
    await b.turn([write("c.foo")])
    await a.turn([write("d.foo")])

    // then
    expect(checked).toEqual(["a.foo", "b.foo"])
  })
})
