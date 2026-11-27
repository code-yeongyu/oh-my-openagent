/// <reference types="bun-types" />

import { describe, expect, it } from "bun:test"
import { OmoGitMasterSettingsLayerSchema } from "@oh-my-opencode/omo-config-core"
import { isValidGitEnvPrefix } from "@oh-my-opencode/skills-loader-core/config/git-env-prefix"

// omo-config-core is a leaf package, so it carries its own copy of the plugin's git_env_prefix
// rule; this keeps both copies accepting and rejecting the same values.
const CANDIDATES = [
  "",
  "GIT_MASTER=1",
  "GIT_MASTER=1 OMO_AGENT=x",
  "A=",
  "_X=a-b_c",
  "GIT_MASTER=1;",
  "GIT_MASTER=1; rm -rf /",
  "GIT_MASTER='1'",
  "GIT_MASTER=1  OMO=2",
  " GIT_MASTER=1",
  "1X=1",
  "GIT_MASTER",
  "GIT_MASTER=$(id)",
  "GIT_MASTER=a.b",
] as const

describe("git_env_prefix validation parity", () => {
  it("#given the omo.json schema and the plugin validator #when each candidate is checked #then both give the same verdict", () => {
    for (const candidate of CANDIDATES) {
      const schemaAccepts = OmoGitMasterSettingsLayerSchema.safeParse({ git_env_prefix: candidate }).success
      expect({ candidate, accepted: schemaAccepts }).toEqual({ candidate, accepted: isValidGitEnvPrefix(candidate) })
    }
  })
})
