import { describe, expect, test } from "bun:test"
import type { OhMyOpenCodeConfig } from "../../config"
import {
  applyRuntimeSkillSourceConfig,
  selectRuntimeSecuritySkills,
  type OpenCodeSkillHostConfig,
} from "./runtime-skill-config"

type DisabledSkillName = NonNullable<OhMyOpenCodeConfig["disabled_skills"]>[number]

function createPluginConfig(disabledSkills?: readonly DisabledSkillName[]): OhMyOpenCodeConfig {
  return {
    git_master: {
      commit_footer: true,
      include_co_authored_by: true,
      git_env_prefix: "GIT_MASTER=1",
    },
    disabled_skills: disabledSkills ? [...disabledSkills] : undefined,
  }
}

describe("OpenCode runtime skill source config", () => {
  test("adds the runtime source URL while preserving existing skill URLs and paths", () => {
    // given
    const config: OpenCodeSkillHostConfig = {
      skills: {
        urls: ["https://example.com/skills"],
        paths: ["/keep/user/path"],
      },
    }

    // when
    applyRuntimeSkillSourceConfig({
      config,
      pluginConfig: createPluginConfig(),
      sourceUrl: "http://127.0.0.1:49152/",
    })

    // then
    expect(config.skills?.urls).toEqual([
      "https://example.com/skills",
      "http://127.0.0.1:49152/",
    ])
    expect(config.skills?.paths).toEqual(["/keep/user/path"])
  })

  test("deduplicates the runtime source URL", () => {
    // given
    const config: OpenCodeSkillHostConfig = {
      skills: {
        urls: ["http://127.0.0.1:49152/"],
      },
    }

    // when
    applyRuntimeSkillSourceConfig({
      config,
      pluginConfig: createPluginConfig(),
      sourceUrl: "http://127.0.0.1:49152/",
    })

    // then
    expect(config.skills?.urls).toEqual(["http://127.0.0.1:49152/"])
  })

  test("does not create skills config when every runtime security skill is disabled", () => {
    // given
    const config: OpenCodeSkillHostConfig = {}

    // when
    applyRuntimeSkillSourceConfig({
      config,
      pluginConfig: createPluginConfig(["security-research", "security-review"]),
      sourceUrl: "http://127.0.0.1:49152/",
    })

    // then
    expect(config.skills).toBeUndefined()
  })

  test("security-research disablement keeps security-review enabled", () => {
    // given
    const pluginConfig = createPluginConfig(["security-research"])

    // when
    const skills = selectRuntimeSecuritySkills(pluginConfig)

    // then
    expect(skills.map((skill) => skill.name)).toEqual(["security-review"])
  })

  test("security-review disablement suppresses only the review alias", () => {
    // given
    const pluginConfig = createPluginConfig(["security-review"])

    // when
    const skills = selectRuntimeSecuritySkills(pluginConfig)

    // then
    expect(skills.map((skill) => skill.name)).toEqual(["security-research"])
  })
})
