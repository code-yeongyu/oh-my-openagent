import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, test } from "bun:test"

import { DEFAULT_CATEGORIES } from "../../tools/delegate-task/builtin-categories"
import { REFACTOR_TEMPLATE } from "./templates/refactor"
import { REFACTOR_TEAM_MODE_ADDENDUM } from "./templates/refactor-sections/team-mode-addendum"

const SKILL_PATH = join(import.meta.dir, "..", "..", "..", "..", "shared-skills", "skills", "refactor", "SKILL.md")

const countMentions = (source: string, name: string): number =>
  (source.match(new RegExp(`\\b${name}\\b`, "g")) ?? []).length

describe("refactor skill twin stays in routing-vocabulary sync", () => {
  test("#given the /refactor command template and the shipped SKILL.md #when both name delegation categories #then each category is mentioned the same number of times in both", () => {
    const twin = REFACTOR_TEMPLATE + REFACTOR_TEAM_MODE_ADDENDUM
    const skill = readFileSync(SKILL_PATH, "utf8")
    const mismatched = Object.keys(DEFAULT_CATEGORIES)
      .map((name) => ({ name, twin: countMentions(twin, name), skill: countMentions(skill, name) }))
      .filter((row) => row.twin !== row.skill)
    expect(
      mismatched.map((row) => `${row.name}: twin=${row.twin} skill=${row.skill}`),
      `category vocabulary drifted between the TS twin and the SKILL.md (#11080)`,
    ).toEqual([])
  })
})
