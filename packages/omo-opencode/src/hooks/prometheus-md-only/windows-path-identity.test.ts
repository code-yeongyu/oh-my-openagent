/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { randomUUID } from "node:crypto"
import { tmpdir } from "node:os"
import { join, parse, sep } from "node:path"
import { clearSessionAgent, setSessionAgent } from "../../features/claude-code-session-state"
import { createPrometheusMdOnlyHook } from "./hook"
import { resolveAllowedFile } from "./path-policy"
import { invokeBefore } from "./fixtures/invoke-before"
import { resolveFileWritePath } from "../../shared/resolve-file-write-path"

const win32 = process.platform === "win32"

function attempt(compute: () => string | undefined): string | undefined {
  try {
    return compute()
  } catch (error) {
    return `error:${error instanceof Error && "code" in error ? String(error.code) : String(error)}`
  }
}

function shortSpelling(directory: string): string | undefined {
  if (!win32) return undefined
  // cmd's %~sI fully qualifies a \"-escaped argument against the cwd drive, so ask the FileSystemObject instead.
  const result = Bun.spawnSync([
    "powershell.exe", "-NoProfile", "-NonInteractive", "-Command",
    `(New-Object -ComObject Scripting.FileSystemObject).GetFolder('${directory.replace(/'/g, "''")}').ShortPath`,
  ], { stdout: "pipe", stderr: "pipe" })
  const short = result.stdout.toString().trim()
  return result.success && short.length > 0 && short.toLowerCase() !== directory.toLowerCase() ? short : undefined
}

// Capability probes, not platform guesses: each skipped form logs why the volume cannot build it.
const probe = mkdtempSync(join(tmpdir(), "planner-identity-probe-"))
let shortNamesSupported = false
let caseVariantSiblingsSupported = false
try {
  if (win32) {
    if (shortSpelling(probe) === undefined) {
      // 8.3 generation may be disabled for the volume; an explicit short name still needs admin.
      Bun.spawnSync(["fsutil", "file", "setShortName", probe, "PLANID~1"], { stdout: "pipe", stderr: "pipe" })
    }
    shortNamesSupported = shortSpelling(probe) !== undefined
    if (!shortNamesSupported) console.warn("Skipping the 8.3 short-name form: the volume keeps no short names and refuses fsutil setShortName")
  } else {
    console.warn("Skipping the 8.3 short-name and drive-letter forms: not a Windows volume")
  }
  mkdirSync(join(probe, ".omo"))
  try {
    mkdirSync(join(probe, ".OMO"))
    caseVariantSiblingsSupported = lstatSync(join(probe, ".OMO")).ino !== lstatSync(join(probe, ".omo")).ino
  } catch (error) {
    if (!(error instanceof Error) || !("code" in error) || error.code !== "EEXIST") throw error
  }
  if (!caseVariantSiblingsSupported) console.warn("Skipping the case-variant sibling form: the volume folds .omo and .OMO into one entry")
} finally {
  rmSync(probe, { recursive: true, force: true })
}

interface AliasLayout {
  readonly workspace?: string
  readonly spelling: string
  readonly expected: string | undefined
  readonly escape: string
}

interface AliasForm {
  readonly name: string
  readonly skip: boolean
  readonly build: (project: string) => AliasLayout
}

