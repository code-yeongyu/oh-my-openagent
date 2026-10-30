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

  test("#given nested test directory shapes #when filtered #then every subtree is skipped at any depth", () => {
    const shouldCopy = createSkillSourceCopyFilter(root)
    for (const name of ["tests", "test", "__tests__", "parser_test"]) {
      for (const parent of ["engine", join("scripts", "nested")]) {
        expect(shouldCopy(join(root, parent, name))).toBe(false)
        expect(shouldCopy(join(root, parent, name, "fixtures", "page.html"))).toBe(false)
      }
    }
    expect(shouldCopy(join(root, "engine", "test_helpers.py"))).toBe(true)
    expect(shouldCopy(join(root, "engine", "contest", "runtime.py"))).toBe(true)
  })

  test("#given each top-level directory shape #when filtered #then only test and tests are exempt by name", () => {
    const shouldCopy = createSkillSourceCopyFilter(root)
    const shapes = [
      { name: "test", copied: true },
      { name: "tests", copied: true },
      { name: "__tests__", copied: false },
      { name: "foo_test", copied: false },
      { name: "spec", copied: true },
      { name: "engine", copied: true },
    ]
    for (const { name, copied } of shapes) {
      expect({ name, dir: shouldCopy(join(root, name)) }).toEqual({ name, dir: copied })
      expect({ name, file: shouldCopy(join(root, name, "fixture.md")) }).toEqual({ name, file: copied })
      expect({ name, nested: shouldCopy(join(root, name, "data", "page.html")) }).toEqual({ name, nested: copied })
    }
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
