/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { randomUUID } from "node:crypto"
import { tmpdir } from "node:os"
import { join, relative } from "node:path"
import { clearSessionAgent, setSessionAgent } from "../../features/claude-code-session-state"
import { createPrometheusMdOnlyHook } from "./hook"
import { invokeBefore } from "./fixtures/invoke-before"

describe("physical planner destinations (B2-R)", () => {
  let fixture: string
  let root: string
  let sessionID: string

  beforeEach(() => {
    fixture = mkdtempSync(join(tmpdir(), "prometheus-physical-"))
    root = join(fixture, "project")
    sessionID = `ses_${randomUUID()}`
    mkdirSync(join(root, "src/deep"), { recursive: true })
    mkdirSync(join(fixture, "outside"))
    writeFileSync(join(root, "src/escaped.md"), "original\n")
    setSessionAgent(sessionID, "prometheus")
  })

  afterEach(() => {
    clearSessionAgent(sessionID)
    rmSync(fixture, { recursive: true, force: true })
  })

  function invoke(tool: string, args: Record<string, unknown>) {
    const hook = createPrometheusMdOnlyHook({ directory: root, client: {} } as never)
    return invokeBefore(hook, { tool, sessionID, callID: "physical" }, { args })
  }

  const calls = [
    { tool: "write", kind: "write", args: (path: string) => ({ filePath: path, content: "probe" }) },
    { tool: "edit", kind: "edit", args: (path: string) => ({ filePath: path, edits: [{ op: "append", lines: ["probe"] }] }) },
    { tool: "edit", kind: "rename", args: (path: string) => ({ filePath: ".omo/source.md", rename: path, edits: [{ op: "append", lines: ["probe"] }] }) },
    ...["Add File", "Update File", "Delete File", "Move to"].map(header => ({
      tool: "apply_patch",
      kind: header,
      args: (path: string) => ({
        patchText: [
          "*** Begin Patch",
          ...(header === "Move to" ? ["*** Update File: .omo/source.md"] : []),
          `*** ${header}:${path}`,
          ...(header === "Delete File" ? [] : header === "Add File" ? ["+probe"] : ["@@", "-original", "+probe"]),
          "*** End Patch",
        ].join("\n"),
      }),
    })),
  ]

  for (const planning of [".omo", "nested/project/.omo"]) {
    for (const depth of [0, 1, 3]) {
      for (const spelling of ["plain", "dot"]) {
        for (const link of ["single", "chain", "dangling", "missing-before"]) {
          for (const absolute of [false, true]) {
            for (const call of calls) {
              test(`${planning} depth=${depth} ${spelling} ${link} absolute=${absolute} ${call.kind}`, async () => {
                const parent = [planning, ...Array.from({ length: depth }, (_, i) => `level${i}`)].join("/")
                mkdirSync(join(root, parent), { recursive: true })
                mkdirSync(join(root, ".omo"), { recursive: true })
                const outside = join(root, link === "dangling" ? "src/missing/deep" : "src/deep")
                if (link === "chain") {
                  symlinkSync(relative(join(root, parent), outside), join(root, parent, "middle"), "dir")
                  symlinkSync("middle", join(root, parent, "redirect"), "dir")
                } else {
                  symlinkSync(relative(join(root, parent), outside), join(root, parent, "redirect"), "dir")
                }
                let target = `${parent}/${link === "missing-before" ? "uncreated/../" : ""}redirect/../escaped.md`
                if (spelling === "dot") target = `./${target.replaceAll("/", "/./")}`
                if (absolute) target = `${root}/${target}`
                await expect(invoke(call.tool, call.args(target))).rejects.toThrow("File operations restricted")
              })
            }
          }
        }
      }
    }

    for (const separators of ["slash", "backslash", "mixed"]) {
      test(`${planning} remains writable with ${separators} separators`, async () => {
        const path = `${planning}/plans/new.md`
        const filePath = separators === "backslash" ? path.replaceAll("/", "\\")
          : separators === "mixed" ? path.replace("/plans/", "\\plans/") : path
        await expect(invoke("write", { filePath, content: "plan" })).resolves.toBeUndefined()
      })
    }

    test(`${planning} may alias another real .omo directory inside the project`, async () => {
      mkdirSync(join(root, "plans/.omo"), { recursive: true })
      mkdirSync(join(root, planning, ".."), { recursive: true })
      symlinkSync(relative(join(root, planning, ".."), join(root, "plans/.omo")), join(root, planning), "dir")
      await expect(invoke("write", { filePath: `${planning}/new.md`, content: "plan" })).resolves.toBeUndefined()
    })

    test(`${planning} cannot alias a directory outside the project`, async () => {
      mkdirSync(join(root, planning, ".."), { recursive: true })
      symlinkSync(relative(join(root, planning, ".."), join(fixture, "outside")), join(root, planning), "dir")
      await expect(invoke("write", { filePath: `${planning}/new.md`, content: "plan" }))
        .rejects.toThrow("File operations restricted")
    })
  }
})
