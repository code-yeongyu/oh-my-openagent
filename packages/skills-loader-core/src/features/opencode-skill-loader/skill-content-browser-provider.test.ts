import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { devBrowserSkill } from "../builtin-skills/skills/dev-browser"
import { clearSkillCache, resolveSkillContent, resolveMultipleSkills, resolveMultipleSkillsAsync } from "./skill-content"

let originalEnv: Record<string, string | undefined>
let testConfigDir: string

beforeEach(() => {
  clearSkillCache()
  originalEnv = {
    CLAUDE_CONFIG_DIR: process.env.CLAUDE_CONFIG_DIR,
    OPENCODE_CONFIG_DIR: process.env.OPENCODE_CONFIG_DIR,
  }
  testConfigDir = mkdtempSync(join(tmpdir(), "skill-browser-provider-"))
  process.env.CLAUDE_CONFIG_DIR = testConfigDir
  process.env.OPENCODE_CONFIG_DIR = testConfigDir
})

afterEach(() => {
  clearSkillCache()
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  rmSync(testConfigDir, { recursive: true, force: true })
})

describe("skill content browser provider selection", () => {
  test("resolves the selected dev browser builtin", () => {
    // Given: an explicit alternate provider.
    const options = { browserProvider: "dev-browser" as const }
    // When: resolving its content.
    const result = resolveSkillContent("dev-browser", options)
    // Then: the real selected template is returned unchanged.
    expect(result).toBe(devBrowserSkill.template)
  })

  test("omits the alternate builtin when the provider defaults to playwright", () => {
    // Given: no browser override.
    const name = "dev-browser"
    // When: resolving the alternate builtin.
    const result = resolveSkillContent(name)
    // Then: the alternate provider is not selected.
    expect(result).toBeNull()
  })

  test("omits playwright when the dev browser provider is selected", () => {
    // Given: an explicit alternate provider.
    const options = { browserProvider: "dev-browser" as const }
    // When: resolving the default builtin.
    const result = resolveSkillContent("playwright", options)
    // Then: only the selected provider is available.
    expect(result).toBeNull()
  })

  test("resolves selected browser and unrelated skills together", () => {
    // Given: a mixed request with an explicit provider.
    const names = ["dev-browser", "git-master"]
    // When: resolving the request.
    const result = resolveMultipleSkills(names, { browserProvider: "dev-browser" })
    // Then: both requested skill ids resolve.
    expect([...result.resolved.keys()]).toEqual(names)
    expect(result.notFound).toEqual([])
  })

  test("reports the retired builtin as missing", () => {
    // Given: a request for the former builtin id.
    const name = ["agent", "browser"].join("-")
    // When: resolving it through the default path.
    const result = resolveMultipleSkills([name])
    // Then: no retired builtin is returned.
    expect([...result.resolved.keys()]).toEqual([])
    expect(result.notFound).toEqual([name])
  })

  test("filters an actual discovered playwright skill for the alternate provider", async () => {
    // Given: a discoverable default-provider override.
    const skillDirectory = join(testConfigDir, "skills", "playwright")
    mkdirSync(skillDirectory, { recursive: true })
    writeFileSync(join(skillDirectory, "SKILL.md"), "---\nname: playwright\ndescription: fixture\n---\nfixture content")
    // When: resolving under the alternate provider.
    const result = await resolveMultipleSkillsAsync(["dev-browser", "playwright"], {
      browserProvider: "dev-browser",
      directory: testConfigDir,
    })
    // Then: discovered default-provider content cannot override selection.
    expect([...result.resolved.keys()]).toEqual(["dev-browser"])
    expect(result.notFound).toEqual(["playwright"])
  })
})
