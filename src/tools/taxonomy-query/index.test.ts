import { describe, expect, test, beforeEach } from "bun:test"
import { TaxonomyStore } from "../../agents/coeus/taxonomy/storage"
import type { TaxonomyEntry } from "../../agents/coeus/taxonomy/schema"
import { createTaxonomySearchTool } from "./tools"

describe("taxonomy-query tool", () => {
  let store: TaxonomyStore

  beforeEach(() => {
    store = new TaxonomyStore()
  })

  test("search for existing category returns found=true with entry", () => {
    //#given
    const entry: TaxonomyEntry = {
      category: "Authentication",
      solutions: [
        {
          name: "JWT",
          description: "JSON Web Tokens for stateless auth",
          sources: [
            {
              ref: "RFC 7519",
              claim: "Standard for JWT",
              tier: "tier-1-ground-truth",
              confidence: 1.0,
              type: "spec",
              url: "https://tools.ietf.org/html/rfc7519",
            },
          ],
        },
      ],
      related: ["Authorization", "Session Management"],
    }
    store.addEntry(entry)
    const tool = createTaxonomySearchTool(store)

    //#when
    const result = tool.execute({ category: "Authentication" })

    //#then
    expect(result).toContain("Category: Authentication")
    expect(result).toContain("JWT")
    expect(result).toContain("JSON Web Tokens for stateless auth")
    expect(result).toContain("RFC 7519")
  })

  test("search for non-existent category returns not found", () => {
    //#given
    const tool = createTaxonomySearchTool(store)

    //#when
    const result = tool.execute({ category: "NonExistent" })

    //#then
    expect(result).toContain("not found")
    expect(result).toContain("NonExistent")
  })

  test("search with include_related=true returns related entries", () => {
    //#given
    const authEntry: TaxonomyEntry = {
      category: "Authentication",
      solutions: [
        {
          name: "JWT",
          description: "JSON Web Tokens",
          sources: [
            {
              ref: "RFC 7519",
              claim: "JWT spec",
              tier: "tier-1-ground-truth",
              confidence: 1.0,
              type: "spec",
            },
          ],
        },
      ],
      related: ["Authorization"],
    }
    const authzEntry: TaxonomyEntry = {
      category: "Authorization",
      solutions: [
        {
          name: "RBAC",
          description: "Role-Based Access Control",
          sources: [
            {
              ref: "NIST RBAC",
              claim: "RBAC standard",
              tier: "tier-2-validated-reference",
              confidence: 0.95,
              type: "spec",
            },
          ],
        },
      ],
      related: [],
    }
    store.addEntry(authEntry)
    store.addEntry(authzEntry)
    const tool = createTaxonomySearchTool(store)

    //#when
    const result = tool.execute({ category: "Authentication", include_related: true })

    //#then
    expect(result).toContain("Category: Authentication")
    expect(result).toContain("JWT")
    expect(result).toContain("Related Categories:")
    expect(result).toContain("Authorization")
    expect(result).toContain("RBAC")
  })

  test("search with include_related=false excludes related entries", () => {
    //#given
    const authEntry: TaxonomyEntry = {
      category: "Authentication",
      solutions: [
        {
          name: "JWT",
          description: "JSON Web Tokens",
          sources: [
            {
              ref: "RFC 7519",
              claim: "JWT spec",
              tier: "tier-1-ground-truth",
              confidence: 1.0,
              type: "spec",
            },
          ],
        },
      ],
      related: ["Authorization"],
    }
    const authzEntry: TaxonomyEntry = {
      category: "Authorization",
      solutions: [
        {
          name: "RBAC",
          description: "Role-Based Access Control",
          sources: [
            {
              ref: "NIST RBAC",
              claim: "RBAC standard",
              tier: "tier-2-validated-reference",
              confidence: 0.95,
              type: "spec",
            },
          ],
        },
      ],
      related: [],
    }
    store.addEntry(authEntry)
    store.addEntry(authzEntry)
    const tool = createTaxonomySearchTool(store)

    //#when
    const result = tool.execute({ category: "Authentication", include_related: false })

    //#then
    expect(result).toContain("Category: Authentication")
    expect(result).toContain("JWT")
    expect(result).not.toContain("Related Categories:")
    expect(result).not.toContain("RBAC")
  })

  test("output includes solution names and source references", () => {
    //#given
    const entry: TaxonomyEntry = {
      category: "Caching",
      solutions: [
        {
          name: "Redis",
          description: "In-memory data structure store",
          sources: [
            {
              ref: "Redis Documentation",
              claim: "Official Redis docs",
              tier: "tier-2-validated-reference",
              confidence: 0.9,
              type: "docs",
              url: "https://redis.io/docs",
            },
          ],
        },
        {
          name: "Memcached",
          description: "Distributed memory caching system",
          sources: [
            {
              ref: "Memcached Wiki",
              claim: "Memcached reference",
              tier: "tier-3-battle-tested",
              confidence: 0.85,
              type: "docs",
            },
          ],
        },
      ],
      related: [],
    }
    store.addEntry(entry)
    const tool = createTaxonomySearchTool(store)

    //#when
    const result = tool.execute({ category: "Caching" })

    //#then
    expect(result).toContain("Redis")
    expect(result).toContain("In-memory data structure store")
    expect(result).toContain("Redis Documentation")
    expect(result).toContain("Memcached")
    expect(result).toContain("Distributed memory caching system")
    expect(result).toContain("Memcached Wiki")
  })

  test("tool factory creates callable tool", () => {
    //#given
    const entry: TaxonomyEntry = {
      category: "Testing",
      solutions: [
        {
          name: "Jest",
          description: "JavaScript testing framework",
          sources: [
            {
              ref: "Jest Docs",
              claim: "Official docs",
              tier: "tier-2-validated-reference",
              confidence: 0.9,
              type: "docs",
            },
          ],
        },
      ],
      related: [],
    }
    store.addEntry(entry)

    //#when
    const tool = createTaxonomySearchTool(store)

    //#then
    expect(tool).toBeDefined()
    expect(tool.execute).toBeDefined()
    expect(typeof tool.execute).toBe("function")
  })

  test("output includes complexity when present", () => {
    //#given
    const entry: TaxonomyEntry = {
      category: "Distributed Systems",
      solutions: [
        {
          name: "Raft Consensus",
          description: "Consensus algorithm for distributed systems",
          sources: [
            {
              ref: "Raft Paper",
              claim: "Original Raft paper",
              tier: "tier-1-ground-truth",
              confidence: 1.0,
              type: "paper",
            },
          ],
        },
      ],
      complexity: "High - requires understanding of distributed consensus",
      related: [],
    }
    store.addEntry(entry)
    const tool = createTaxonomySearchTool(store)

    //#when
    const result = tool.execute({ category: "Distributed Systems" })

    //#then
    expect(result).toContain("Complexity:")
    expect(result).toContain("High - requires understanding of distributed consensus")
  })
})
