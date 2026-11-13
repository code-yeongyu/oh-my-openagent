import { describe, expect, test } from "bun:test"
import { existsSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

import { readBundledSkillNames } from "./bare-skill-command"

// senpi's slash picker waits for arguments only on a command that declares an argument hint; for a
// skill that is the `argument-hint` frontmatter field (#9168). A skill that reads the text typed
// after its command must declare one, or choosing it from the picker submits it empty; a skill that
// takes nothing must not, or it costs a second Enter.
const ARGUMENT_READING_SKILLS = [
  "hyperplan",
  "init-deep",
  "mass-ulw",
  "refactor",
  "remove-ai-slops",
  "ulw-execute",
  "ulw-loop",
  "ulw-plan",
  "ulw-research",
]

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "../../..")
const nativeSkillsRoot = join(packageRoot, "skills")
const sharedSkillsRoot = join(packageRoot, "../shared-skills/skills")
const senpiDistDir = dirname(fileURLToPath(import.meta.resolve("@code-yeongyu/senpi")))
const { parseFrontmatter } = (await import(pathToFileURL(join(senpiDistDir, "utils", "frontmatter.js")).href)) as Pick<
  typeof import("@code-yeongyu/senpi"),
  "parseFrontmatter"
>

// The SKILL.md the plugin ships per name: `plugin/scripts/sync-skills.mjs` lets a senpi-native
// source shadow the shared-pool copy of the same name.
function shippedSkillFiles(): Map<string, string> {
  const files = new Map<string, string>()
  for (const root of [sharedSkillsRoot, nativeSkillsRoot]) {
    for (const name of readBundledSkillNames(root)) files.set(name, join(root, name, "SKILL.md"))
  }
  return files
}

function argumentHintOf(path: string): unknown {
  return parseFrontmatter<Record<string, unknown>>(readFileSync(path, "utf8")).frontmatter["argument-hint"]
}

describe("bundled skill argument hints", () => {
  test("#given every shipped skill #when the engine parses its frontmatter #then exactly the argument-reading skills declare a hint", () => {
    const hinted = [...shippedSkillFiles()]
      .filter(([, path]) => {
        const hint = argumentHintOf(path)
        return typeof hint === "string" && hint.trim() !== ""
      })
      .map(([name]) => name)
      .sort()

    expect(hinted).toEqual(ARGUMENT_READING_SKILLS)
  })

  test("#given a shipped skill whose body consumes the typed text #when its frontmatter is parsed #then it declares a hint", () => {
    const unhinted = [...shippedSkillFiles()]
      .filter(([, path]) => /\$ARGUMENTS|<user-request>/.test(readFileSync(path, "utf8")))
      .filter(([, path]) => typeof argumentHintOf(path) !== "string")
      .map(([name]) => name)

    expect(unhinted).toEqual([])
  })

  test("#given the scan's inputs #when resolved #then both pools are read and a shadowed name resolves to the native copy", () => {
    const files = shippedSkillFiles()

    expect(files.get("ulw-execute")).toBe(join(sharedSkillsRoot, "ulw-execute", "SKILL.md"))
    expect(files.get("ulw-plan")).toBe(join(nativeSkillsRoot, "ulw-plan", "SKILL.md"))
    expect(existsSync(join(sharedSkillsRoot, "ulw-plan", "SKILL.md"))).toBe(true)
    expect(files.get("onboarding")).toBeDefined()
  })
})
