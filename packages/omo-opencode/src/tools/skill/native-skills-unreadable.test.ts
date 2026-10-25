import { afterEach, expect, test } from "bun:test"
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { LoadedSkill } from "../../features/opencode-skill-loader"
import { mergeNativeSkills } from "./native-skills"

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) {
    chmodSync(join(root, "host", "locked", "SKILL.md"), 0o644)
    rmSync(root, { recursive: true, force: true })
  }
})

function skillFile(dir: string, name: string): string {
  mkdirSync(join(dir, name), { recursive: true })
  const path = join(dir, name, "SKILL.md")
  writeFileSync(path, `---\nname: ${name}\ndescription: fixture\n---\n${name} body from disk\n`)
  return path
}

test.skipIf(process.platform === "win32" || process.getuid?.() === 0)("an unreadable native skill skips nothing after it and keeps the host's content (#10693 review L2)", () => {
  // given: three host rows; the first one's file is unreadable
  const root = mkdtempSync(join(tmpdir(), "native-unreadable-"))
  roots.push(root)
  const project = join(root, "project")
  mkdirSync(project)
  mkdirSync(join(project, ".git"))
  const host = join(root, "host")
  const locked = skillFile(host, "locked")
  const entries = ["locked", "second", "third"].map((name) => ({
    name, description: "fixture", content: `---\nname: ${name}\n---\n${name} host content\n`,
    location: name === "locked" ? locked : skillFile(host, name),
  }))
  chmodSync(locked, 0o000)
  const skills: LoadedSkill[] = []
  // when
  mergeNativeSkills(skills, entries, undefined, project)
  // then: every row loads, and the unreadable one keeps the content the host already had
  expect(skills.map((skill) => skill.name)).toEqual(["locked", "second", "third"])
  expect(skills[0]?.definition.template).toContain("locked host content")
})
