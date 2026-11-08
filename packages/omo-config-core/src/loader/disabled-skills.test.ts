import { describe, expect, test } from "bun:test"

import { collectDisabledSkills } from "./disabled-skills"
import type { OmoConfigRawLayer } from "./types"

function layer(config: Record<string, unknown>): OmoConfigRawLayer {
  return { config, source: { exists: true, loaded: true, path: "/tmp/omo.jsonc", scope: "user" } }
}

describe("collectDisabledSkills across the harness rename", () => {
  test("#given a canonical [native]-scoped denylist #when collecting for the native harness #then the name is denied", () => {
    // given
    const layers = [layer({ "[native]": { disabled_skills: ["native-scoped"] } })]

    // when
    const names = collectDisabledSkills({ harness: "native", layers })

    // then
    expect([...names]).toEqual(["native-scoped"])
  })

  test("#given a legacy [senpi]-scoped denylist #when collecting for the native harness #then the name is still denied", () => {
    // given
    const layers = [layer({ "[senpi]": { disabled_skills: ["legacy-scoped"] } })]

    // when
    const names = collectDisabledSkills({ harness: "native", layers })

    // then
    expect([...names]).toEqual(["legacy-scoped"])
  })

  test("#given a caller still naming the senpi harness #when collecting #then a canonical [native] denylist is honored", () => {
    // given
    const layers = [layer({ "[native]": { disabled_skills: ["native-scoped"] } })]

    // when
    const names = collectDisabledSkills({ harness: "senpi", layers })

    // then
    expect([...names]).toEqual(["native-scoped"])
  })

  test("#given both spellings and a profile copy #when collecting #then every name is unioned", () => {
    // given
    const layers = [layer({
      disabled_skills: ["base"],
      "[native]": { disabled_skills: ["native-scoped"] },
      "[senpi]": { disabled_skills: ["legacy-scoped"] },
      profiles: { kimi: { "[senpi]": { disabled_skills: ["profile-legacy"] } } },
    })]

    // when
    const names = collectDisabledSkills({ harness: "native", layers, profile: "kimi" })

    // then
    expect([...names].sort()).toEqual(["base", "legacy-scoped", "native-scoped", "profile-legacy"])
  })

  test("#given another harness scope #when collecting #then its denylist is ignored", () => {
    // given
    const layers = [layer({ "[codex]": { disabled_skills: ["codex-scoped"] } })]

    // when / then
    expect([...collectDisabledSkills({ harness: "native", layers })]).toEqual([])
  })
})
