import { describe, expect, it } from "bun:test"
import {
  DEFAULT_GRAPH_CONFIG,
  buildGraphParams,
  extractGraphData,
} from "./graph-memory"

describe("extractGraphData", () => {
  it("#given null input #when extracted #then returns null", () => {
    expect(extractGraphData(null)).toBeNull()
  })

  it("#given non-object input #when extracted #then returns null", () => {
    expect(extractGraphData("not-an-object")).toBeNull()
    expect(extractGraphData(42)).toBeNull()
    expect(extractGraphData(undefined)).toBeNull()
  })

  it("#given empty entities and relations #when extracted #then returns null", () => {
    expect(extractGraphData({ entities: [], relations: [] })).toBeNull()
    expect(extractGraphData({})).toBeNull()
  })

  it("#given valid entities and relations #when extracted #then parses correctly", () => {
    const raw = {
      entities: [
        { id: "e1", name: "Alice", type: "person" },
        { id: "e2", name: "Acme Corp", type: "organization" },
      ],
      relations: [
        {
          source: "Alice",
          target: "Acme Corp",
          relationship: "works_at",
          source_type: "person",
          target_type: "organization",
          score: 0.92,
        },
      ],
    }

    const result = extractGraphData(raw)

    expect(result).not.toBeNull()
    expect(result?.entities).toHaveLength(2)
    expect(result?.entities[0]).toEqual({ id: "e1", name: "Alice", type: "person" })
    expect(result?.entities[1]).toEqual({ id: "e2", name: "Acme Corp", type: "organization" })
    expect(result?.relations).toHaveLength(1)
    expect(result?.relations[0]).toEqual({
      source: "Alice",
      target: "Acme Corp",
      relationship: "works_at",
      source_type: "person",
      target_type: "organization",
      score: 0.92,
    })
  })

  it("#given partial entity missing fields #when extracted #then uses safe defaults", () => {
    const raw = { entities: [{ name: "Bob" }], relations: [] }
    const result = extractGraphData(raw)
    expect(result?.entities[0]).toEqual({ id: "Bob", name: "Bob", type: "unknown" })
  })

  it("#given relation without optional fields #when extracted #then omits undefined fields", () => {
    const raw = {
      entities: [],
      relations: [{ source: "X", target: "Y", relationship: "knows" }],
    }
    const result = extractGraphData(raw)
    expect(result?.relations[0].source).toBe("X")
    expect(result?.relations[0].target).toBe("Y")
    expect(result?.relations[0].relationship).toBe("knows")
    expect(result?.relations[0].source_type).toBeUndefined()
    expect(result?.relations[0].score).toBeUndefined()
  })
})

describe("buildGraphParams", () => {
  it("#given disabled config #when built #then returns empty object", () => {
    const params = buildGraphParams({ enabled: false, threshold: 0.7 })
    expect(params).toEqual({})
  })

  it("#given enabled config #when built #then returns enable_graph=true", () => {
    const params = buildGraphParams({ enabled: true, threshold: 0.7 })
    expect(params).toEqual({ enable_graph: true })
  })
})

describe("DEFAULT_GRAPH_CONFIG", () => {
  it("#given default config #when inspected #then enabled with threshold 0.7", () => {
    expect(DEFAULT_GRAPH_CONFIG.enabled).toBe(true)
    expect(DEFAULT_GRAPH_CONFIG.threshold).toBe(0.7)
  })
})
