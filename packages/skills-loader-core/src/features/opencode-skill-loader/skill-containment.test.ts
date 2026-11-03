import { afterEach, describe, expect, spyOn, test } from "bun:test"
import * as fs from "node:fs"
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { discoverConfigSourceSkills } from "./config-source-discovery"
import { loadSkillsFromDir } from "./skill-directory-loader"
import { loadSkillFromPathAsync } from "./async-loader"
import { extractSkillTemplate } from "./loaded-skill-template-extractor"
import { loadSkillFromPath } from "./loaded-skill-from-path"

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "skill-containment-"))
  roots.push(root)
  const project = join(root, "project")
  const outside = join(root, "outside")
  const skillsDir = join(project, ".opencode", "skills")
  mkdirSync(skillsDir, { recursive: true })
  mkdirSync(outside)
  mkdirSync(join(project, ".git"))
  return { root, project, outside, skillsDir }
}
function skill(path: string) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, "---\ndescription: synthetic fixture\n---\nSYNTHETIC OUTSIDE BODY\n")
}

describe("legacy skill containment at discovery and reread", () => {
  test("mode-000 skill fails closed with its real EACCES error, not a security block", async () => {
    // chmod 000 denies reads only under POSIX permissions; on Windows the file stays readable, so the case cannot arise.
    if (process.platform === "win32") return
    // given
    const f = fixture()
    const path = join(f.skillsDir, "unreadable", "SKILL.md")
    skill(path)
    fs.chmodSync(path, 0)
    const diagnostics: { category: string; path: string; message: string }[] = []
    try {
      // when
      const loaded = await loadSkillsFromDir({
        skillsDir: f.skillsDir, scope: "project",
        onDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
      })
      // then
      expect(loaded).toEqual([])
      expect(diagnostics).toHaveLength(1)
      expect(diagnostics[0]?.category).toBe("skill-load-error")
      expect(diagnostics[0]?.path).toBe(path)
      expect(diagnostics[0]?.message).toContain("EACCES")
      expect(diagnostics[0]?.message).toContain(path)
    } finally {
      fs.chmodSync(path, 0o600)
    }
  })

  test("missing configured source fails closed with its real ENOENT error", async () => {
    // given
    const f = fixture()
    const path = join(f.project, "missing-source")
    const diagnostics: { category: string; path: string; message: string }[] = []
    // when
    const loaded = await discoverConfigSourceSkills({
      config: { sources: [path] }, configDir: f.project,
      onDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
    })
    // then
    expect(loaded).toEqual([])
    expect(diagnostics).toHaveLength(1)
    expect(diagnostics[0]?.category).toBe("skill-load-error")
    expect(diagnostics[0]?.path).toBe(path)
    expect(diagnostics[0]?.message).toContain("ENOENT")
    expect(diagnostics[0]?.message).toContain(path)
  })

  test("directory used as a skill fails closed with EISDIR rather than a security block", async () => {
    // given
    const f = fixture()
    const path = join(f.skillsDir, "directory", "SKILL.md")
    mkdirSync(path, { recursive: true })
    const diagnostics: { category: string; message: string }[] = []
    // when
    const loaded = await loadSkillFromPath({
      skillPath: path, resolvedPath: dirname(path), defaultName: "directory", scope: "project",
      onDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
    })
    // then
    expect(loaded).toBeNull()
    expect(diagnostics[0]?.category).toBe("skill-load-error")
    expect(diagnostics[0]?.message).toContain("EISDIR")
  })

  // The core package's minimal Bun declarations omit test.each (#10693).
  for (const layout of ["folder", "file", "nested", "root"]) {
    test(`blocks escaping project ${layout} with a reason`, async () => {
      // given
      const f = fixture()
      skill(join(f.outside, "SKILL.md"))
      let skillsDir = f.skillsDir
      if (layout === "root") {
        rmSync(skillsDir, { recursive: true })
        symlinkSync(f.outside, skillsDir)
      } else if (layout === "file") {
        mkdirSync(join(skillsDir, "escape"))
        symlinkSync(join(f.outside, "SKILL.md"), join(skillsDir, "escape", "SKILL.md"))
      } else if (layout === "nested") {
        mkdirSync(join(skillsDir, "group"))
        symlinkSync(f.outside, join(skillsDir, "group", "escape"))
      } else {
        symlinkSync(f.outside, join(skillsDir, "escape"))
      }
      const diagnostics: { category: string; message: string }[] = []
      // when
      const loaded = await loadSkillsFromDir({
        skillsDir, scope: "opencode-project",
        provenance: { kind: "project-auto", selectedRoot: skillsDir, projectRoot: f.project },
        onDiagnostic: (diagnostic: { category: string; message: string }) => diagnostics.push(diagnostic),
      })
      // then
      expect(loaded).toEqual([])
      expect(diagnostics.some((d) => d.category === "skill-link-blocked" && d.message.includes("outside the project"))).toBe(true)
    })
  }

  test("rejects an escaping sidecar without consuming its declaration", async () => {
    // given
    const f = fixture()
    skill(join(f.skillsDir, "local", "SKILL.md"))
    writeFileSync(join(f.outside, "mcp.json"), '{"mcpServers":{"escape":{"command":"synthetic"}}}')
    symlinkSync(join(f.outside, "mcp.json"), join(f.skillsDir, "local", "mcp.json"))
    const diagnostics: { category: string }[] = []
    // when
    const loaded = await loadSkillsFromDir(Object.assign({
      skillsDir: f.skillsDir, scope: "project" as const,
    }, { onDiagnostic: (diagnostic: { category: string }) => diagnostics.push(diagnostic) }))
    // then
    expect(loaded.flatMap((s) => Object.keys(s.mcpConfig ?? {}))).not.toContain("escape")
    expect(diagnostics.some((d) => d.category === "skill-link-blocked")).toBe(true)
  })

  test("contains repository config sources but allows the same user source", async () => {
    // given
    const f = fixture()
    skill(join(f.outside, "entry", "SKILL.md"))
    const config = { sources: [f.outside] }
    // when
    const project = await discoverConfigSourceSkills({ config, configDir: f.project,
      provenance: { kind: "project-auto", projectRoot: f.project, selectedRoot: f.outside },
    })
    const user = await discoverConfigSourceSkills({ config, configDir: f.project,
      provenance: { kind: "user", selectedRoot: f.outside },
    })
    // then
    expect(project).toEqual([])
    expect(user.map((s) => s.name)).toEqual(["entry"])
  })

  test("stops ancestry cycles without dropping sibling link names", async () => {
    // given
    const f = fixture()
    const target = join(f.project, "local")
    skill(join(target, "SKILL.md"))
    symlinkSync(target, join(f.skillsDir, "alpha"))
    symlinkSync(target, join(f.skillsDir, "beta"))
    mkdirSync(join(f.skillsDir, "loop"))
    symlinkSync(f.skillsDir, join(f.skillsDir, "loop", "back"))
    // when
    const loaded = await loadSkillsFromDir({ skillsDir: f.skillsDir, scope: "project", maxDepth: 10 })
    // then
    expect(loaded.map((s) => s.name).sort()).toEqual(["alpha", "beta"])
  })

  test("accepts deeper user links reached through a configured user root", async () => {
    // given
    const f = fixture()
    const userRoot = join(f.root, "user")
    mkdirSync(join(userRoot, "nested"), { recursive: true })
    symlinkSync(f.outside, join(userRoot, "nested", "installed"))
    skill(join(f.outside, "SKILL.md"))
    symlinkSync(f.outside, join(f.skillsDir, "installed"))
    // when
    const loaded = await loadSkillsFromDir({
      skillsDir: f.skillsDir, scope: "project",
      provenance: { kind: "project-auto", selectedRoot: f.skillsDir, projectRoot: f.project, userRoots: [userRoot] },
    })
    // then
    expect(loaded.map((s) => s.name)).toEqual(["installed"])
  })

  test("an exact user file authorizes only that file, not its parent or sibling", async () => {
    // given
    const f = fixture()
    const allowed = join(f.outside, "allowed.md")
    skill(allowed)
    skill(join(f.outside, "sibling.md"))
    symlinkSync(allowed, join(f.skillsDir, "allowed.md"))
    symlinkSync(join(f.outside, "sibling.md"), join(f.skillsDir, "sibling.md"))
    // when
    const loaded = await loadSkillsFromDir({
      skillsDir: f.skillsDir, scope: "project",
      provenance: { kind: "project-auto", selectedRoot: f.skillsDir, projectRoot: f.project, userFiles: [allowed] },
    })
    // then
    expect(loaded.map((s) => s.name)).toEqual(["allowed"])
  })

  test("async skill path reads reject a project file link", async () => {
    // given
    const f = fixture()
    skill(join(f.outside, "SKILL.md"))
    const path = join(f.skillsDir, "escape.md")
    symlinkSync(join(f.outside, "SKILL.md"), path)
    // when
    const loaded = await loadSkillFromPathAsync(path, f.skillsDir, "escape", "project")
    // then
    expect(loaded).toBeNull()
  })

  test("template reread rechecks a project's current target", async () => {
    // given
    const f = fixture()
    const path = join(f.skillsDir, "local", "SKILL.md")
    skill(path)
    const [loaded] = await loadSkillsFromDir({ skillsDir: f.skillsDir, scope: "project" })
    if (!loaded) throw new Error("Fixture skill did not load")
    skill(join(f.outside, "SKILL.md"))
    rmSync(path)
    symlinkSync(join(f.outside, "SKILL.md"), path)
    // when / then
    expect(() => extractSkillTemplate(loaded)).toThrow("outside the project")
  })

  test("final component swap before open is refused by the checked descriptor read", async () => {
    // given
    const f = fixture()
    const path = join(f.skillsDir, "local", "SKILL.md")
    skill(path)
    skill(join(f.outside, "SKILL.md"))
    const open = fs.openSync
    let injected = false
    const hook = spyOn(fs, "openSync").mockImplementation((file, flags, mode) => {
      let matches = false
      if (!injected) {
        try {
          matches = fs.realpathSync.native(file) === fs.realpathSync.native(path)
        } catch {
          // Let the real open report inaccessible or missing paths.
        }
      }
      if (matches) {
        injected = true
        fs.renameSync(path, `${path}.original`)
        symlinkSync(join(f.outside, "SKILL.md"), path)
      }
      return open(file, flags, mode)
    })
    try {
      // when
      const loaded = await loadSkillFromPath({
        skillPath: path, resolvedPath: dirname(path), defaultName: "local", scope: "project",
      })
      // then
      expect(loaded).toBeNull()
      expect(injected).toBe(true)
    } finally {
      hook.mockRestore()
    }
  })

  test("canonical containment follows the real volume's case semantics without case folding", async () => {
    // given
    const f = fixture()
    const differentlySpelled = join(f.root, "PROJECT")
    mkdirSync(differentlySpelled, { recursive: true })
    skill(join(differentlySpelled, "SKILL.md"))
    symlinkSync(differentlySpelled, join(f.skillsDir, "case-alias"))
    const sameDirectory = fs.realpathSync.native(differentlySpelled) === fs.realpathSync.native(f.project)
    // when
    const loaded = await loadSkillsFromDir({ skillsDir: f.skillsDir, scope: "project" })
    // then
    expect(loaded.map((s) => s.name)).toEqual(sameDirectory ? ["case-alias"] : [])
  })

  test("the user allowed walk stops at a named skill leaf just as its loader does", async () => {
    // given
    const f = fixture()
    const userRoot = join(f.root, "user")
    skill(join(userRoot, "leaf", "leaf.md"))
    skill(join(f.outside, "SKILL.md"))
    symlinkSync(f.outside, join(userRoot, "leaf", "unused-assets"))
    symlinkSync(f.outside, join(f.skillsDir, "escape"))
    // when
    const user = await loadSkillsFromDir({ skillsDir: userRoot, scope: "user" })
    const project = await loadSkillsFromDir({
      skillsDir: f.skillsDir, scope: "project",
      provenance: { kind: "project-auto", selectedRoot: f.skillsDir, projectRoot: f.project, userRoots: [userRoot] },
    })
    // then
    expect(user.map((s) => s.name)).toEqual(["leaf"])
    expect(project).toEqual([])
  })
})
