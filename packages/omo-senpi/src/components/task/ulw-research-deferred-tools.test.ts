import { describe, expect, it } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

import { buildLeadTeamTools } from "@oh-my-opencode/senpi-task"

// #11052: a deferred (search-exposed) tool is absent from the first tool list, so a skill that needs
// one must name it as deferred or sessions conclude it does not exist. The ulw-research skill keeps
// that list on one `**Deferred tools: ...**` line; this pins the line to the engine's real exposure.
const skillPath = join(import.meta.dir, "..", "..", "..", "skills", "ulw-research", "SKILL.md")

function namedDeferredTools(skill: string): string[] {
  const line = /\*\*Deferred tools: ([^*]+)\*\*/.exec(skill)?.[1] ?? ""
  return [...line.matchAll(/`([a-z_]+)`/g)].map((match) => match[1] ?? "").sort()
}

describe("ulw-research deferred team tools", () => {
  it("#given the lead team tools the skill uses #when the engine defers them #then the skill names exactly those as deferred", () => {
    // given
    const skill = readFileSync(skillPath, "utf8")
    const used = buildLeadTeamTools({ service: {} } as never).filter((tool) => skill.includes(`\`${tool.name}\``))

    // when
    const deferred = used.filter((tool) => tool.exposure === "search").map((tool) => tool.name).sort()

    // then
    expect(deferred.length).toBeGreaterThan(0)
    expect(namedDeferredTools(skill)).toEqual(deferred)
  })
})
