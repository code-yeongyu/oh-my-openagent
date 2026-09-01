import { describe, expect, it } from "bun:test"

import { compileDag, type DagDefinition, type DagNodeInput } from "./graph"
import type { DagNodeId } from "./types"

const nodeId = (value: string): DagNodeId => value as DagNodeId

const AT = "2026-01-01T00:00:00.000Z"

function node(id: string, dependsOn: readonly string[] = [], overrides: Partial<DagNodeInput> = {}): DagNodeInput {
  return {
    id,
    prompt: `do ${id}`,
    category: "quick",
    ...(dependsOn.length > 0 ? { dependsOn: [...dependsOn] } : {}),
    ...overrides,
  } as DagNodeInput
}

function definition(nodes: readonly DagNodeInput[]): DagDefinition {
  return { key: "run-key", name: "example", nodes }
}

const diamond = definition([
  node("plan"),
  node("build", ["plan"]),
  node("test", ["plan"]),
  node("synthesize", ["build", "test"]),
])

describe("compileDag structure", () => {
  it("#given a 4-node diamond #when compiled #then waves follow fan-out then join", () => {
    // when
    const result = compileDag(diamond, { at: AT })

    // then
    expect(result.ok).toBe(true)
    expect(result.waves.map((wave) => wave.nodeIds)).toEqual([
      [nodeId("plan")],
      [nodeId("build"), nodeId("test")],
      [nodeId("synthesize")],
    ])
    expect(result.waves.map((wave) => wave.index)).toEqual([0, 1, 2])
    expect(result.diagnostics).toEqual([])
  })

  it("#given a diamond #when compiled #then edges derive from dependsOn only", () => {
    const result = compileDag(diamond, { at: AT })
    expect(result.edges).toEqual([
      { from: nodeId("plan"), to: nodeId("build") },
      { from: nodeId("plan"), to: nodeId("test") },
      { from: nodeId("build"), to: nodeId("synthesize") },
      { from: nodeId("test"), to: nodeId("synthesize") },
    ])
  })

  it("#given nodes with routes and labels #when compiled #then nodes carry pending state and the submitted prompt", () => {
    // given
    const withTargets = definition([
      node("a", [], { label: "Alpha", task_summary: "sum", description: "desc", load_skills: ["programming"] }),
      { id: "b", prompt: "run b", subagent_type: "momus", model: "gpt-5.6", dependsOn: ["a"] },
    ])

    // when
    const result = compileDag(withTargets, { at: AT })

    // then
    expect(result.nodes[0]).toMatchObject({
      id: nodeId("a"),
      label: "Alpha",
      prompt: "do a",
      route: { kind: "category", category: "quick" },
      dependsOn: [],
      state: "pending",
      attempt: 0,
      createdAt: AT,
    })
    expect(result.nodes[1]).toMatchObject({
      id: nodeId("b"),
      prompt: "run b",
      route: { kind: "agent", agent: "momus", model: "gpt-5.6" },
      dependsOn: [nodeId("a")],
      state: "pending",
    })
  })

  it("#given a downstream node #when compiled #then the prompt is never templated with upstream ids", () => {
    // given: scheduling-only dependsOn, no substitution
    const templated = definition([node("plan"), { id: "build", prompt: "use {{plan}}", category: "quick", dependsOn: ["plan"] }])

    // when
    const result = compileDag(templated, { at: AT })

    // then
    expect(result.nodes[1]?.prompt).toBe("use {{plan}}")
  })
})

describe("compileDag ordering determinism", () => {
  it("#given same-wave nodes declared out of id order #when compiled #then wave order follows declaration index then id", () => {
    // given: zeta declared before alpha, both roots; beta and gamma both depend on zeta
    const declared = definition([node("zeta"), node("alpha"), node("gamma", ["zeta"]), node("beta", ["zeta"])])

    // when
    const result = compileDag(declared, { at: AT })

    // then
    expect(result.waves.map((wave) => wave.nodeIds)).toEqual([
      [nodeId("zeta"), nodeId("alpha")],
      [nodeId("gamma"), nodeId("beta")],
    ])
  })

  it("#given identical graphs declared in different node order #when compiled #then wave membership is identical", () => {
    const forward = compileDag(diamond, { at: AT })
    const backward = compileDag(
      definition([node("synthesize", ["build", "test"]), node("test", ["plan"]), node("build", ["plan"]), node("plan")]),
      { at: AT },
    )
    expect(backward.waves.map((wave) => [...wave.nodeIds].sort())).toEqual(
      forward.waves.map((wave) => [...wave.nodeIds].sort()),
    )
  })
})

