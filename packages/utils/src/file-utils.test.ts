import { describe, it, expect, beforeAll, afterAll } from "bun:test"
import { mkdirSync, writeFileSync, symlinkSync, rmSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"
import { resolveSymlink, resolveSymlinkAsync, isSymbolicLink } from "./file-utils"

const testDir = join(tmpdir(), "file-utils-test-" + Date.now())

// Create a directory structure that mimics the real-world scenario:
//
//   testDir/
//   ├── repo/
//   │   ├── skills/
//   │   │   └── category/
//   │   │       └── my-skill/
//   │   │           └── SKILL.md
//   │   └── .opencode/
//   │       └── skills/
//   │           └── my-skill -> ../../skills/category/my-skill  (relative symlink)
//   └── config/
//       └── skills -> ../repo/.opencode/skills                  (absolute symlink)

const realSkillDir = join(testDir, "repo", "skills", "category", "my-skill")
const repoOpencodeSkills = join(testDir, "repo", ".opencode", "skills")
const configSkills = join(testDir, "config", "skills")

beforeAll(() => {
	// Create real skill directory with a file
	mkdirSync(realSkillDir, { recursive: true })
	writeFileSync(join(realSkillDir, "SKILL.md"), "# My Skill")

	// Create .opencode/skills/ with a relative symlink to the real skill
	mkdirSync(repoOpencodeSkills, { recursive: true })
	symlinkSync("../../skills/category/my-skill", join(repoOpencodeSkills, "my-skill"))

	// Create config/skills as an absolute symlink to .opencode/skills
	mkdirSync(join(testDir, "config"), { recursive: true })
	symlinkSync(repoOpencodeSkills, configSkills)
})

afterAll(() => {
	rmSync(testDir, { recursive: true, force: true })
})

describe("resolveSymlink", () => {
	it("resolves a regular file path to itself", () => {
		const filePath = join(realSkillDir, "SKILL.md")
		expect(resolveSymlink(filePath)).toBe(filePath)
	})

	it("resolves a relative symlink to its real path", () => {
		const symlinkPath = join(repoOpencodeSkills, "my-skill")
		expect(resolveSymlink(symlinkPath)).toBe(realSkillDir)
	})

	it("resolves a chained symlink (symlink-to-dir-containing-symlinks) to the real path", () => {
		// This is the real-world scenario:
		// config/skills/my-skill -> (follows config/skills) -> repo/.opencode/skills/my-skill -> repo/skills/category/my-skill
		const chainedPath = join(configSkills, "my-skill")
		expect(resolveSymlink(chainedPath)).toBe(realSkillDir)
	})

	it("returns the original path for non-existent paths", () => {
		const fakePath = join(testDir, "does-not-exist")
		expect(resolveSymlink(fakePath)).toBe(fakePath)
	})
})

describe("resolveSymlinkAsync", () => {
	it("resolves a regular file path to itself", async () => {
		const filePath = join(realSkillDir, "SKILL.md")
		expect(await resolveSymlinkAsync(filePath)).toBe(filePath)
	})

	it("resolves a relative symlink to its real path", async () => {
		const symlinkPath = join(repoOpencodeSkills, "my-skill")
		expect(await resolveSymlinkAsync(symlinkPath)).toBe(realSkillDir)
	})

	it("resolves a chained symlink (symlink-to-dir-containing-symlinks) to the real path", async () => {
		const chainedPath = join(configSkills, "my-skill")
		expect(await resolveSymlinkAsync(chainedPath)).toBe(realSkillDir)
	})

	it("returns the original path for non-existent paths", async () => {
		const fakePath = join(testDir, "does-not-exist")
		expect(await resolveSymlinkAsync(fakePath)).toBe(fakePath)
	})
})

describe("isSymbolicLink", () => {
	it("returns true for a symlink", () => {
		expect(isSymbolicLink(join(repoOpencodeSkills, "my-skill"))).toBe(true)
	})

	it("returns false for a regular directory", () => {
		expect(isSymbolicLink(realSkillDir)).toBe(false)
	})

	it("returns false for a non-existent path", () => {
		expect(isSymbolicLink(join(testDir, "does-not-exist"))).toBe(false)
	})
})
