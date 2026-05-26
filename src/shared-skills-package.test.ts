import { describe, expect, test } from "bun:test"

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
      private: true,
      description: "Cross-harness SKILL.md files shared between OMO and Codex",
    })
  })
})
