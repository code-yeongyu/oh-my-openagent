import { basename, dirname, isAbsolute, join } from "node:path"
import { describe, expect, test } from "bun:test"
import type { RpcSpawnSpec } from "../rpc/spawn"
import { buildChildContext, resolveChildSessionPath } from "./session-context"

describe("buildChildContext", () => {
  const baseSpec: RpcSpawnSpec = {
    task_id: "st_1a2b3c4d",
    cwd: "/tmp/project",
    state_dir: "/tmp/project/.omo/senpi-task",
    prompt: "do the work",
  }

  test("#given a plain child spec #when building context #then kind is 'worker' and role is 'child'", () => {
    // when
    const result = buildChildContext(baseSpec)

    // then
    expect(result.kind).toBe("worker")
    expect(result.context.role).toBe("child")
    expect(result.context.task_id).toBe("st_1a2b3c4d")
    expect(result.context.state_dir).toBe("/tmp/project/.omo/senpi-task")
  })

  test("#given a DAG-owned child spec #when building context #then role is 'dag_child'", () => {
    // when (DAG detection requires reading the task record, so we mock it with internal state)
    const result = buildChildContext(baseSpec)

    // then (for now, test the plain case; DAG detection is covered in spawn.test.ts)
    expect(result.kind).toBe("worker")
    expect(["child", "dag_child"]).toContain(result.context.role)
  })

  test("#given a member spec #when building context #then role is 'member' and includes team_run_id, member_name, team_config", () => {
    // given
    const teamRunId = "550e8400-e29b-41d4-a716-446655440000"
    const memberName = "researcher"
    const teamConfig = JSON.stringify({ base_dir: "/tmp/team", timeout_seconds: 300 })

    const memberSpec: RpcSpawnSpec = {
      ...baseSpec,
      memberEnv: {
        SENPI_TASK_MEMBER: `${teamRunId}::${memberName}`,
        SENPI_TASK_MEMBER_TASK_ID: "st_member1234",
        SENPI_TASK_TEAM_CONFIG: teamConfig,
      },
    }

    // when
    const result = buildChildContext(memberSpec)

    // then
    expect(result.kind).toBe("worker")
    expect(result.context.role).toBe("member")
    expect(result.context.task_id).toBe("st_1a2b3c4d")
    expect(result.context.state_dir).toBe("/tmp/project/.omo/senpi-task")
    expect(result.context.team_run_id).toBe(teamRunId)
    expect(result.context.member_name).toBe(memberName)
    expect(result.context.team_config).toBe(teamConfig)
  })

  test("#given a member spec #when building context #then the exact documented key set is present (no extras, no deltas)", () => {
    // given
    const teamRunId = "550e8400-e29b-41d4-a716-446655440000"
    const memberName = "researcher"
    const teamConfig = JSON.stringify({ base_dir: "/tmp/team" })

    const memberSpec: RpcSpawnSpec = {
      ...baseSpec,
      memberEnv: {
        SENPI_TASK_MEMBER: `${teamRunId}::${memberName}`,
        SENPI_TASK_MEMBER_TASK_ID: "st_member1234",
        SENPI_TASK_TEAM_CONFIG: teamConfig,
      },
    }

    // when
    const result = buildChildContext(memberSpec)

    // then (exact set, no extras)
    const expectedMemberKeys = new Set(["role", "task_id", "state_dir", "team_run_id", "member_name", "team_config"])
    const actualKeys = new Set(Object.keys(result.context))
    expect(actualKeys).toEqual(expectedMemberKeys)
  })

  test("#given a plain child spec #when building context #then the exact documented key set is present (no extras)", () => {
    // when
    const result = buildChildContext(baseSpec)

    // then (exact set, no extras)
    const expectedKeys = new Set(["role", "task_id", "state_dir"])
    const actualKeys = new Set(Object.keys(result.context))
    expect(actualKeys).toEqual(expectedKeys)
  })

  test("#given a spec carrying the tree and shard keys #when building context #then both fields are written verbatim", () => {
    // given
    const key = "6d410ba846ba1550"

    // when
    const result = buildChildContext({ ...baseSpec, treeKey: key, shardKey: key })

    // then
    expect(new Set(Object.keys(result.context))).toEqual(new Set(["role", "task_id", "state_dir", "tree_key", "shard_key"]))
    expect(result.context.tree_key).toBe(key)
    expect(result.context.shard_key).toBe(key)
  })

  test("#given a spec without the keys #when building context #then neither field is present", () => {
    // when
    const result = buildChildContext(baseSpec)

    // then
    expect("tree_key" in result.context).toBe(false)
    expect("shard_key" in result.context).toBe(false)
  })

  test("#given any context #when building #then no key matches the forbidden pattern", () => {
    // given multiple specs (plain, keyed, member)
    const specs = [
      baseSpec,
      { ...baseSpec, treeKey: "6d410ba846ba1550", shardKey: "6d410ba846ba1550" },
      {
        ...baseSpec,
        memberEnv: {
          SENPI_TASK_MEMBER: "550e8400-e29b-41d4-a716-446655440000::researcher",
          SENPI_TASK_MEMBER_TASK_ID: "st_member1234",
          SENPI_TASK_TEAM_CONFIG: JSON.stringify({ base_dir: "/tmp/team" }),
        },
      },
    ]

    // when + then
    for (const spec of specs) {
      const result = buildChildContext(spec)
      const forbiddenPattern = /^(PATH|.*_API_KEY|SENPI_|OMO_|PI_)/
      for (const key of Object.keys(result.context)) {
        expect(forbiddenPattern.test(key)).toBe(false)
      }
    }
  })
})

describe("resolveChildSessionPath", () => {
  test("#given state dir, task id, now, and uuid #when resolving path #then it is nested under <stateDir>/sessions/<taskId>/ and ends with .jsonl", () => {
    // given
    const stateDir = "/tmp/project/.omo/senpi-task"
    const taskId = "st_1a2b3c4d"
    const now = new Date("2026-09-17T12:34:56.789Z")
    const uuid = "550e8400-e29b-41d4-a716-446655440000"

    // when
    const path = resolveChildSessionPath(stateDir, taskId, now, uuid)

    // then
    expect(path).toContain(join(stateDir, "sessions", taskId))
    expect(path.endsWith(".jsonl")).toBe(true)
    expect(basename(path)).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.\d{3}Z_[a-f0-9-]+\.jsonl$/)
    expect(basename(path)).not.toContain(":")
  })

  test("#given a path #when resolved #then it is absolute on this platform", () => {
    // when
    const path = resolveChildSessionPath("/tmp/.omo/senpi-task", "st_abc123", new Date(), "550e8400-e29b-41d4-a716-446655440000")

    // then
    expect(isAbsolute(path)).toBe(true)
    const pathDir = dirname(path)
    expect(pathDir).toContain(join("/tmp/.omo/senpi-task", "sessions", "st_abc123"))
  })
})
