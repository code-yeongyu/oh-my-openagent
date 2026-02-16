import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { existsSync, mkdirSync, rmSync, writeFileSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"
import { scanArtifacts } from "./scanner"

describe("artifact-detection/scanner", () => {
  const TEST_DIR = join(tmpdir(), "artifact-scanner-test-" + Date.now())
  const FAKE_HOME = join(TEST_DIR, "fake-home")

  beforeEach(() => {
    mkdirSync(TEST_DIR, { recursive: true })
    mkdirSync(FAKE_HOME, { recursive: true })
  })

  afterEach(() => {
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true, force: true })
    }
  })

  //#given an empty project directory
  //#when scanArtifacts is called
  //#then it returns zero artifacts with no errors
  it("returns empty results for empty project", () => {
    const result = scanArtifacts(TEST_DIR, { homeDir: FAKE_HOME })
    expect(result.artifacts).toHaveLength(0)
    expect(result.errors).toHaveLength(0)
    expect(result.projectDir).toBe(TEST_DIR)
    expect(result.scanDuration).toBeGreaterThanOrEqual(0)
  })

  //#given a project with a boulder.json
  //#when scanArtifacts is called
  //#then it detects the boulder plan artifact
  it("detects boulder.json as boulder-plan", () => {
    const sisyphusDir = join(TEST_DIR, ".sisyphus")
    mkdirSync(sisyphusDir, { recursive: true })
    writeFileSync(join(sisyphusDir, "boulder.json"), '{"active_plan": "test"}')

    const result = scanArtifacts(TEST_DIR, { homeDir: FAKE_HOME })
    expect(result.artifacts).toHaveLength(1)
    expect(result.artifacts[0].class).toBe("boulder-plan")
    expect(result.artifacts[0].relativePath).toBe(".sisyphus/boulder.json")
    expect(result.artifacts[0].contentHash).toHaveLength(16)
    expect(result.artifacts[0].sizeBytes).toBeGreaterThan(0)
  })

  //#given a project with plan markdown files
  //#when scanArtifacts is called
  //#then it detects them as sisyphus-plan artifacts
  it("detects .sisyphus/plans/*.md as sisyphus-plan", () => {
    const plansDir = join(TEST_DIR, ".sisyphus", "plans")
    mkdirSync(plansDir, { recursive: true })
    writeFileSync(join(plansDir, "my-plan.md"), "# Plan\n\nStep 1")
    writeFileSync(join(plansDir, "another.md"), "# Another\n\nStep 2")

    const result = scanArtifacts(TEST_DIR, { homeDir: FAKE_HOME })
    const plans = result.artifacts.filter((a) => a.class === "sisyphus-plan")
    expect(plans).toHaveLength(2)
  })

  //#given a project with draft files
  //#when scanArtifacts is called
  //#then it detects them as sisyphus-draft artifacts
  it("detects .sisyphus/drafts/*.md as sisyphus-draft", () => {
    const draftsDir = join(TEST_DIR, ".sisyphus", "drafts")
    mkdirSync(draftsDir, { recursive: true })
    writeFileSync(join(draftsDir, "spec-v1.md"), "# Draft spec")

    const result = scanArtifacts(TEST_DIR, { homeDir: FAKE_HOME })
    const drafts = result.artifacts.filter((a) => a.class === "sisyphus-draft")
    expect(drafts).toHaveLength(1)
    expect(drafts[0].relativePath).toBe(".sisyphus/drafts/spec-v1.md")
  })

  //#given a project with .opencode/skills/*/SKILL.md files
  //#when scanArtifacts is called
  //#then it detects them recursively as opencode-skill artifacts
  it("detects .opencode/skills/*/SKILL.md recursively", () => {
    const skillDir = join(TEST_DIR, ".opencode", "skills", "my-skill")
    mkdirSync(skillDir, { recursive: true })
    writeFileSync(join(skillDir, "SKILL.md"), "---\nname: my-skill\n---\n# Skill")

    const result = scanArtifacts(TEST_DIR, { homeDir: FAKE_HOME })
    const skills = result.artifacts.filter((a) => a.class === "opencode-skill")
    expect(skills).toHaveLength(1)
    expect(skills[0].relativePath).toContain("SKILL.md")
  })

  //#given context files in ~/.config/opencode/context/
  //#when scanArtifacts is called with homeDir option
  //#then it detects them as context-file artifacts
  it("detects context files from homeDir/.config/opencode/context/", () => {
    const contextDir = join(FAKE_HOME, ".config", "opencode", "context")
    mkdirSync(contextDir, { recursive: true })
    writeFileSync(join(contextDir, "project-notes.md"), "# Notes")

    const result = scanArtifacts(TEST_DIR, { homeDir: FAKE_HOME })
    const contexts = result.artifacts.filter((a) => a.class === "context-file")
    expect(contexts).toHaveLength(1)
  })

  //#given a project with multiple artifact types
  //#when scanArtifacts is called
  //#then it detects all types in one scan
  it("detects multiple artifact types in single scan", () => {
    const sisyphusDir = join(TEST_DIR, ".sisyphus")
    const plansDir = join(sisyphusDir, "plans")
    const skillDir = join(TEST_DIR, ".opencode", "skills", "test-skill")
    mkdirSync(plansDir, { recursive: true })
    mkdirSync(skillDir, { recursive: true })

    writeFileSync(join(sisyphusDir, "boulder.json"), '{"active": true}')
    writeFileSync(join(plansDir, "plan.md"), "# Plan")
    writeFileSync(join(skillDir, "SKILL.md"), "# Skill")

    const result = scanArtifacts(TEST_DIR, { homeDir: FAKE_HOME })
    const classes = result.artifacts.map((a) => a.class)
    expect(classes).toContain("boulder-plan")
    expect(classes).toContain("sisyphus-plan")
    expect(classes).toContain("opencode-skill")
    expect(result.artifacts.length).toBeGreaterThanOrEqual(3)
  })

  //#given each artifact has content
  //#when scanned
  //#then contentHash is a 16-char hex string
  it("generates consistent 16-char hex content hashes", () => {
    const sisyphusDir = join(TEST_DIR, ".sisyphus")
    mkdirSync(sisyphusDir, { recursive: true })
    writeFileSync(join(sisyphusDir, "boulder.json"), '{"test": true}')

    const result = scanArtifacts(TEST_DIR, { homeDir: FAKE_HOME })
    expect(result.artifacts[0].contentHash).toMatch(/^[a-f0-9]{16}$/)
  })

  //#given non-matching files exist in scan targets
  //#when scanArtifacts is called
  //#then it ignores them
  it("ignores non-matching files", () => {
    const sisyphusDir = join(TEST_DIR, ".sisyphus")
    mkdirSync(sisyphusDir, { recursive: true })
    writeFileSync(join(sisyphusDir, "notes.txt"), "random notes")
    writeFileSync(join(sisyphusDir, "config.yaml"), "key: value")

    const result = scanArtifacts(TEST_DIR, { homeDir: FAKE_HOME })
    expect(result.artifacts).toHaveLength(0)
  })
})
