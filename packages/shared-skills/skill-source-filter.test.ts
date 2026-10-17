import { describe, expect, test } from "bun:test"
import { join } from "node:path"
import { createSkillSourceCopyFilter, ignoredSkillSourceDirNames } from "./skill-source-filter.mjs"

const root = "/repo/packages/shared-skills/skills/ast-grep"

describe("createSkillSourceCopyFilter", () => {
  test("#given a cache directory INSIDE the skill tree #when filtered #then it is skipped", () => {
    const shouldCopy = createSkillSourceCopyFilter(root)
    for (const name of ignoredSkillSourceDirNames) {
      expect(shouldCopy(join(root, name, "x.txt"))).toBe(false)
      expect(shouldCopy(join(root, "scripts", name, "y.py"))).toBe(false)
    }
  })

  test("#given an ignored directory name as an ANCESTOR of the skill root #when filtered #then files are still copied", () => {
    // The regression this module exists to prevent: a checkout at ~/.omo/omob/omo/... or under
    // any __pycache__-named ancestor must ship its skills. The ignore list targets the skill
    // tree's own cache directories, never where the repository happens to live.
    for (const ancestor of ignoredSkillSourceDirNames) {
      const nestedRoot = join("/Users/me", ancestor, "cache", "omo", "packages", "shared-skills", "skills", "ast-grep")
      const shouldCopy = createSkillSourceCopyFilter(nestedRoot)
      expect(shouldCopy(join(nestedRoot, "SKILL.md"))).toBe(true)
      expect(shouldCopy(join(nestedRoot, "scripts", "run.mjs"))).toBe(true)
    }
  })

  test("#given the copy root itself #when filtered #then it is copied (fs.cp asks about the root first)", () => {
    const shouldCopy = createSkillSourceCopyFilter(root)
    expect(shouldCopy(root)).toBe(true)
  })

  test("#given ignored file names and test files #when filtered #then they are skipped", () => {
    const shouldCopy = createSkillSourceCopyFilter(root)
    expect(shouldCopy(join(root, ".gitignore"))).toBe(false)
    expect(shouldCopy(join(root, ".npmignore"))).toBe(false)
    expect(shouldCopy(join(root, "pyrightconfig.json"))).toBe(false)
    expect(shouldCopy(join(root, "scripts", "helper.test.ts"))).toBe(false)
    expect(shouldCopy(join(root, "scripts", "__init__.pyc"))).toBe(false)
    expect(shouldCopy(join(root, "scripts", "helper.ts"))).toBe(true)
  })

  test("#given scripts/tests #when filtered #then that subtree is skipped but a top-level tests dir is kept", () => {
    const shouldCopy = createSkillSourceCopyFilter(root)
    expect(shouldCopy(join(root, "scripts", "tests", "case.py"))).toBe(false)
    expect(shouldCopy(join(root, "tests", "fixture.md"))).toBe(true)
  })

  test("#given extra ignored file names #when supplied #then they are honoured alongside the defaults", () => {
    const shouldCopy = createSkillSourceCopyFilter(root, { ignoredFileNames: ["openai.yaml"] })
    expect(shouldCopy(join(root, "agents", "openai.yaml"))).toBe(false)
    expect(shouldCopy(join(root, ".gitignore"))).toBe(false)
    expect(shouldCopy(join(root, "agents", "other.yaml"))).toBe(true)
  })

  test("#given Windows separators #when filtered #then segments are still recognised", () => {
    const winRoot = "C:\\repo\\skills\\ast-grep"
    const shouldCopy = createSkillSourceCopyFilter(winRoot)
    expect(shouldCopy("C:\\repo\\skills\\ast-grep\\__pycache__\\x.pyc")).toBe(false)
    expect(shouldCopy("C:\\repo\\skills\\ast-grep\\SKILL.md")).toBe(true)
  })

  test("#given a path outside the copy root #when filtered #then it is never copied", () => {
    const shouldCopy = createSkillSourceCopyFilter(root)
    expect(shouldCopy("/repo/packages/shared-skills/skills/other/SKILL.md")).toBe(false)
  })
})