describe("Windows path identity: every alias form resolves to the executor's physical path (#11541)", () => {
  let fixture: string
  let project: string
  let sessionID: string

  beforeEach(() => {
    // Deliberately not realpath'd: the runner's temp root may itself be an 8.3 alias.
    fixture = mkdtempSync(join(tmpdir(), "planner-identity-"))
    project = join(fixture, "project")
    mkdirSync(join(project, "src/deep"), { recursive: true })
    writeFileSync(join(project, "src/escaped.md"), "outside\n")
    sessionID = `ses_${randomUUID()}`
    setSessionAgent(sessionID, "prometheus")
  })
  afterEach(() => {
    clearSessionAgent(sessionID)
    rmSync(fixture, { recursive: true, force: true })
  })

  function invoke(args: Record<string, unknown>, workspace: string) {
    return invokeBefore(createPrometheusMdOnlyHook({ directory: workspace, client: {} } as never),
      { tool: "write", sessionID, callID: "identity" }, { args },
    )
  }

  function planningWithLinks(project: string, kind: "dir" | "junction"): void {
    mkdirSync(join(project, ".omo/inside/deep"), { recursive: true })
    mkdirSync(join(project, ".omo/plans"))
    writeFileSync(join(project, ".omo/plan.md"), "decoy\n")
    writeFileSync(join(project, ".omo/inside/plan.md"), "before\n")
    if (kind === "junction") {
      symlinkSync(join(project, ".omo/inside/deep"), join(project, ".omo/redirect"), "junction")
      symlinkSync(join(project, "src/deep"), join(project, ".omo/escape"), "junction")
    } else {
      symlinkSync("inside/deep", join(project, ".omo/redirect"), "dir")
      symlinkSync("../src/deep", join(project, ".omo/escape"), "dir")
    }
  }

  function linkedPlanning(project: string, kind: "dir" | "junction"): void {
    mkdirSync(join(project, "docs/plans/plans"), { recursive: true })
    if (kind === "junction") {
      symlinkSync(join(project, "docs/plans"), join(project, ".omo"), "junction")
      symlinkSync(join(project, "src/deep"), join(project, "docs/plans/escape"), "junction")
    } else {
      symlinkSync("docs/plans", join(project, ".omo"), "dir")
      symlinkSync("../../src/deep", join(project, "docs/plans/escape"), "dir")
    }
  }

  function swapDriveCase(path: string): string {
    return path.replace(/^([A-Za-z]):/, (_, letter: string) => `${letter === letter.toUpperCase() ? letter.toLowerCase() : letter.toUpperCase()}:`)
  }

  const forms: AliasForm[] = [
    {
      name: "directory symlink inside and out of .omo",
      skip: false,
      build: (project) => {
        planningWithLinks(project, "dir")
        return {
          spelling: ".omo/redirect/../plan.md",
          expected: join(realpathSync.native(project), ".omo", "inside", "plan.md"),
          escape: ".omo/escape/../escaped.md",
        }
      },
    },
    {
      name: "directory junction inside and out of .omo",
      skip: false,
      build: (project) => {
        planningWithLinks(project, "junction")
        return {
          spelling: ".omo/redirect/../plan.md",
          expected: join(realpathSync.native(project), ".omo", "inside", "plan.md"),
          escape: ".omo/escape/../escaped.md",
        }
      },
    },
    {
      name: "symlinked planning directory (.omo -> docs/plans)",
      skip: false,
      build: (project) => {
        linkedPlanning(project, "dir")
        return {
          spelling: ".omo/plans/x.md",
          expected: join(realpathSync.native(project), "docs", "plans", "plans", "x.md"),
          escape: ".omo/escape/../escaped.md",
        }
      },
    },
    {
      name: "junction planning directory (.omo -> docs/plans)",
      skip: false,
      build: (project) => {
        linkedPlanning(project, "junction")
        return {
          spelling: ".omo/plans/x.md",
          expected: join(realpathSync.native(project), "docs", "plans", "plans", "x.md"),
          escape: ".omo/escape/../escaped.md",
        }
      },
    },
    {
      name: "8.3 short-name ancestor spelling",
      skip: !shortNamesSupported,
      build: (project) => {
        planningWithLinks(project, "dir")
        const short = shortSpelling(project)
        if (short === undefined) throw new Error("the probe found 8.3 names but the project directory has none")
        expect(short.toLowerCase()).not.toBe(realpathSync.native(project).toLowerCase())
        return {
          workspace: short,
          spelling: `${short}\\.omo\\plans\\x.md`,
          expected: join(realpathSync.native(project), ".omo", "plans", "x.md"),
          escape: `${short}/.omo/escape/../escaped.md`,
        }
      },
    },
    {
      name: "case-different drive letter",
      skip: !win32,
      build: (project) => {
        planningWithLinks(project, "dir")
        const swapped = swapDriveCase(project)
        expect(swapped).not.toBe(project)
        return {
          workspace: swapped,
          spelling: `${swapped}\\.omo\\plans\\x.md`,
          expected: join(realpathSync.native(project), ".omo", "plans", "x.md"),
          escape: `${swapped}\\.omo\\escape\\..\\escaped.md`,
        }
      },
    },
    {
      name: "case-different directory spelling",
      skip: false,
      build: (project) => {
        planningWithLinks(project, "dir")
        const alias = join(project, ".OMO")
        const sameEntry = existsSync(alias) && lstatSync(alias).ino === lstatSync(join(project, ".omo")).ino
        return {
          spelling: ".OMO/Plans/x.md",
          expected: sameEntry ? join(realpathSync.native(project), ".omo", "plans", "x.md") : undefined,
          escape: ".OMO/Escape/../escaped.md",
        }
      },
    },
    {
      name: "mixed separators, relative",
      skip: false,
      build: (project) => {
        planningWithLinks(project, "dir")
        return {
          spelling: ".omo\\plans/x.md",
          expected: join(realpathSync.native(project), ".omo", "plans", "x.md"),
          escape: ".omo\\escape/../escaped.md",
        }
      },
    },
    {
      name: "mixed separators, absolute",
      skip: false,
      build: (project) => {
        planningWithLinks(project, "dir")
        const slashed = project.replaceAll(sep, "/")
        return {
          spelling: `${slashed}/.omo\\redirect/../plan.md`,
          expected: join(realpathSync.native(project), ".omo", "inside", "plan.md"),
          escape: `${slashed}\\.omo/escape\\../escaped.md`,
        }
      },
    },
  ]

  for (const form of forms) {
    test.skipIf(form.skip)(`${form.name}: the guard returns the physical path and denies the escape`, async () => {
      const layout = form.build(project)
      const workspace = layout.workspace ?? project
      // The CI job keeps only stderr, so the diagnosis travels in the assertion message.
      const diagnosis = () => `PATH_IDENTITY_FORM ${JSON.stringify({
        form: form.name,
        workspace,
        realRoot: attempt(() => realpathSync.native(parse(workspace).root)),
        realWorkspace: attempt(() => realpathSync.native(workspace)),
        lstatWorkspace: attempt(() => String(lstatSync(workspace).isDirectory())),
        realPlanning: attempt(() => realpathSync.native(join(workspace, ".omo"))),
        walkedPlanning: attempt(() => resolveFileWritePath(join(workspace, ".omo"), workspace)),
        walked: attempt(() => resolveFileWritePath(layout.spelling, workspace)),
        expected: layout.expected,
      })}`
      expect(resolveAllowedFile(layout.spelling, workspace), diagnosis()).toBe(layout.expected)
      const args = { filePath: layout.spelling }
      if (layout.expected === undefined) {
        await expect(invoke(args, workspace)).rejects.toThrow("File operations restricted")
      } else {
        await invoke(args, workspace)
        // The executor opens exactly the path the guard decided on.
        expect(args.filePath).toBe(layout.expected)
      }
      expect(resolveAllowedFile(layout.escape, workspace)).toBeUndefined()
      await expect(invoke({ filePath: layout.escape }, workspace)).rejects.toThrow("File operations restricted")
      expect(readFileSync(join(project, "src/escaped.md"), "utf8")).toBe("outside\n")
    })
  }

  test.skipIf(!caseVariantSiblingsSupported)("a case-variant sibling that is a different entry stays outside the planning directory", () => {
    mkdirSync(join(project, ".omo"))
    mkdirSync(join(project, ".OMO"))
    expect(resolveAllowedFile(".omo/../.OMO/x.md", project)).toBeUndefined()
    expect(resolveAllowedFile(".OMO/../.omo/x.md", project)).toBe(join(realpathSync.native(project), ".omo", "x.md"))
  })

  test("link-then-dotdot probe: the guard decides on the path the executor opens", async () => {
    mkdirSync(join(project, ".omo/inside/deep"), { recursive: true })
    const lexical = join(project, ".omo/escaped.md")
    const physical = join(project, ".omo/inside/escaped.md")
    writeFileSync(lexical, "lexical\n")
    writeFileSync(physical, "physical\n")
    symlinkSync("inside/deep", join(project, ".omo/redirect"), "dir")
    const spelling = ".omo/redirect/../escaped.md"

    // Where the operating system itself puts bytes written through the raw spelling (concatenated: join() would collapse `..`).
    let raw: string
    try {
      writeFileSync(`${project}${sep}${spelling}`, "raw\n")
      raw = readFileSync(lexical, "utf8") === "raw\n" ? "lexical"
        : readFileSync(physical, "utf8") === "raw\n" ? "physical" : "elsewhere"
    } catch (error) {
      raw = `error:${error instanceof Error && "code" in error ? String(error.code) : String(error)}`
    }
    writeFileSync(lexical, "lexical\n")
    writeFileSync(physical, "physical\n")

    const decided = resolveAllowedFile(spelling, project)
    const child = Bun.spawn([
      process.execPath, "run", join(import.meta.dir, "fixtures/guarded-hashline.ts"),
      JSON.stringify({ filePath: spelling, edits: [{ op: "append", lines: ["probe"] }] }),
    ], { cwd: project, stdout: "pipe", stderr: "pipe" })
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
    ])
    expect(code, stderr).toBe(0)
    const executed = JSON.parse(stdout) as { blocked: boolean; result?: string; filePath?: string }
    const landed = readFileSync(physical, "utf8").includes("probe") ? "physical"
      : readFileSync(lexical, "utf8").includes("probe") ? "lexical" : "nowhere"
    process.stderr.write(`PATH_IDENTITY_PROBE ${JSON.stringify({ platform: process.platform, spelling, raw, decided, executed: executed.filePath, landed })}\n`)

    expect(decided).toBe(join(realpathSync.native(project), ".omo", "inside", "escaped.md"))
    expect(executed.blocked).toBe(false)
    expect(executed.filePath).toBe(decided)
    expect(landed).toBe("physical")
    expect(readFileSync(lexical, "utf8")).toBe("lexical\n")
    // Without the rewrite the executor would open the raw spelling, which Windows collapses lexically
    // before following the link; the guard therefore hands the executor its resolved path, never the spelling.
    expect(raw).toBe(win32 ? "lexical" : "physical")
  })
})
