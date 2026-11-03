/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { existsSync, lstatSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { randomUUID } from "node:crypto"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { clearSessionAgent, setSessionAgent } from "../../features/claude-code-session-state"
import { createPrometheusMdOnlyHook } from "./hook"
import { resolveAllowedFile } from "./path-policy"
import { parsePatch } from "./fixtures/opencode-patch-parser"
import { invokeBefore } from "./fixtures/invoke-before"

function patchText(header: string, path: string): string {
  return [
    "*** Begin Patch",
    ...(header === "Move to" ? ["*** Update File:.omo/source.md"] : []),
    `*** ${header}:${path}`,
    ...(header === "Delete File" ? [] : header === "Add File" ? ["+ORIGINAL"] : ["@@", "-before", "+after"]),
    "*** End Patch",
  ].join("\n")
}

// A filename capability probe, not a platform guess or a silent passing test.
const nameProbe = mkdtempSync(join(tmpdir(), "planner-name-capability-"))
let headerNamesSupported = true
try {
  writeFileSync(join(nameProbe, "line\n***\r:break.md"), "")
} catch (error) {
  if (!(error instanceof Error) || !("code" in error) ||
      !["EINVAL", "ENOTSUP", "EILSEQ", "ENOENT"].includes(String(error.code))) throw error
  headerNamesSupported = false
  console.warn(`Skipping native patch-name cases: filesystem rejects LF/CR/header filename bytes (${error.code})`)
} finally {
  rmSync(nameProbe, { recursive: true, force: true })
}

describe("planner delta serialization and physical boundaries", () => {
  let fixture: string
  let root: string
  let sessionID: string
  beforeEach(() => {
    fixture = realpathSync.native(mkdtempSync(join(tmpdir(), "planner-delta-")))
    root = join(fixture, "project")
    mkdirSync(root)
    sessionID = `ses_${randomUUID()}`
    setSessionAgent(sessionID, "prometheus")
  })
  afterEach(() => {
    clearSessionAgent(sessionID)
    rmSync(fixture, { recursive: true, force: true })
  })

  function invoke(tool: string, args: Record<string, unknown>, workspace = root) {
    return invokeBefore(createPrometheusMdOnlyHook({ directory: workspace, client: {} } as never),
      { tool, sessionID, callID: "delta" }, { args },
    )
  }

  for (const delimiter of ["\n", "\r"]) {
    for (const header of ["Add File", "Update File", "Move to"]) {
      for (const field of ["patchText", "input", "patch"]) {
        test.skipIf(!headerNamesSupported)(`SC-1 rejects ${JSON.stringify(delimiter)} physical ${header} through ${field} (filesystem capability)`, async () => {
          const target = join(root, ".omo", `benign.md${delimiter}*** Add File:src`, `outside.ts${delimiter}+INJECTED${delimiter}*** Add File:tail.md`)
          mkdirSync(dirname(target), { recursive: true })
          writeFileSync(target, "before\n")
          writeFileSync(join(root, ".omo/source.md"), "before\n")
          symlinkSync(target, join(root, ".omo/alias.md"))
          const args = { [field]: patchText(header, ".omo/alias.md") }
          await expect(invoke("apply_patch", args)).rejects.toThrow("Attempted to modify: .omo/alias.md.")
        })
      }
    }
  }

  test("SC-1 parser control: LF in a serialized filename becomes additional executable hunks", () => {
    const physical = `${root}/.omo/benign.md\n*** Add File:src/outside.ts\n+INJECTED\n*** Add File:tail.md`
    expect(parsePatch(patchText("Add File", physical)).hunks).toEqual([
      { type: "add", path: `${root}/.omo/benign.md`, contents: "" },
      { type: "add", path: "src/outside.ts", contents: "INJECTED" },
      { type: "add", path: "tail.md", contents: "ORIGINAL" },
    ])
  })

  test.skipIf(!headerNamesSupported)("SC-1 ordinary content writes retain LF filename bytes without patch serialization", async () => {
    mkdirSync(join(root, ".omo"))
    const physical = join(root, ".omo", "line\nbreak.md")
    writeFileSync(physical, "before")
    symlinkSync(physical, join(root, ".omo/alias.md"))
    const args = { filePath: ".omo/alias.md" }
    await invoke("write", args)
    expect(args.filePath).toBe(physical)
  })

  test("SC-1 preserves grammar-representable internal whitespace and Unicode", async () => {
    mkdirSync(join(root, ".omo"))
    const physical = join(root, ".omo", "space \t\u2028\u2029name.md")
    const args = { patchText: patchText("Add File", physical) }
    await invoke("apply_patch", args)
    expect(parsePatch(args.patchText).hunks).toEqual([{ type: "add", path: physical, contents: "ORIGINAL" }])
  })

  for (const spelling of ["relative", "alias-absolute", "physical-absolute", "safe-dotdot"]) {
    test(`SC-2 permits ${spelling} under a symlinked project root`, async () => {
      mkdirSync(join(root, ".omo"))
      mkdirSync(join(root, "deep/one/two"), { recursive: true })
      const alias = join(fixture, "workspace")
      symlinkSync(root, alias, "dir")
      symlinkSync("deep/one/two", join(root, "redirect"), "dir")
      const physical = join(realpathSync.native(root), ".omo/new.md")
      const filePath = spelling === "relative" ? ".omo/new.md"
        : spelling === "alias-absolute" ? `${alias}/.omo/new.md`
        : spelling === "safe-dotdot" ? "redirect/../../../.omo/new.md"
        : physical
      const args = { filePath }
      await invoke("write", args, alias)
      expect(args.filePath).toBe(physical)
    })
  }

  for (const target of [".", ".."]) {
    test(`Opus rejects a physical planning alias to ${target}`, async () => {
      symlinkSync(target, join(root, ".omo"), "dir")
      expect(resolveAllowedFile(".omo/README.md", root)).toBeUndefined()
    })
  }

  for (const target of ["src", "docs/plans"]) {
    test(`a planning alias to the in-project ${target} keeps the user's layout`, async () => {
      mkdirSync(join(root, target), { recursive: true })
      symlinkSync(target, join(root, ".omo"), "dir")
      expect(resolveAllowedFile(".omo/plans/x.md", root)).toBe(join(root, target, "plans/x.md"))
      const args = { filePath: ".omo/README.md" }
      await invoke("write", args)
      expect(args.filePath).toBe(join(root, target, "README.md"))
    })
  }

  describe("every denial is logged with its specific reason", () => {
    const denials: { name: string; tool: string; args: Record<string, unknown>; frozen?: boolean; reason: string; setup?: () => void }[] = [
      {
        name: "content write through a link leaving .omo",
        tool: "write",
        args: { filePath: ".omo/out.md" },
        reason: ".omo/out.md",
        setup: () => {
          mkdirSync(join(root, "src"))
          symlinkSync("../src/out.md", join(root, ".omo/out.md"))
        },
      },
      {
        name: "delete of a link leaving .omo",
        tool: "edit",
        args: { filePath: ".omo/out.md", delete: true, edits: [] },
        reason: ".omo/out.md",
        setup: () => {
          mkdirSync(join(root, "src"))
          writeFileSync(join(root, "src/out.md"), "x")
          symlinkSync("../src/out.md", join(root, ".omo/out.md"))
        },
      },
      {
        name: "patch whose executable targets differ from the authorized ones",
        tool: "apply_patch",
        args: { patchText: "*** Begin Patch\n*** Add File:.omo/new.md\n+ORIGINAL\n*** End Patch\n*** Delete File:.omo/ignored.md" },
        reason: "(patch target round trip)",
      },
      {
        name: "rewrite that cannot reach frozen host arguments",
        tool: "write",
        args: { filePath: ".omo\\new.md" },
        frozen: true,
        reason: "(tool arguments did not reach execution)",
      },
      {
        name: "unrecognized file argument",
        tool: "write",
        args: { content: "x" },
        reason: "(unrecognized file argument)",
      },
    ]
    for (const denial of denials) {
      test(denial.name, async () => {
        mkdirSync(join(root, ".omo"))
        denial.setup?.()
        const logDir = join(fixture, "log")
        mkdirSync(logDir)
        const child = Bun.spawn([
          process.execPath, "run", join(import.meta.dir, "fixtures/denial-log.ts"),
          denial.tool, JSON.stringify(denial.args), ...(denial.frozen ? ["frozen"] : []),
        ], { cwd: root, stdout: "pipe", stderr: "pipe", env: { ...process.env, TMPDIR: logDir, TEMP: logDir, TMP: logDir } })
        const [stdout, stderr, code] = await Promise.all([
          new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
        ])
        expect(code, stderr).toBe(0)
        const result = JSON.parse(stdout) as { error?: string; blocked: string[] }
        expect(result.error).toContain(`Attempted to modify: ${denial.reason}.`)
        expect(result.blocked).toEqual([denial.reason])
      })
    }
  })

  test("Opus rejects a nested planning alias to the project root", () => {
    mkdirSync(join(root, "nested"))
    symlinkSync("..", join(root, "nested/.omo"), "dir")
    expect(resolveAllowedFile("nested/.omo/README.md", root)).toBeUndefined()
  })

  test("Opus permits an alias to another real nested .omo", () => {
    mkdirSync(join(root, "nested/.omo"), { recursive: true })
    symlinkSync("nested/.omo", join(root, ".omo"), "dir")
    expect(resolveAllowedFile(".omo/new.md", root)).toBe(join(root, "nested/.omo/new.md"))
  })

  test("Opus rejects an uncreated uppercase directory without a physical .omo identity", () => {
    expect(resolveAllowedFile(".OMO/new.md", root)).toBeUndefined()
  })

  test("Opus follows native directory casing rather than guessing by platform", () => {
    mkdirSync(join(root, ".omo"))
    const alias = join(root, ".OMO")
    const sameEntry = existsSync(alias) && lstatSync(alias).ino === lstatSync(join(root, ".omo")).ino
    expect(resolveAllowedFile(".OMO/new.md", root)).toBe(sameEntry ? join(root, ".omo/new.md") : undefined)
  })

  test("case-sensitive nonplanning folders remain writable beneath a real .omo", () => {
    mkdirSync(join(root, ".omo"))
    expect(resolveAllowedFile(".omo/.OMO/new.md", root)).toBe(join(root, ".omo/.OMO/new.md"))
  })

  for (const frozen of [false, true]) {
    test(`host retained-reference handoff ${frozen ? "rejects immutable rewriting" : "observes in-place rewriting"}`, async () => {
      mkdirSync(join(root, ".omo"))
      const args = { filePath: ".omo\\new.md" }
      if (frozen) Object.freeze(args)
      if (frozen) await expect(invoke("write", args)).rejects.toThrow("(tool arguments did not reach execution)")
      else {
        await invoke("write", args)
        expect(args.filePath).toBe(join(root, ".omo/new.md"))
      }
    })
  }

  test("host retained-reference handoff permits already canonical frozen arguments", async () => {
    mkdirSync(join(root, ".omo"))
    const args = Object.freeze({ filePath: join(root, ".omo/new.md") })
    await expect(invoke("write", args)).resolves.toBeUndefined()
  })

  test("host retained-reference handoff permits canonical frozen patch spacing and CRLF", async () => {
    mkdirSync(join(root, ".omo"))
    const canonical = join(root, ".omo/new.md")
    const text = `\r\n*** Begin Patch\r\n*** Add File:  ${canonical}\r\n+ORIGINAL\r\n*** End Patch\r\n`
    const args = Object.freeze({ patchText: text })
    await expect(invoke("apply_patch", args)).resolves.toBeUndefined()
    expect(parsePatch(args.patchText).hunks).toEqual([{ type: "add", path: canonical, contents: "ORIGINAL\r" }])
  })

  for (const text of [
    "*** Begin Patch\n*** Move to:.omo/new.md\n*** End Patch",
    "*** Begin Patch\n*** Add File:.omo/new.md\n+ORIGINAL\n*** End Patch\n*** Delete File:.omo/ignored.md",
  ]) {
    test(`SC-1 requires executable operations to match every authorized target (${text.includes("ignored") ? "post-End header" : "standalone Move"})`, async () => {
      mkdirSync(join(root, ".omo"))
      await expect(invoke("apply_patch", { patchText: text })).rejects.toThrow("(patch target round trip)")
    })
  }

  for (const header of ["Delete File", "Move to"]) {
    test(`Opus ${header} keeps the named final symlink entry`, async () => {
      mkdirSync(join(root, ".omo"))
      writeFileSync(join(root, ".omo/real.md"), "before\n")
      symlinkSync("real.md", join(root, ".omo/alias.md"))
      const text = header === "Delete File" ? patchText(header, ".omo/alias.md")
        : "*** Begin Patch\n*** Update File:.omo/alias.md\n*** Move to:.omo/moved.md\n@@\n-before\n+after\n*** End Patch"
      const args = { patchText: text }
      await invoke("apply_patch", args)
      expect(parsePatch(args.patchText).hunks[0].path).toBe(join(root, ".omo/alias.md"))
    })
  }
})
