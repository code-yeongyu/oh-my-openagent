import { describe, expect, test } from "bun:test"

import { OmoConfigSchema } from "@oh-my-opencode/omo-config-core"

import { BUILTIN_AGENTS } from "../agents/builtin"
import type { AgentDefinition } from "../agents/types"
import { resolveDagNodeExecutionMode } from "./execution-mode"

describe("resolveDagNodeExecutionMode", () => {
  test("#given no sources at all #when resolved #then the default is in-process", () => {
    // given
    const route = { kind: "category" as const, category: "quick" }

    // when
    const mode = resolveDagNodeExecutionMode({ route, agents: {}, config: {} })

    // then
    expect(mode).toBe("in-process")
  })

  test("#given an omo.json task.default_execution_mode #when resolved #then the config mode is honored", () => {
    // given
    const route = { kind: "category" as const, category: "quick" }
    const config = { task: { default_execution_mode: "process" as const } }

    // when
    const mode = resolveDagNodeExecutionMode({ route, agents: {}, config })

    // then
    expect(mode).toBe("process")
  })

  test("#given a per-agent executionMode #when resolved #then the agent mode wins over config", () => {
    // given
    const route = { kind: "agent" as const, agent: "writer" }
    const agents: Record<string, AgentDefinition> = {
      writer: { name: "writer", executionMode: "process" },
    }
    const config = { task: { default_execution_mode: "in-process" as const } }

    // when
    const mode = resolveDagNodeExecutionMode({ route, agents, config })

    // then
    expect(mode).toBe("process")
  })

  test("#given a curated read-only agent configured for process #when resolved #then it is forced in-process", () => {
    // given
    const route = { kind: "agent" as const, agent: "explore" }
    const agents: Record<string, AgentDefinition> = {
      explore: { ...BUILTIN_AGENTS.explore, executionMode: "process" },
    }
    const config = { task: { default_execution_mode: "process" as const } }

    // when
    const mode = resolveDagNodeExecutionMode({ route, agents, config })

    // then
    expect(mode).toBe("in-process")
  })
})

describe("dag execution mode config surface", () => {
  test("#given a config carrying task.dag.default_execution_mode #when parsed #then the strict schema rejects it", () => {
    // given
    const config = {
      task: {
        dag: {
          max_nodes_per_run: 8,
          default_execution_mode: "process",
        },
      },
    }

    // when
    const result = OmoConfigSchema.safeParse(config)

    // then
    expect(result.success).toBe(false)
  })
})