describe("compileDag critical path", () => {
  it("#given a longest chain #when compiled #then the critical path is that chain in dependency order", () => {
    // given: a->b->c->d is longer than the a->e shortcut
    const chained = definition([node("a"), node("b", ["a"]), node("c", ["b"]), node("d", ["c"]), node("e", ["a"])])

    const result = compileDag(chained, { at: AT })

    expect(result.criticalPath).toEqual([nodeId("a"), nodeId("b"), nodeId("c"), nodeId("d")])
  })

  it("#given two equally long chains #when compiled #then the tie breaks lexicographically on the full id sequence", () => {
    // given: root -> (m|b) -> leaf-of-same-length, declared with the lexicographically larger branch first
    const tied = definition([
      node("root"),
      node("m1", ["root"]),
      node("m2", ["m1"]),
      node("b1", ["root"]),
      node("b2", ["b1"]),
    ])

    const result = compileDag(tied, { at: AT })

    expect(result.criticalPath).toEqual([nodeId("root"), nodeId("b1"), nodeId("b2")])
  })
})

describe("compileDag bottlenecks", () => {
  it("#given a diamond #when compiled #then bottlenecks count transitive descendants sorted by blocked count then id", () => {
    const result = compileDag(diamond, { at: AT })

    expect(result.bottlenecks).toEqual([
      { nodeId: nodeId("plan"), blockedCount: 3 },
      { nodeId: nodeId("build"), blockedCount: 1 },
      { nodeId: nodeId("test"), blockedCount: 1 },
      { nodeId: nodeId("synthesize"), blockedCount: 0 },
    ])
  })

  it("#given a deep chain #when compiled #then transitive descendants are counted, not direct dependents", () => {
    const chain = definition([node("a"), node("b", ["a"]), node("c", ["b"])])

    const result = compileDag(chain, { at: AT })

    expect(result.bottlenecks[0]).toEqual({ nodeId: nodeId("a"), blockedCount: 2 })
  })
})

describe("compileDag validation", () => {
  it("#given duplicate node ids #when compiled #then rejected naming the duplicate id and no graph produced", () => {
    const result = compileDag(definition([node("a"), node("a")]), { at: AT })

    expect(result.ok).toBe(false)
    expect(result.nodes).toEqual([])
    expect(result.waves).toEqual([])
    expect(result.errors.map((error) => error.code)).toEqual(["duplicate_node_id"])
    expect(result.errors[0]?.nodeIds).toEqual([nodeId("a")])
    expect(result.diagnostics[0]).toMatchObject({ kind: "node_flag", nodeId: nodeId("a"), at: AT })
    expect(result.diagnostics[0]?.message).toContain("a")
  })

  it("#given an unknown dependency #when compiled #then rejected naming the missing id", () => {
    const result = compileDag(definition([node("a"), node("b", ["ghost"])]), { at: AT })

    expect(result.ok).toBe(false)
    expect(result.errors.map((error) => error.code)).toEqual(["unknown_dependency"])
    expect(result.errors[0]?.nodeIds).toEqual([nodeId("b"), nodeId("ghost")])
    expect(result.diagnostics[0]?.message).toContain("ghost")
  })

  it("#given a self dependency #when compiled #then rejected as a self dependency, not a cycle", () => {
    const result = compileDag(definition([node("a", ["a"])]), { at: AT })

    expect(result.ok).toBe(false)
    expect(result.errors.map((error) => error.code)).toEqual(["self_dependency"])
    expect(result.errors[0]?.nodeIds).toEqual([nodeId("a")])
  })

  it("#given a cyclic 3-node graph #when compiled #then rejected listing the exact cycle members deterministically", () => {
    const cyclic = definition([node("c", ["b"]), node("b", ["a"]), node("a", ["c"]), node("free")])

    const result = compileDag(cyclic, { at: AT })

    expect(result.ok).toBe(false)
    expect(result.errors.map((error) => error.code)).toEqual(["cycle"])
    expect(result.errors[0]?.nodeIds).toEqual([nodeId("a"), nodeId("b"), nodeId("c"), nodeId("a")])
    expect(result.errors[0]?.nodeIds).not.toContain(nodeId("free"))
    expect(result.diagnostics[0]).toMatchObject({ kind: "run_flag", at: AT })
    expect(result.diagnostics[0]?.message).toContain("a -> b -> c -> a")
  })

  it("#given the same cyclic graph declared in a different order #when compiled #then the cycle listing is identical", () => {
    const first = compileDag(definition([node("c", ["b"]), node("b", ["a"]), node("a", ["c"])]), { at: AT })
    const second = compileDag(definition([node("a", ["c"]), node("c", ["b"]), node("b", ["a"])]), { at: AT })

    expect(second.errors[0]?.nodeIds).toEqual(first.errors[0]?.nodeIds ?? [])
  })
})

