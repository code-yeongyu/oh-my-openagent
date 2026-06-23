import { describe, expect, it, mock, beforeEach } from "bun:test"
import { VespaL3Provider } from "./vespa-provider"
import { PageIndexAdapter } from "./pageindex-adapter"
import { L3Router, classifyQuery } from "./l3-router"
import { searchWithDegradation } from "./degradation"
import type { L3Provider, L3RetrievalResult } from "./types"

function mockFetch(fn: (...args: unknown[]) => Promise<Response | never>): void {
  globalThis.fetch = fn as unknown as typeof globalThis.fetch
}

function createMockProvider(overrides: Partial<L3Provider> = {}): L3Provider {
  return {
    providerName: "mock",
    capabilities: {
      hybrid_search: false,
      reranking: false,
      long_document_reasoning: false,
      batch_search: false,
    },
    isAvailable: mock(() => Promise.resolve(true)),
    search: mock(() => Promise.resolve([])),
    getDocument: mock(() => Promise.resolve(undefined)),
    ...overrides,
  }
}

const MOCK_RESULT: L3RetrievalResult = {
  chunk_id: "chunk-1",
  source_document: "test.pdf",
  content: "Some content",
  score: 0.9,
  retrieved_at: new Date().toISOString(),
}

describe("VespaL3Provider", () => {
  describe("#given a VespaL3Provider", () => {
    describe("#when Vespa health returns non-up status", () => {
      it("#then isAvailable returns false", async () => {
        const fetchMock = mock(() =>
          Promise.resolve(new Response(JSON.stringify({ status: { code: "down" } }), { status: 200 })),
        )
        mockFetch(fetchMock)
        const provider = new VespaL3Provider({
          vespaConfig: { baseUrl: "http://localhost:8080" },
        })
        const available = await provider.isAvailable()
        expect(available).toBe(false)
      })
    })

    describe("#when Vespa search returns hits", () => {
      it("#then returns mapped L3RetrievalResult array", async () => {
        const fetchMock = mock(() =>
          Promise.resolve(
            new Response(
              JSON.stringify({
                root: {
                  fields: { totalCount: 1 },
                  children: [
                    {
                      id: "doc-1",
                      relevance: 0.85,
                      fields: {
                        source_file: "paper.pdf",
                        chunk_text: "Neural networks are powerful",
                      },
                    },
                  ],
                },
              }),
              { status: 200 },
            ),
          ),
        )
        mockFetch(fetchMock)
        const provider = new VespaL3Provider({
          vespaConfig: { baseUrl: "http://localhost:8080" },
        })
        const results = await provider.search("neural networks", 5)
        expect(results).toHaveLength(1)
        expect(results[0].chunk_id).toBe("doc-1")
        expect(results[0].source_document).toBe("paper.pdf")
        expect(results[0].content).toBe("Neural networks are powerful")
        expect(results[0].score).toBe(0.85)
        expect(results[0].embedding_model).toBe("gemini-embedding-001")
      })
    })

    describe("#when Vespa returns an error", () => {
      it("#then search returns empty array gracefully", async () => {
        const fetchMock = mock(() =>
          Promise.resolve(new Response("Server Error", { status: 500 })),
        )
        mockFetch(fetchMock)
        const provider = new VespaL3Provider({
          vespaConfig: { baseUrl: "http://localhost:8080" },
        })
        const results = await provider.search("test query")
        expect(results).toEqual([])
      })
    })
  })
})

describe("PageIndexAdapter", () => {
  describe("#given a PageIndexAdapter", () => {
    describe("#when health endpoint fails", () => {
      it("#then isAvailable returns false", async () => {
        const fetchMock = mock(() =>
          Promise.resolve(new Response("Not Found", { status: 404 })),
        )
        mockFetch(fetchMock)
        const adapter = new PageIndexAdapter({ baseUrl: "http://localhost:9090" })
        const available = await adapter.isAvailable()
        expect(available).toBe(false)
      })
    })

    describe("#when PageIndex is down", () => {
      it("#then search returns empty array", async () => {
        const fetchMock = mock(() => Promise.reject(new Error("ECONNREFUSED")))
        mockFetch(fetchMock)
        const adapter = new PageIndexAdapter({ baseUrl: "http://localhost:9090" })
        const results = await adapter.search("test query")
        expect(results).toEqual([])
      })
    })
  })
})

