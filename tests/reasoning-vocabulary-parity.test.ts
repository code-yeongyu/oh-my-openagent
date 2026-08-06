import { describe, expect, test } from "bun:test"

import {
  normalizeReasoning as coreNormalize,
  splitReasoningSuffix as coreSplit,
  REASONING_LEVELS as CORE_LEVELS,
} from "../packages/omo-config-core/src/schema/reasoning-vocabulary"
import {
  normalizeReasoning as mcNormalize,
  splitReasoningSuffix as mcSplit,
  REASONING_LEVELS as MC_LEVELS,
} from "../packages/model-core/src/reasoning-level"

describe("reasoning vocabulary parity between model-core and omo-config-core", () => {
  test("#given both modules #when compared #then the level sets and normalization agree", () => {
    // given both implementations (kept separate so the config core does not drag model-core
    // into stricter downstream tsconfigs)

    // when / then the public vocabulary and behavior stay identical
    expect([...MC_LEVELS]).toEqual([...CORE_LEVELS])

    for (const input of ["none", "off", "auto", "xhigh", "thinking", "MAX", " weird "]) {
      expect(mcNormalize(input)).toEqual(coreNormalize(input))
    }

    for (const model of ["openai/gpt-5.6-sol:max", "openai/gpt-5.6-sol:high", "bare:max", "p/m:free"]) {
      expect(mcSplit(model)).toEqual(coreSplit(model))
      expect(mcSplit(model, { allowMaxSuffix: true })).toEqual(coreSplit(model, { allowMaxSuffix: true }))
    }
  })
})