describe("compileDag size bounds", () => {
  it("#given 65 nodes #when compiled with default settings #then rejected on max_nodes_per_run", () => {
    const nodes = Array.from({ length: 65 }, (_, index) => node(`n${String(index).padStart(3, "0")}`))

    const result = compileDag(definition(nodes), { at: AT })

    expect(result.ok).toBe(false)
    expect(result.errors.map((error) => error.code)).toEqual(["node_count_exceeded"])
    expect(result.errors[0]?.message).toContain("65")
    expect(result.errors[0]?.message).toContain("64")
  })

  it("#given 64 nodes #when compiled with default settings #then accepted", () => {
    const nodes = Array.from({ length: 64 }, (_, index) => node(`n${String(index).padStart(3, "0")}`))

    expect(compileDag(definition(nodes), { at: AT }).ok).toBe(true)
  })

  it("#given a prompt over max_prompt_bytes #when compiled #then rejected naming the node", () => {
    const oversized = definition([node("a", [], { prompt: "x".repeat(262145) })])

    const result = compileDag(oversized, { at: AT })

    expect(result.ok).toBe(false)
    expect(result.errors.map((error) => error.code)).toEqual(["prompt_bytes_exceeded"])
    expect(result.errors[0]?.nodeIds).toEqual([nodeId("a")])
  })

  it("#given a multibyte prompt #when measured #then bytes are counted, not code units", () => {
    // given: 131073 two-byte characters = 262146 bytes but only 131073 code units
    const multibyte = definition([node("a", [], { prompt: "é".repeat(131073) })])

    expect(compileDag(multibyte, { at: AT }).ok).toBe(false)
    expect(compileDag(definition([node("a", [], { prompt: "é".repeat(131072) })]), { at: AT }).ok).toBe(true)
  })

  it("#given a dependsOn fan-out over max_nodes_per_run #when compiled #then rejected on fan-out", () => {
    // given: settings lowered so the fan-out bound trips before the node-count bound
    const upstream = Array.from({ length: 4 }, (_, index) => node(`u${index}`))
    const wide = definition([...upstream, node("join", ["u0", "u1", "u2", "u3"])])

    const result = compileDag(wide, { at: AT, settings: { max_nodes_per_run: 3 } })

    expect(result.ok).toBe(false)
    expect(result.errors.map((error) => error.code)).toContain("dependency_fanout_exceeded")
    expect(result.errors.find((error) => error.code === "dependency_fanout_exceeded")?.nodeIds).toEqual([nodeId("join")])
  })
})

describe("compileDag purity", () => {
  it("#given the same definition compiled twice #when serialized #then output is byte-identical", () => {
    const first = JSON.stringify(compileDag(diamond, { at: AT }))
    const second = JSON.stringify(compileDag(diamond, { at: AT }))

    expect(second).toBe(first)
  })
})

describe("compileDag empty definitions", () => {
  it("#given a definition with zero nodes #when compiled #then it fails with empty_graph instead of an instantly-complete run", () => {
    // when
    const result = compileDag(definition([]), { at: AT })

    // then
    expect(result.ok).toBe(false)
    expect(result.errors.map((error) => error.code)).toEqual(["empty_graph"])
  })
})
