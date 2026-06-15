import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test"
import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { resolveSkillContent } from "./skill-resolver"
import { clearSkillCache } from "../../features/opencode-skill-loader/skill-discovery"

const TEST_DIR = join(tmpdir(), `skill-resolver-test-${Date.now()}`)

function makeNativeSkill(name: string, description: string, content: string) {
  return { name, description, location: `/fake/native/${name}/SKILL.md`, content }
}

function makeNativeAccessor(skills: ReturnType<typeof makeNativeSkill>[]) {
  return {
    all: () => skills,
    get: (name: string) => skills.find((s) => s.name === name),
    dirs: () => ["/fake/native"],
  }
}

describe("resolveSkillContent — nativeSkills integration", () => {
  beforeEach(() => {
    clearSkillCache()
    mkdirSync(TEST_DIR, { recursive: true })
  })

  afterEach(() => {
    clearSkillCache()
    rmSync(TEST_DIR, { recursive: true, force: true })
  })

  it("#given an empty skill list #when resolved #then returns no content with no error", async () => {
    // when
    const result = await resolveSkillContent([], {})
    // then
    expect(result).toEqual({ content: undefined, contents: [], error: null })
  })

  it("#given a skill that lives only in nativeSkills #when resolved #then returns its content", async () => {
    // given
    const native = makeNativeSkill(
      "test-driven-development",
      "TDD discipline",
      "## Red-Green-Refactor\nWrite a failing test first.",
    )
    const nativeSkills = makeNativeAccessor([native])

    // when
    const result = await resolveSkillContent(["test-driven-development"], {
      nativeSkills,
      directory: TEST_DIR,
    })

    // then
    expect(result.error).toBeNull()
    expect(result.contents).toHaveLength(1)
    expect(result.content).toContain("Red-Green-Refactor")
    expect(result.content).toContain("Write a failing test first")
  })

  it("#given a name present in both OMO disk-discovered and nativeSkills #when resolved #then OMO content wins", async () => {
    // given a name we know does NOT collide with builtins; force a fake one
    // We use a fake disk skill via the merger pattern: write a SKILL.md under TEST_DIR/.opencode/skills/
    const skillsDir = join(TEST_DIR, ".opencode", "skills", "shared-name")
    mkdirSync(skillsDir, { recursive: true })
    writeFileSync(
      join(skillsDir, "SKILL.md"),
      "---\nname: shared-name-test-skill\ndescription: from disk\n---\nOMO_DISK_BODY",
    )
    const native = makeNativeSkill(
      "shared-name-test-skill",
      "from native",
      "NATIVE_BODY",
    )
    const nativeSkills = makeNativeAccessor([native])

    // when
    const result = await resolveSkillContent(["shared-name-test-skill"], {
      nativeSkills,
      directory: TEST_DIR,
    })

    // then — OMO wins on name collision (mergeNativeSkills skips already-known names)
    expect(result.error).toBeNull()
    expect(result.content).toContain("OMO_DISK_BODY")
    expect(result.content).not.toContain("NATIVE_BODY")
  })

  it("#given a skill that exists in neither registry #when resolved #then returns notFound error listing the merged set", async () => {
    // given
    const native = makeNativeSkill("alpha", "alpha desc", "alpha body")
    const nativeSkills = makeNativeAccessor([native])

    // when
    const result = await resolveSkillContent(["does-not-exist"], {
      nativeSkills,
      directory: TEST_DIR,
    })

    // then
    expect(result.error).toBeTruthy()
    expect(result.error).toContain("does-not-exist")
    // the merged "Available" list should include the native skill name
    expect(result.error).toContain("alpha")
  })

  it("#given nativeSkills.all() throws #when resolved #then degrades gracefully (still finds disk-discovered skills)", async () => {
    // given
    const exploding = {
      all: () => {
        throw new Error("boom")
      },
      get: () => undefined,
      dirs: () => [],
    }

    // when (we just need this not to throw or hang)
    const result = await resolveSkillContent(["missing-skill"], {
      nativeSkills: exploding,
      directory: TEST_DIR,
    })

    // then — error path still works, no crash
    expect(result.error).toBeTruthy()
    expect(result.error).toContain("missing-skill")
  })

  it("#given preloaded native skill entries #when resolved #then uses them without calling nativeSkills again", async () => {
    // given
    const native = makeNativeSkill(
      "preloaded-native-skill",
      "preloaded desc",
      "PRELOADED_NATIVE_BODY",
    )
    const nativeSkills = {
      all: mock(() => {
        throw new Error("nativeSkills.all should not be called")
      }),
      get: () => undefined,
      dirs: () => [],
    }

    // when
    const result = await resolveSkillContent(["preloaded-native-skill"], {
      nativeSkills,
      nativeSkillEntries: [native],
      directory: TEST_DIR,
    })

    // then
    expect(result.error).toBeNull()
    expect(result.content).toContain("PRELOADED_NATIVE_BODY")
    expect(nativeSkills.all).not.toHaveBeenCalled()
  })

  it("#given a disabled native skill #when delegate load_skills requests it #then it is unavailable", async () => {
    // given
    const native = makeNativeSkill(
      "blocked-native-skill",
      "blocked desc",
      "DELEGATE_BYPASS_CONFIRMED",
    )
    const nativeSkills = makeNativeAccessor([native])

    // when
    const result = await resolveSkillContent(["blocked-native-skill"], {
      nativeSkills,
      directory: TEST_DIR,
      disabledSkills: new Set(["blocked-native-skill"]),
    })

    // then
    expect(result.content).toBeUndefined()
    expect(result.contents).toEqual([])
    expect(result.error).toContain("Skills not found: blocked-native-skill")
    expect(result.error).not.toContain("DELEGATE_BYPASS_CONFIRMED")
  })

  it("#given shared ulw-plan is disabled #when delegate load_skills requests its bare alias #then fallback discovery cannot bypass it", async () => {
    // when
    const result = await resolveSkillContent(["ulw-plan"], {
      directory: TEST_DIR,
      disabledSkills: new Set(["shared/ulw-plan"]),
    })

    // then
    expect(result.content).toBeUndefined()
    expect(result.contents).toEqual([])
    expect(result.error).toContain("Skills not found: ulw-plan")
    expect(result.error).not.toContain("Prometheus")
  })

  it("#given bare ulw-plan is disabled #when delegate load_skills requests its shared alias #then fallback discovery cannot bypass it", async () => {
    // when
    const result = await resolveSkillContent(["shared/ulw-plan"], {
      directory: TEST_DIR,
      disabledSkills: new Set(["ulw-plan"]),
    })

    // then
    expect(result.content).toBeUndefined()
    expect(result.contents).toEqual([])
    expect(result.error).toContain("Skills not found: shared/ulw-plan")
    expect(result.error).not.toContain("Prometheus")
  })

  it("#given a namespaced OMO skill #when requested by unique short name with different case #then resolves it", async () => {
    // given
    const skillsDir = join(TEST_DIR, ".opencode", "skills", "toolkit", "systematic-debugging")
    mkdirSync(skillsDir, { recursive: true })
    writeFileSync(
      join(skillsDir, "SKILL.md"),
      "---\nname: toolkit/systematic-debugging\ndescription: Systematic debugging\n---\nSHORT_NAME_BODY",
    )

    // when
    const result = await resolveSkillContent(["SYSTEMATIC-DEBUGGING"], {
      directory: TEST_DIR,
    })

    // then
    expect(result.error).toBeNull()
    expect(result.content).toContain("SHORT_NAME_BODY")
  })

  it("#given an agent-restricted OMO skill #when another target agent requests it #then filters the restricted skill but keeps public skills", async () => {
    // given
    const oracleSkillDir = join(TEST_DIR, ".opencode", "skills", "oracle-only-skill")
    mkdirSync(oracleSkillDir, { recursive: true })
    writeFileSync(
      join(oracleSkillDir, "SKILL.md"),
      "---\nname: oracle-only-skill\ndescription: Oracle only\nagent: oracle\n---\nORACLE_ONLY_BODY",
    )

    const publicSkillDir = join(TEST_DIR, ".opencode", "skills", "public-skill")
    mkdirSync(publicSkillDir, { recursive: true })
    writeFileSync(
      join(publicSkillDir, "SKILL.md"),
      "---\nname: public-skill\ndescription: Public skill\n---\nPUBLIC_BODY",
    )

    // when
    const result = await resolveSkillContent(["oracle-only-skill", "public-skill"], {
      directory: TEST_DIR,
      targetAgent: "explore",
    })

    // then
    expect(result.error).toBeNull()
    expect(result.content).not.toContain("ORACLE_ONLY_BODY")
    expect(result.content).toContain("PUBLIC_BODY")
    expect(result.contents).toHaveLength(1)
  })

  it("#given no nativeSkills passed #when resolved #then behaves like pre-fix (no native discovery)", async () => {
    // when
    const result = await resolveSkillContent(["does-not-exist"], {
      directory: TEST_DIR,
    })
    // then
    expect(result.error).toBeTruthy()
    expect(result.error).toContain("does-not-exist")
  })
})
