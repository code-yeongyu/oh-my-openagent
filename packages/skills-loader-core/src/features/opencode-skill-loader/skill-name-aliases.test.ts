import { describe, expect, test } from "bun:test"

import { resolveSkillAlias, skillNamesResolvingTo } from "./skill-name-aliases"

describe("skill name aliases", () => {
  test("#given the retired git-master name #when resolved #then it becomes git, and git lists both names", () => {
    expect(resolveSkillAlias("git-master")).toBe("git")
    expect(skillNamesResolvingTo("git")).toEqual(["git", "git-master"])
  })

  test("#given a name that is no alias, including Object.prototype member names #when resolved #then it is returned unchanged", () => {
    for (const name of ["frontend", "constructor", "toString", "__proto__", "hasOwnProperty"]) {
      expect(resolveSkillAlias(name)).toBe(name)
    }
  })
})
