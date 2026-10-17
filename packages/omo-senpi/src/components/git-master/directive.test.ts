/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { OmoGitMasterSettingsSchema } from "@oh-my-opencode/omo-config-core"

import { buildGitMasterAttributionDirective } from "./directive"

describe("omo-senpi git-master attribution directive", () => {
  test("#given default git_master settings #when the senpi attribution directive is built #then it does not instruct a GitHub-resolvable co-author", () => {
    // given
    const settings = OmoGitMasterSettingsSchema.parse({})

    // when
    const directive = buildGitMasterAttributionDirective(settings)

    // then
    expect(directive ?? "").not.toMatch(/Co-authored-by:/i)
    expect(directive ?? "").not.toContain("sisyphus-dev-ai")
    expect(directive ?? "").not.toContain("users.noreply.github.com")
  })

  test("#given default git_master settings #when the senpi attribution directive is built #then no directive is emitted at all", () => {
    // given
    const settings = OmoGitMasterSettingsSchema.parse({})

    // when
    const directive = buildGitMasterAttributionDirective(settings)

    // then
    expect(directive).toBeUndefined()
  })

  test("#given the deprecated include_co_authored_by opt-in #when the directive is built #then no Co-authored-by trailer is emitted", () => {
    // given
    const settings = OmoGitMasterSettingsSchema.parse({ commit_footer: true, include_co_authored_by: true })

    // when
    const directive = buildGitMasterAttributionDirective(settings)

    // then
    expect(directive).toBeDefined()
    expect(directive ?? "").toContain("Ultraworked with")
    expect(directive ?? "").not.toMatch(/Co-authored-by:/i)
    expect(directive ?? "").not.toContain("users.noreply.github.com")
  })
})
