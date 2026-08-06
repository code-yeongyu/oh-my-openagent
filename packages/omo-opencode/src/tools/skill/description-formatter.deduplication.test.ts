import { describe, expect, it } from "bun:test"
import { deduplicatePathAliasedSkills } from "./description-formatter"
import {
  builtinSharedSkill,
  localSkill,
  makeSkill,
  opencodeNativeSkill,
  sharedSkill,
  userSkill,
} from "./description-formatter.test-support"

describe("deduplicatePathAliasedSkills", () => {
  it("keeps all skills when there are no duplicate names", () => {
    const skills = [makeSkill("debugging"), makeSkill("review-work"), makeSkill("git-master")]
    expect(deduplicatePathAliasedSkills(skills).map((s) => s.name)).toEqual([
      "debugging",
      "review-work",
      "git-master",
    ])
  })

  it("is a no-op after the shared/ prefix cutover", () => {
    const skills = [
      sharedSkill("debugging"),
      builtinSharedSkill("debugging"),
      makeSkill("review-work"),
    ]
    const result = deduplicatePathAliasedSkills(skills)
    expect(result.map((s) => s.name)).toEqual([
      "shared/debugging",
      "debugging",
      "review-work",
    ])
  })

  it("handles multiple skills in one pass", () => {
    const skills = [
      sharedSkill("debugging"),
      builtinSharedSkill("debugging"),
      sharedSkill("remove-ai-slops"),
      builtinSharedSkill("remove-ai-slops"),
      makeSkill("review-work"),
    ]
    const result = deduplicatePathAliasedSkills(skills)
    expect(result.map((s) => s.name)).toEqual([
      "shared/debugging",
      "debugging",
      "shared/remove-ai-slops",
      "remove-ai-slops",
      "review-work",
    ])
  })

  it("keeps user, project, and opencode native skills", () => {
    const skills = [
      userSkill("debugging"),
      localSkill("debugging"),
      opencodeNativeSkill("debugging"),
      sharedSkill("debugging"),
    ]
    expect(deduplicatePathAliasedSkills(skills).map((s) => s.name)).toEqual([
      "debugging",
      "debugging",
      "debugging",
      "shared/debugging",
    ])
  })
})
