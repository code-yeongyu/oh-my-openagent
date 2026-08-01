import { describe, expect, test } from "bun:test"

import { resolveOmoConfigView } from "../index"

describe("resolveOmoConfigView codegraph harness folding", () => {
  test("#given overlapping base and codex excluded roots #when folding the codex block #then roots retain their ordered unique union", () => {
    // given
    const config = {
      codegraph: {
        excluded_roots: ["/tmp/omo-base", "/tmp/omo-shared"],
      },
      "[codex]": {
        codegraph: {
          excluded_roots: ["/tmp/omo-shared", "/tmp/omo-codex"],
        },
      },
    }

    // when
    const result = resolveOmoConfigView({ config, harness: "codex" })

    // then
    expect(result.diagnostics).toEqual([])
    expect(result.config).toEqual({
      codegraph: {
        excluded_roots: ["/tmp/omo-base", "/tmp/omo-shared", "/tmp/omo-codex"],
      },
    })
  })
})
