import { describe, expect, test, beforeEach, afterEach } from "bun:test"
import { existsSync, mkdirSync, rmSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { LibraryIndexer, type DocFrontmatter } from "./indexer"

describe("LibraryIndexer", () => {
  const TEST_DIR = join(tmpdir(), "librarian-local-index-test-" + Date.now())
  const LIBRARY_DIR = join(TEST_DIR, "library")
  let indexer: LibraryIndexer

  beforeEach(() => {
    if (!existsSync(TEST_DIR)) {
      mkdirSync(TEST_DIR, { recursive: true })
    }
    indexer = new LibraryIndexer({ libraryPath: LIBRARY_DIR })
  })

  afterEach(() => {
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true, force: true })
    }
  })

  describe("buildIndex", () => {
    test("should create empty index when no docs exist", async () => {
      // #given - empty library directory
      // #when
      const index = await indexer.buildIndex()

      // #then
      expect(Object.keys(index.libraries)).toHaveLength(0)
      expect(Object.keys(index.tags)).toHaveLength(0)
      expect(index.lastBuilt).toBeDefined()
    })

    test("should create library directories on first build", async () => {
      // #given - no library directory exists
      // #when
      await indexer.buildIndex()

      // #then
      expect(existsSync(LIBRARY_DIR)).toBe(true)
      expect(existsSync(join(LIBRARY_DIR, "docs"))).toBe(true)
      expect(existsSync(join(LIBRARY_DIR, "patterns"))).toBe(true)
      expect(existsSync(join(LIBRARY_DIR, "scripts"))).toBe(true)
    })
  })

  describe("addLibraryDoc", () => {
    test("should add document with correct frontmatter", async () => {
      // #given - document content and frontmatter
      const content = "# useEffect Hook\n\nThe useEffect hook is used for side effects."
      const frontmatter: Partial<DocFrontmatter> = {
        title: "useEffect Hook",
        tags: ["hooks", "effects", "react"],
        contentType: "api",
        difficulty: "intermediate",
      }

      // #when
      await indexer.addLibraryDoc("react", content, frontmatter, "useEffect.md")

      // #then
      const docs = await indexer.getLibraryDocs("react")
      expect(docs).toHaveLength(1)
      expect(docs[0].frontmatter.title).toBe("useEffect Hook")
      expect(docs[0].frontmatter.tags).toContain("hooks")
      expect(docs[0].frontmatter.tags).toContain("effects")
      expect(docs[0].frontmatter.library).toBe("react")
      expect(docs[0].frontmatter.contentType).toBe("api")
    })

    test("should create library directory if it does not exist", async () => {
      // #given - no library directory
      const content = "# Test Doc"
      const frontmatter: Partial<DocFrontmatter> = {
        title: "Test",
        tags: ["test"],
        contentType: "reference",
      }

      // #when
      await indexer.addLibraryDoc("new-library", content, frontmatter)

      // #then
      expect(existsSync(join(LIBRARY_DIR, "docs", "new-library"))).toBe(true)
    })

    test("should include lastUpdated timestamp", async () => {
      // #given
      const content = "# Test"
      const frontmatter: Partial<DocFrontmatter> = {
        title: "Test",
        tags: [],
        contentType: "reference",
      }

      // #when
      await indexer.addLibraryDoc("test-lib", content, frontmatter)
      const docs = await indexer.getLibraryDocs("test-lib")

      // #then
      expect(docs[0].frontmatter.lastUpdated).toBeDefined()
      // Should be a valid ISO date string
      expect(new Date(docs[0].frontmatter.lastUpdated).toISOString()).toBe(
        docs[0].frontmatter.lastUpdated
      )
    })
  })

  describe("search", () => {
    test("should return empty results for empty index", async () => {
      // #given - empty library
      await indexer.buildIndex()

      // #when
      const results = await indexer.search("react hooks")

      // #then
      expect(results.totalCount).toBe(0)
      expect(results.results).toHaveLength(0)
    })

    test("should find documents by content", async () => {
      // #given - indexed document
      await indexer.addLibraryDoc(
        "react",
        "# useState\n\nThe useState hook is used for state management in React components.",
        {
          title: "useState Hook",
          tags: ["hooks", "state"],
          contentType: "api",
        }
      )

      // #when
      const results = await indexer.search("state management")

      // #then
      expect(results.totalCount).toBeGreaterThan(0)
      expect(results.results[0].library).toBe("react")
    })

    test("should return relevance scores", async () => {
      // #given - indexed document
      await indexer.addLibraryDoc(
        "react",
        "# Hooks\n\nReact hooks allow state and effects in functional components.",
        {
          title: "React Hooks",
          tags: ["hooks"],
          contentType: "guide",
        }
      )

      // #when
      const results = await indexer.search("hooks state effects")

      // #then
      expect(results.totalCount).toBeGreaterThan(0)
      expect(results.results[0].relevance).toBeGreaterThan(0)
      expect(results.results[0].relevance).toBeLessThanOrEqual(1)
    })
  })

  describe("queryByTags", () => {
    beforeEach(async () => {
      // Add some test documents
      await indexer.addLibraryDoc(
        "react",
        "# useEffect",
        {
          title: "useEffect",
          tags: ["hooks", "effects", "api"],
          contentType: "api",
        },
        "useEffect.md"
      )
      await indexer.addLibraryDoc(
        "react",
        "# useState",
        {
          title: "useState",
          tags: ["hooks", "state", "api"],
          contentType: "api",
        },
        "useState.md"
      )
      await indexer.addLibraryDoc(
        "vue",
        "# Composition API",
        {
          title: "Composition API",
          tags: ["api", "composition"],
          contentType: "guide",
        },
        "composition-api.md"
      )
    })

    test("should find documents with matching tags using OR", async () => {
      // #when
      const results = await indexer.queryByTags(["hooks", "composition"], "OR")

      // #then
      expect(results.totalCount).toBe(3)
      // All three docs have either 'hooks' or 'composition' tag
    })

    test("should find documents with all tags using AND", async () => {
      // #when
      const results = await indexer.queryByTags(["hooks", "api"], "AND")

      // #then
      expect(results.totalCount).toBe(2)
      // Only useEffect and useState have both 'hooks' AND 'api' tags
    })

    test("should return empty results for non-existent tags", async () => {
      // #when
      const results = await indexer.queryByTags(["nonexistent-tag"])

      // #then
      expect(results.totalCount).toBe(0)
    })

    test("should include frontmatter in results", async () => {
      // #when
      const results = await indexer.queryByTags(["hooks"])

      // #then
      expect(results.results[0].frontmatter).toBeDefined()
      expect(results.results[0].frontmatter.title).toBeDefined()
      expect(results.results[0].frontmatter.tags).toBeDefined()
    })
  })

  describe("getLibraryDocs", () => {
    test("should return empty array for non-existent library", async () => {
      // #when
      const docs = await indexer.getLibraryDocs("nonexistent")

      // #then
      expect(docs).toHaveLength(0)
    })

    test("should return all docs for a library", async () => {
      // #given
      await indexer.addLibraryDoc("mylib", "# Doc 1", {
        title: "Doc 1",
        tags: ["a"],
        contentType: "guide",
      }, "doc1.md")
      await indexer.addLibraryDoc("mylib", "# Doc 2", {
        title: "Doc 2",
        tags: ["b"],
        contentType: "api",
      }, "doc2.md")

      // #when
      const docs = await indexer.getLibraryDocs("mylib")

      // #then
      expect(docs).toHaveLength(2)
    })
  })

  describe("createTagQueryScript", () => {
    test("should create query script file", async () => {
      // #given - library initialized
      await indexer.buildIndex()

      // #when
      await indexer.createTagQueryScript()

      // #then
      const scriptPath = join(LIBRARY_DIR, "scripts", "query-by-tags.js")
      expect(existsSync(scriptPath)).toBe(true)

      const content = readFileSync(scriptPath, "utf-8")
      expect(content).toContain("#!/usr/bin/env node")
      expect(content).toContain("queryByTags")
    })
  })
})

