/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, relative } from "node:path"

describe("real guarded hashline execution", () => {
  let root: string

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "guarded-hashline-"))
    mkdirSync(join(root, "src/deep"), { recursive: true })
    writeFileSync(join(root, "src/escaped.md"), "outside\n")
  })
  afterEach(() => rmSync(root, { recursive: true, force: true }))

  async function execute(filePath: string, rename?: string, frozen = false, deleteMode = false) {
    const child = Bun.spawn([
      process.execPath, "run", join(import.meta.dir, "fixtures/guarded-hashline.ts"),
      JSON.stringify({ filePath, rename, ...(deleteMode ? { delete: true, edits: [] } : { edits: [{ op: "append", lines: ["probe"] }] }) }),
      ...(frozen ? ["frozen"] : []),
    ], { cwd: root, stdout: "pipe", stderr: "pipe" })
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
    ])
    expect(code, stderr).toBe(0)
    return JSON.parse(stdout) as { blocked: boolean; result?: string; filePath?: string; rename?: string }
  }

  for (const planning of [".omo", "nested/project/.omo"]) {
    for (const rename of [false, true]) {
      test(`${planning} blocks a relative ${rename ? "rename" : "edit"} before the real executor`, async () => {
        mkdirSync(join(root, planning), { recursive: true })
        writeFileSync(join(root, planning, "source.md"), "source\n")
        symlinkSync(relative(join(root, planning), join(root, "src/deep")), join(root, planning, "redirect"), "dir")
        const target = `${planning}/redirect/../escaped.md`
        const result = await execute(rename ? `${planning}/source.md` : target, rename ? target : undefined)
        expect(result.blocked).toBe(true)
        expect(readFileSync(join(root, "src/escaped.md"), "utf8")).toBe("outside\n")
        expect(readFileSync(join(root, planning, "source.md"), "utf8")).toBe("source\n")
      })

      test(`${planning} executes a physical internal ${rename ? "rename" : "edit"} without changing its lexical decoy`, async () => {
        mkdirSync(join(root, planning, "inside/deep"), { recursive: true })
        writeFileSync(join(root, planning, "source.md"), "source\n")
        writeFileSync(join(root, planning, "inside/expected.md"), "before\n")
        writeFileSync(join(root, planning, "expected.md"), "decoy\n")
        symlinkSync("inside/deep", join(root, planning, "redirect"), "dir")
        const target = `${planning}/redirect/../expected.md`
        const result = await execute(rename ? `${planning}/source.md` : target, rename ? target : undefined)
        expect(result.blocked).toBe(false)
        expect(result.result).toMatch(/^(Updated|Moved) /)
        const physical = join(root, planning, "inside/expected.md")
        expect(readFileSync(physical, "utf8")).toContain("probe")
        expect(readFileSync(join(root, planning, "expected.md"), "utf8")).toBe("decoy\n")
        expect(rename ? result.rename : result.filePath).toBe(realpathSync.native(physical))
        if (rename) expect(existsSync(join(root, planning, "source.md"))).toBe(false)
      })
    }

    test(`${planning} creates missing parents with canonical frozen hook arguments`, async () => {
      mkdirSync(join(root, planning), { recursive: true })
      const result = await execute(join(realpathSync.native(root), planning, "new/deep/plan.md"), undefined, true)
      expect(result.blocked).toBe(false)
      expect(result.result).toMatch(/^Updated /)
      expect(readFileSync(join(root, planning, "new/deep/plan.md"), "utf8")).toContain("probe")
    })
  }

  test("an allowed final symlink stays a symlink while the real target is edited", async () => {
    mkdirSync(join(root, ".omo"))
    writeFileSync(join(root, ".omo/real.md"), "before\n")
    symlinkSync("real.md", join(root, ".omo/alias.md"))
    const result = await execute(".omo/alias.md")
    expect(result.blocked).toBe(false)
    expect(result.result).toMatch(/^Updated /)
    expect(readFileSync(join(root, ".omo/real.md"), "utf8")).toContain("probe")
    expect(lstatSync(join(root, ".omo/alias.md")).isSymbolicLink()).toBe(true)
  })

  test("the retained host reference cannot create a backslash filename outside .omo from frozen args", async () => {
    mkdirSync(join(root, ".omo"))
    const result = await execute(".omo\\escaped.md", undefined, true)
    expect(result.blocked).toBe(true)
    expect(existsSync(join(root, ".omo\\escaped.md"))).toBe(false)
  })

  for (const deletion of [false, true]) {
    test(`real ${deletion ? "delete" : "rename"} removes the named link rather than its allowed target`, async () => {
      mkdirSync(join(root, ".omo"))
      writeFileSync(join(root, ".omo/real.md"), "before\n")
      symlinkSync("real.md", join(root, ".omo/alias.md"))
      const result = await execute(".omo/alias.md", deletion ? undefined : ".omo/moved.md", false, deletion)
      expect(result.blocked).toBe(false)
      expect(result.result).toMatch(deletion ? /^Successfully deleted / : /^Moved /)
      expect(existsSync(join(root, ".omo/real.md"))).toBe(true)
      expect(() => lstatSync(join(root, ".omo/alias.md"))).toThrow()
      if (deletion) expect(readFileSync(join(root, ".omo/real.md"), "utf8")).toBe("before\n")
      else expect(readFileSync(join(root, ".omo/moved.md"), "utf8")).toContain("probe")
    })
  }
})
