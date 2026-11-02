/// <reference types="bun-types" />

import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from "node:fs"
import { randomUUID } from "node:crypto"
import { tmpdir } from "node:os"
import { join, relative } from "node:path"
import { clearSessionAgent, setSessionAgent } from "../../features/claude-code-session-state"
import { createPrometheusMdOnlyHook } from "./hook"
import { parsePatch } from "./fixtures/opencode-patch-parser"
import { invokeBefore } from "./fixtures/invoke-before"

describe("B1 320 executor header combinations", () => {
  let root: string
  let sessionID: string
  const counts = { total: 0, correct: 0, outsideAllowed: 0, allowedDenied: 0 }
  const source = ".omo/plans/source.md"
  const allowed = ".omo/plans/allowed.md"
  const operations = ["Add File", "Update File", "Delete File", "Move to"]

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "prometheus-header-matrix-"))
    mkdirSync(join(root, ".omo/plans"), { recursive: true })
    sessionID = `ses_${randomUUID()}`
    setSessionAgent(sessionID, "prometheus")
  })
  afterEach(() => {
    clearSessionAgent(sessionID)
    rmSync(root, { recursive: true, force: true })
  })
  afterAll(() => {
    console.log(`B1_MATRIX ${JSON.stringify(counts)}`)
    expect(counts).toEqual({ total: 320, correct: 320, outsideAllowed: 0, allowedDenied: 0 })
  })

  for (const operation of operations) {
    for (const suffix of ["", "\r", "\r ", "\u2028", "\u2029"]) {
      for (const newline of ["\n", "\r\n"]) {
        for (const space of ["", " "]) {
          for (const mixed of [false, true]) {
            for (const outside of [false, true]) {
              test(`${operation} suffix=${JSON.stringify(suffix)} newline=${JSON.stringify(newline)} space=${space.length} mixed=${mixed} outside=${outside}`, async () => {
                const target = outside ? "src/outside.ts" : allowed
                const patchText = [
                  "*** Begin Patch",
                  ...(mixed ? [`*** Add File:${allowed}`, "+plan"] : []),
                  ...(operation === "Move to" ? [`*** Update File:${source}`] : []),
                  `*** ${operation}:${space}${target}${suffix}`,
                  ...(operation === "Delete File" ? [] : operation === "Add File" ? ["+after"] : ["@@", "-before", "+after"]),
                  "*** End Patch",
                ].join(newline)
                const hunks = parsePatch(patchText).hunks
                expect(hunks).toHaveLength(mixed ? 2 : 1)
                expect(hunks.at(-1)).toMatchObject(operation === "Move to"
                  ? { type: "update", path: source, move_path: target }
                  : { type: operation.split(" ")[0].toLowerCase(), path: target })
                const output = { args: { patchText } }
                const hook = createPrometheusMdOnlyHook({ directory: root, client: {} } as never)
                let permitted = false
                try {
                  await invokeBefore(hook, { tool: "apply_patch", sessionID, callID: "matrix" }, output)
                  permitted = true
                } catch {
                  permitted = false
                }
                counts.total++
                if (permitted !== outside) counts.correct++
                if (outside && permitted) counts.outsideAllowed++
                if (!outside && !permitted) counts.allowedDenied++
                expect(permitted).toBe(!outside)
                if (permitted) {
                  const executed = parsePatch(output.args.patchText).hunks.at(-1)
                  const expected = join(realpathSync.native(root), allowed)
                  expect(executed).toMatchObject(operation === "Move to"
                    ? { move_path: expected } : { path: expected })
                }
              })
            }
          }
        }
      }
    }
  }

  for (const planning of [".omo", "nested/project/.omo"]) {
    for (const suffix of ["\r ", "\u2028", "\u2029"]) {
      test(`mixed hidden Move into a symlink escape in ${planning}, suffix=${JSON.stringify(suffix)}`, async () => {
        mkdirSync(join(root, planning), { recursive: true })
        mkdirSync(join(root, "src/deep"), { recursive: true })
        symlinkSync(relative(join(root, planning), join(root, "src/deep")), join(root, planning, "redirect"), "dir")
        const patchText = [
          "*** Begin Patch", `*** Add File:${allowed}`, "+plan",
          `*** Update File:${planning}/source.md`,
          `*** Move to:${planning}/redirect/../escaped.md${suffix}`,
          "@@", "-before", "+after", "*** End Patch",
        ].join("\n")
        expect(parsePatch(patchText).hunks).toHaveLength(2)
        const hook = createPrometheusMdOnlyHook({ directory: root, client: {} } as never)
        await expect(invokeBefore(hook,
          { tool: "apply_patch", sessionID, callID: "mixed-move" }, { args: { patchText } },
        )).rejects.toThrow("File operations restricted")
      })
    }
  }
})
