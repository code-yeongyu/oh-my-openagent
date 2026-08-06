import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"

import * as opencodeConfigDir from "../../shared"
import { readOpencodeConfigSkills } from "./opencode-config-skills-reader"

describe("readOpencodeConfigSkills", () => {
  let tmpDir: string
  let globalConfigDir: string
  let getOpenCodeConfigDirsSpy: ReturnType<typeof spyOn>

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ohmo-host-skills-"))
    // Hermetic: redirect the "global" opencode config dir into an isolated
    // empty tmp dir so the developer's real ~/.config/opencode does not
    // leak into these tests (or vice versa: CI passes while local fails).
    globalConfigDir = fs.mkdtempSync(path.join(os.tmpdir(), "ohmo-global-opencode-"))
    getOpenCodeConfigDirsSpy = spyOn(opencodeConfigDir, "getOpenCodeConfigDirs").mockReturnValue([
      globalConfigDir,
    ])
  })

  afterEach(() => {
    getOpenCodeConfigDirsSpy.mockRestore()
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

  it("#given a config read throws a non-Error value #when reading opencode skills #then it keeps the fallback result", () => {
    // given
    const opencodeDir = path.join(tmpDir, ".opencode")
    fs.mkdirSync(opencodeDir, { recursive: true })
    fs.writeFileSync(path.join(opencodeDir, "opencode.json"), "{}")
    const readFileSyncSpy = spyOn(fs, "readFileSync").mockImplementation(() => {
      throw "read failed"
    })

    try {
      // when
      const result = readOpencodeConfigSkills(tmpDir)

      // then
      expect(result).toBeUndefined()
    } finally {
      readFileSyncSpy.mockRestore()
    }
  })

  it("merges skills from multiple user config dirs", () => {
    // given the plural function returns two config dirs, each with its own skills config
    const customDir = fs.mkdtempSync(path.join(os.tmpdir(), "ohmo-custom-opencode-"))
    const defaultDir = fs.mkdtempSync(path.join(os.tmpdir(), "ohmo-default-opencode-"))

    fs.writeFileSync(
      path.join(customDir, "opencode.json"),
      JSON.stringify({
        skills: { paths: ["/custom/skill"], urls: ["https://custom.example.com/s.md"] },
      }),
    )
    fs.writeFileSync(
      path.join(defaultDir, "opencode.json"),
      JSON.stringify({
        skills: { paths: ["/default/skill"], urls: ["https://default.example.com/s.md"] },
      }),
    )

    getOpenCodeConfigDirsSpy.mockReturnValue([customDir, defaultDir])

    try {
      // when
      const result = readOpencodeConfigSkills(tmpDir)

      // then both dirs contribute skills, deduplicated by the existing !paths.includes check
      expect(result?.paths).toEqual(["/custom/skill", "/default/skill"])
      expect(result?.urls).toEqual(["https://custom.example.com/s.md", "https://default.example.com/s.md"])
    } finally {
      fs.rmSync(customDir, { recursive: true, force: true })
      fs.rmSync(defaultDir, { recursive: true, force: true })
    }
  })
})
