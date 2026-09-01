import { describe, expect, test } from "bun:test"

import { isSpawnSpecV1 } from "./types"
import type { LegacyProcessSpawnSpec, SpawnSpecV1, TaskSpawnSpec } from "./types"

describe("isSpawnSpecV1", () => {
  test("#given a legacy process-mode spawn spec #when classified #then it is not v1", () => {
    // given
    const legacy: LegacyProcessSpawnSpec = { cwd: "/tmp/project" }

    // when
    const result = isSpawnSpecV1(legacy)

    // then
    expect(result).toBe(false)
  })

  test("#given a legacy spec carrying extensions and member_env #when classified #then it stays the legacy variant", () => {
    // given
    const legacy: TaskSpawnSpec = {
      cwd: "/tmp/project",
      extensions: ["/tmp/member-extension.ts"],
      member_env: { SENPI_TASK_MEMBER: "run-1::alpha" },
    }

    // when
    const result = isSpawnSpecV1(legacy)

    // then
    expect(result).toBe(false)
  })

  test("#given a v1 spawn spec #when classified #then it is v1 and narrows to the rebuildable fields", () => {
    // given
    const spec: TaskSpawnSpec = {
      version: 1,
      cwd: "/tmp/project",
      prompt: "implement the south gate",
      instructions: "keep the ledger intact",
      member_scoped_tool_names: ["task", "read"],
    }

    // when
    const result = isSpawnSpecV1(spec)

    // then
    expect(result).toBe(true)
    if (!isSpawnSpecV1(spec)) throw new Error("expected the spec to narrow to SpawnSpecV1")
    const v1: SpawnSpecV1 = spec
    expect(v1.prompt).toBe("implement the south gate")
    expect(v1.instructions).toBe("keep the ledger intact")
    expect(v1.member_scoped_tool_names).toEqual(["task", "read"])
  })

  test("#given a malformed spec with an unknown version #when classified #then it is rejected as not v1", () => {
    // given
    // A record written by a newer schema must never be treated as a rebuildable v1 spec.
    const malformed: unknown = { version: 2, cwd: "/tmp/project", prompt: "sneaky" }

    // when
    const result = isSpawnSpecV1(malformed as TaskSpawnSpec)

    // then
    expect(result).toBe(false)
  })
})