describe("L3Router", () => {
  describe("#given classifyQuery", () => {
    describe("#when query contains reasoning keywords", () => {
      it("#then returns 'reasoning'", () => {
        expect(classifyQuery("why does X happen")).toBe("reasoning")
        expect(classifyQuery("explain the algorithm")).toBe("reasoning")
        expect(classifyQuery("how does caching work")).toBe("reasoning")
      })
    })

    describe("#when query is a plain factual search", () => {
      it("#then returns 'factual'", () => {
        expect(classifyQuery("search for X in papers")).toBe("factual")
        expect(classifyQuery("find typescript config")).toBe("factual")
      })
    })

    describe("#when query references a specific document", () => {
      it("#then returns 'document'", () => {
        expect(classifyQuery("in this paper X says Y")).toBe("document")
        expect(classifyQuery("according to the document, what is Z")).toBe("document")
        expect(classifyQuery("in chapter 3, the authors say")).toBe("document")
      })
    })
  })

  describe("#given an L3Router with both providers", () => {
    let vespa: L3Provider
    let pageIndex: L3Provider

    beforeEach(() => {
      vespa = createMockProvider({
        providerName: "vespa",
        isAvailable: mock(() => Promise.resolve(true)),
        search: mock(() => Promise.resolve([{ ...MOCK_RESULT, chunk_id: "vespa-1" }])),
      })
      pageIndex = createMockProvider({
        providerName: "pageindex",
        capabilities: { hybrid_search: false, reranking: false, long_document_reasoning: true, batch_search: false },
        isAvailable: mock(() => Promise.resolve(true)),
        search: mock(() => Promise.resolve([{ ...MOCK_RESULT, chunk_id: "pi-1" }])),
      })
    })

    describe("#when query is reasoning and PageIndex is available", () => {
      it("#then routes to PageIndex", async () => {
        const router = new L3Router({ vespaProvider: vespa, pageIndexProvider: pageIndex })
        const results = await router.search("why does caching improve performance")
        expect(results[0].chunk_id).toBe("pi-1")
        expect(pageIndex.search).toHaveBeenCalled()
      })
    })

    describe("#when query is factual", () => {
      it("#then routes to Vespa", async () => {
        const router = new L3Router({ vespaProvider: vespa, pageIndexProvider: pageIndex })
        const results = await router.search("typescript generics")
        expect(results[0].chunk_id).toBe("vespa-1")
        expect(vespa.search).toHaveBeenCalled()
      })
    })
  })
})

describe("searchWithDegradation", () => {
  describe("#given a router with no available providers", () => {
    describe("#when searching", () => {
      it("#then returns degraded: true", async () => {
        const vespa = createMockProvider({ isAvailable: mock(() => Promise.resolve(false)) })
        const pageIndex = createMockProvider({ isAvailable: mock(() => Promise.resolve(false)) })
        const router = new L3Router({ vespaProvider: vespa, pageIndexProvider: pageIndex })
        const result = await searchWithDegradation(router, "test query")
        expect(result.degraded).toBe(true)
        expect(result.results).toEqual([])
        expect(result.reason).toContain("unavailable")
      })
    })
  })

  describe("#given a router with available providers", () => {
    describe("#when searching", () => {
      it("#then returns results with degraded: false", async () => {
        const vespa = createMockProvider({
          isAvailable: mock(() => Promise.resolve(true)),
          search: mock(() => Promise.resolve([MOCK_RESULT])),
        })
        const pageIndex = createMockProvider({ isAvailable: mock(() => Promise.resolve(false)) })
        const router = new L3Router({ vespaProvider: vespa, pageIndexProvider: pageIndex })
        const result = await searchWithDegradation(router, "test query")
        expect(result.degraded).toBe(false)
        expect(result.results).toHaveLength(1)
        expect(result.results[0].chunk_id).toBe("chunk-1")
      })
    })
  })
})