describe("HtmlToMarkdownConverter", () => {
  const { HtmlToMarkdownConverter } = require("./html-converter")
  let converter: InstanceType<typeof HtmlToMarkdownConverter>

  beforeEach(() => {
    converter = new HtmlToMarkdownConverter()
  })

  test("should convert basic HTML to markdown", () => {
    // #given
    const html = "<h1>Title</h1><p>Paragraph text</p>"

    // #when
    const markdown = converter.convert(html)

    // #then
    expect(markdown).toContain("# Title")
    expect(markdown).toContain("Paragraph text")
  })

  test("should convert code blocks with language hints", () => {
    // #given
    const html = '<pre><code class="language-typescript">const x = 1;</code></pre>'

    // #when
    const markdown = converter.convert(html)

    // #then
    expect(markdown).toContain("```typescript")
    expect(markdown).toContain("const x = 1;")
    expect(markdown).toContain("```")
  })

  test("should handle empty input", () => {
    // #when
    const markdown = converter.convert("")

    // #then
    expect(markdown).toBe("")
  })
})

describe("ContentExtractor", () => {
  const { extractMainContent, extractTagsFromUrl, inferContentType } = require("./content-extractor")

  describe("extractMainContent", () => {
    test("should extract title from h1", () => {
      // #given
      const html = "<html><body><h1>My Title</h1><p>Content</p></body></html>"

      // #when
      const result = extractMainContent(html)

      // #then
      expect(result.title).toBe("My Title")
    })

    test("should extract title from title tag as fallback", () => {
      // #given
      const html = "<html><head><title>Page Title | Site</title></head><body><p>Content</p></body></html>"

      // #when
      const result = extractMainContent(html)

      // #then
      expect(result.title).toBe("Page Title")
    })

    test("should extract meta description", () => {
      // #given
      const html = '<html><head><meta name="description" content="This is a description"></head><body></body></html>'

      // #when
      const result = extractMainContent(html)

      // #then
      expect(result.description).toBe("This is a description")
    })
  })

  describe("extractTagsFromUrl", () => {
    test("should extract api tag from URL", () => {
      // #when
      const tags = extractTagsFromUrl("https://react.dev/reference/react/api")

      // #then
      expect(tags).toContain("api")
    })

    test("should extract guide tag from URL", () => {
      // #when
      const tags = extractTagsFromUrl("https://example.com/docs/guide/getting-started")

      // #then
      expect(tags).toContain("guide")
      expect(tags).toContain("getting-started")
    })

    test("should extract framework from host", () => {
      // #when
      const tags = extractTagsFromUrl("https://react.dev/learn/hooks")

      // #then
      expect(tags).toContain("react")
    })
  })

  describe("inferContentType", () => {
    test("should infer api type from URL", () => {
      // #when
      const type = inferContentType("https://example.com/api/reference", "")

      // #then
      expect(type).toBe("api")
    })

    test("should infer tutorial type from content", () => {
      // #when
      const type = inferContentType(
        "https://docs.test.com/intro",
        "Step 1: Install the package. Step 2: Configure..."
      )

      // #then
      expect(type).toBe("tutorial")
    })

    test("should default to reference", () => {
      // #when
      const type = inferContentType("https://docs.test.com/random", "Some generic content")

      // #then
      expect(type).toBe("reference")
    })
  })
})
