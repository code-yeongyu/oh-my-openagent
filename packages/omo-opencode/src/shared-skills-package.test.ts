import { describe, expect, test } from "bun:test"
import { stat } from "node:fs/promises"

describe("shared skills package manifest", () => {
  test("#given root package metadata #when shared-skills package is required #then workspace and tarball entries include it", async () => {
    // given
    const rootPackageJson = await Bun.file("package.json").json()

    // when
    const workspaces = rootPackageJson.workspaces
    const files = rootPackageJson.files
    const devDependency = rootPackageJson.devDependencies["@oh-my-opencode/shared-skills"]
    const sharedPackageJson = await Bun.file("packages/shared-skills/package.json").json()

    // then
    expect(workspaces).toContain("packages/shared-skills")
    expect(files).toContain("packages/shared-skills/skills")
    expect(devDependency).toBe("workspace:*")
    expect(sharedPackageJson).toEqual({
      name: "@oh-my-opencode/shared-skills",
      version: "0.1.0",
      type: "module",
      private: true,
      description: "Cross-harness SKILL.md files shared between OMO and Codex",
      exports: {
        ".": {
          types: "./index.d.ts",
          import: "./index.mjs",
        },
      },
      types: "./index.d.ts",
      files: ["index.d.ts", "index.mjs", "skills"],
    })
  })

  test("#given shared user skills #when copied into the package #then frontmatter and resource directories are preserved", async () => {
    // given
    const copiedSkills = ["debugging", "programming", "refactor", "remove-ai-slops"] as const

    // when
    const skillFiles = await Promise.all(
      copiedSkills.map(async (skillName) => ({
        name: skillName,
        content: await Bun.file(`packages/shared-skills/skills/${skillName}/SKILL.md`).text(),
      })),
    )

    // then
    for (const skill of skillFiles) {
      expect(skill.content.startsWith("---\n")).toBe(true)
      expect(skill.content).toContain(`name: ${skill.name}`)
    }
    expect((await stat("packages/shared-skills/skills/debugging/references")).isDirectory()).toBe(true)
    expect((await stat("packages/shared-skills/skills/programming/references")).isDirectory()).toBe(true)
    expect((await stat("packages/shared-skills/skills/programming/scripts")).isDirectory()).toBe(true)
  })
})
