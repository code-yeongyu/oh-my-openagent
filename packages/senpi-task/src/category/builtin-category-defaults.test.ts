import { describe, expect, test } from "bun:test"

import { BUILTIN_CATEGORY_DEFAULTS } from "./index"

describe("builtin category defaults", () => {
  test("#given ported builtin defaults #when snapshotted #then all eight category defaults stay pinned", () => {
    // given
    const defaults = BUILTIN_CATEGORY_DEFAULTS

    // when
    const snapshotSubject = defaults.map(({ config, description, name, promptAppend }) => ({
      name,
      config,
      description,
      promptAppend,
    }))

    // then
    expect(JSON.stringify(snapshotSubject, null, 2)).toMatchSnapshot()
    expect(defaults.map((entry) => entry.name)).toEqual([
      "visual-engineering",
      "artistry",
      "ultrabrain",
      "deep",
      "quick",
      "unspecified-low",
      "unspecified-high",
      "writing",
    ])
  })
})
