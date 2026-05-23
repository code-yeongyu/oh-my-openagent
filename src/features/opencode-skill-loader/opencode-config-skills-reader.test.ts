import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"

import * as opencodeConfigDir from "../../shared/opencode-config-dir"
import { readOpencodeConfigSkills } from "./opencode-config-skills-reader"

describe("readOpencodeConfigSkills", () => {
  let tmpDir: string
  let globalConfigDir: string
  let getOpenCodeConfigDirSpy: ReturnType<typeof spyOn>

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ohmo-host-skills-"))
    // Hermetic: redirect the "global" opencode config dir into an isolated
    // empty tmp dir so the developer's real ~/.config/opencode does not
    // leak into these tests (or vice versa: CI passes while local fails).
    globalConfigDir = fs.mkdtempSync(path.join(os.tmpdir(), "ohmo-global-opencode-"))
    getOpenCodeConfigDirSpy = spyOn(opencodeConfigDir, "getOpenCodeConfigDir").mockReturnValue(
      globalConfigDir,
    )
  })

  afterEach(() => {
    getOpenCodeConfigDirSpy.mockRestore()
    fs.rmSync(tmpDir, { recursive: true, force: true })
    fs.rmSync(globalConfigDir, { recursive: true, force: true })
  })

  it("returns undefined when no opencode config exists", () => {
    expect(readOpencodeConfigSkills(tmpDir)).toBeUndefined()
  })

  it("reads skills.paths and skills.urls from project opencode.jsonc", () => {
    const opencodeDir = path.join(tmpDir, ".opencode")
    fs.mkdirSync(opencodeDir, { recursive: true })
    fs.writeFileSync(
      path.join(opencodeDir, "opencode.jsonc"),
      JSON.stringify({
        skills: {
          paths: ["~/global/skills", "./project/skills"],
          urls: ["https://example.com/skill.md"],
        },
      }),
    )

    const result = readOpencodeConfigSkills(tmpDir)

    expect(result?.paths).toEqual(["~/global/skills", "./project/skills"])
    expect(result?.urls).toEqual(["https://example.com/skill.md"])
  })

  it("returns undefined when skills key is missing", () => {
    const opencodeDir = path.join(tmpDir, ".opencode")
    fs.mkdirSync(opencodeDir, { recursive: true })
    fs.writeFileSync(
      path.join(opencodeDir, "opencode.json"),
      JSON.stringify({ model: "anthropic/claude-opus-4-7" }),
    )

    expect(readOpencodeConfigSkills(tmpDir)).toBeUndefined()
  })

  it("ignores non-string entries and trims whitespace", () => {
    const opencodeDir = path.join(tmpDir, ".opencode")
    fs.mkdirSync(opencodeDir, { recursive: true })
    fs.writeFileSync(
      path.join(opencodeDir, "opencode.jsonc"),
      JSON.stringify({
        skills: {
          paths: ["  /skills/a  ", 123, "", "/skills/b"],
        },
      }),
    )

    const result = readOpencodeConfigSkills(tmpDir)

    expect(result?.paths).toEqual(["/skills/a", "/skills/b"])
  })

  it("tolerates malformed jsonc gracefully", () => {
    const opencodeDir = path.join(tmpDir, ".opencode")
    fs.mkdirSync(opencodeDir, { recursive: true })
    fs.writeFileSync(path.join(opencodeDir, "opencode.json"), "{ not valid json")

    expect(readOpencodeConfigSkills(tmpDir)).toBeUndefined()
  })
})
