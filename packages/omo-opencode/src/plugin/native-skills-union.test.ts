import { describe, expect, test } from "bun:test"
import { unsafeTestValue } from "../../../../test-support/unsafe-test-value"
import { createUnionNativeSkills } from "./native-skills"
import type { PluginContext } from "./types"

type NativeSkillEntry = {
  name: string
  description: string
  location: string
  content: string
}

function entry(name: string, overrides: Partial<NativeSkillEntry> = {}): NativeSkillEntry {
  return {
    name,
    description: `Skill ${name}`,
    location: `/skills/${name}/SKILL.md`,
    content: `# ${name}`,
    ...overrides,
  }
}

function accessor(entries: NativeSkillEntry[] | Error) {
  return {
    all: () => (entries instanceof Error ? Promise.reject(entries) : Promise.resolve(entries)),
    get: async (name: string) =>
      entries instanceof Error ? undefined : entries.find((skill) => skill.name === name),
    dirs: () => [] as string[],
  }
}

describe("union native skills accessor", () => {
  test("keeps sibling-plugin skills loadable when the host accessor omits them", async () => {
    // given: a host-provided skills accessor that does not include the
    // sibling-plugin skill (issue #4250 reproduction shape)
    const hostAccessor = accessor([entry("customize-opencode")])
    const fetchedAccessor = accessor([entry("brainstorming"), entry("writing-skills")])

    // when
    const union = createUnionNativeSkills(
      unsafeTestValue<PluginContext["skills"]>(hostAccessor),
      unsafeTestValue<PluginContext["skills"]>(fetchedAccessor),
    )
    const all = await union.all()

    // then
    expect(all.map((skill) => skill.name).sort()).toEqual([
      "brainstorming",
      "customize-opencode",
      "writing-skills",
    ])
    expect(await union.get("brainstorming")).toMatchObject({ name: "brainstorming" })
  })

  test("prefers the host entry when both sources declare the same name", async () => {
    // given
    const hostAccessor = accessor([entry("shared-skill", { description: "from host" })])
    const fetchedAccessor = accessor([entry("shared-skill", { description: "from fetch" })])

    // when
    const union = createUnionNativeSkills(
      unsafeTestValue<PluginContext["skills"]>(hostAccessor),
      unsafeTestValue<PluginContext["skills"]>(fetchedAccessor),
    )
    const all = await union.all()

    // then
    expect(all).toHaveLength(1)
    expect(all[0]?.description).toBe("from host")
  })

  test("still returns fetched skills when the host accessor rejects", async () => {
    // given
    const hostAccessor = accessor(new Error("host accessor unavailable"))
    const fetchedAccessor = accessor([entry("systematic-debugging")])

    // when
    const union = createUnionNativeSkills(
      unsafeTestValue<PluginContext["skills"]>(hostAccessor),
      unsafeTestValue<PluginContext["skills"]>(fetchedAccessor),
 )

    // then
    expect((await union.all()).map((skill) => skill.name)).toEqual(["systematic-debugging"])
  })

  test("still returns host skills when the fetched source rejects", async () => {
    // given
    const hostAccessor = accessor([entry("customize-opencode")])
    const fetchedAccessor = accessor(new Error("/skill route unavailable"))

    // when
    const union = createUnionNativeSkills(
      unsafeTestValue<PluginContext["skills"]>(hostAccessor),
      unsafeTestValue<PluginContext["skills"]>(fetchedAccessor),
    )

    // then
    expect((await union.all()).map((skill) => skill.name)).toEqual(["customize-opencode"])
  })

  test("unions dirs from both sources without duplicates", () => {
    // given
    const hostAccessor = {
      all: () => [],
      get: async () => undefined,
      dirs: () => ["/skills/a", "/skills/b"],
    }
    const fetchedAccessor = {
      all: () => [],
      get: async () => undefined,
      dirs: () => ["/skills/b", "/skills/c"],
    }

    // when
    const union = createUnionNativeSkills(
      unsafeTestValue<PluginContext["skills"]>(hostAccessor),
      unsafeTestValue<PluginContext["skills"]>(fetchedAccessor),
    )

    // then
    expect(union.dirs().sort()).toEqual(["/skills/a", "/skills/b", "/skills/c"])
  })
})
