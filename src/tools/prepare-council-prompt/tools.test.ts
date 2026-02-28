import { describe, expect, it, afterEach } from "bun:test"
import { createPrepareCouncilPromptTool } from "./tools"
import { readFile, rm, mkdtemp } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"

const mockContext = {
  sessionID: "test-session",
  messageID: "test-message",
  agent: "test-agent",
  abort: new AbortController().signal,
}

function extractFilePath(result: string): string {
  const match = result.match(/Council prompt saved to: (.+?) \(/)
  if (!match) throw new Error(`Could not extract file path from result: ${result}`)
  return match[1]
}

describe("createPrepareCouncilPromptTool", () => {
  let tmpDir: string

  afterEach(async () => {
    if (tmpDir) {
      await rm(tmpDir, { recursive: true, force: true })
    }
  })

  describe("#given a tool created with a temp directory", () => {
    describe("#when called with intent AUDIT", () => {
      it("#then produces file containing AUDIT addendum", async () => {
        tmpDir = await mkdtemp(join(tmpdir(), "council-test-"))
        const toolDef = createPrepareCouncilPromptTool(tmpDir)
        const result = await toolDef.execute({ prompt: "Analyze the auth module", intent: "AUDIT" }, mockContext)

        const filePath = extractFilePath(result)
        const content = await readFile(filePath, "utf-8")
        expect(content).toContain("## Analysis Intent: AUDIT")
      })
    })

    describe("#when called with intent EVALUATE", () => {
      it("#then produces file containing EVALUATE addendum", async () => {
        tmpDir = await mkdtemp(join(tmpdir(), "council-test-"))
        const toolDef = createPrepareCouncilPromptTool(tmpDir)
        const result = await toolDef.execute({ prompt: "Compare REST vs GraphQL", intent: "EVALUATE" }, mockContext)

        const filePath = extractFilePath(result)
        const content = await readFile(filePath, "utf-8")
        expect(content).toContain("## Analysis Intent: EVALUATE")
      })
    })

    describe("#when called with intent PLAN", () => {
      it("#then produces file containing PLAN addendum", async () => {
        tmpDir = await mkdtemp(join(tmpdir(), "council-test-"))
        const toolDef = createPrepareCouncilPromptTool(tmpDir)
        const result = await toolDef.execute({ prompt: "Plan the migration to v2", intent: "PLAN" }, mockContext)

        const filePath = extractFilePath(result)
        const content = await readFile(filePath, "utf-8")
        expect(content).toContain("## Analysis Intent: PLAN")
      })
    })

    describe("#when called with intent EXPLAIN", () => {
      it("#then produces file containing EXPLAIN addendum", async () => {
        tmpDir = await mkdtemp(join(tmpdir(), "council-test-"))
        const toolDef = createPrepareCouncilPromptTool(tmpDir)
        const result = await toolDef.execute({ prompt: "How does the event loop work?", intent: "EXPLAIN" }, mockContext)

        const filePath = extractFilePath(result)
        const content = await readFile(filePath, "utf-8")
        expect(content).toContain("## Analysis Intent: EXPLAIN")
      })
    })

    describe("#when called with intent DIAGNOSE", () => {
      it("#then produces file containing DIAGNOSE addendum", async () => {
        tmpDir = await mkdtemp(join(tmpdir(), "council-test-"))
        const toolDef = createPrepareCouncilPromptTool(tmpDir)
        const result = await toolDef.execute({ prompt: "Why is the API returning 500 errors?", intent: "DIAGNOSE" }, mockContext)

        const filePath = extractFilePath(result)
        const content = await readFile(filePath, "utf-8")
        expect(content).toContain("## Analysis Intent: DIAGNOSE")
      })
    })

    describe("#when called with intent CREATE", () => {
      it("#then produces file containing CREATE addendum", async () => {
        tmpDir = await mkdtemp(join(tmpdir(), "council-test-"))
        const toolDef = createPrepareCouncilPromptTool(tmpDir)
        const result = await toolDef.execute({ prompt: "Write a poem about TypeScript", intent: "CREATE" }, mockContext)

        const filePath = extractFilePath(result)
        const content = await readFile(filePath, "utf-8")
        expect(content).toContain("## Analysis Intent: CREATE")
      })
    })

    describe("#when called with intent PERSPECTIVES", () => {
      it("#then produces file containing PERSPECTIVES addendum", async () => {
        tmpDir = await mkdtemp(join(tmpdir(), "council-test-"))
        const toolDef = createPrepareCouncilPromptTool(tmpDir)
        const result = await toolDef.execute({ prompt: "What do you think about microservices?", intent: "PERSPECTIVES" }, mockContext)

        const filePath = extractFilePath(result)
        const content = await readFile(filePath, "utf-8")
        expect(content).toContain("## Analysis Intent: PERSPECTIVES")
      })
    })

    describe("#when called with intent FREEFORM", () => {
      it("#then produces file containing FREEFORM addendum", async () => {
        tmpDir = await mkdtemp(join(tmpdir(), "council-test-"))
        const toolDef = createPrepareCouncilPromptTool(tmpDir)
        const result = await toolDef.execute({ prompt: "Tell me something interesting", intent: "FREEFORM" }, mockContext)

        const filePath = extractFilePath(result)
        const content = await readFile(filePath, "utf-8")
        expect(content).toContain("## Analysis Intent: FREEFORM")
      })
    })

    describe("#when called without intent", () => {
      it("#then produces file without any intent addendum", async () => {
        tmpDir = await mkdtemp(join(tmpdir(), "council-test-"))
        const toolDef = createPrepareCouncilPromptTool(tmpDir)
        const result = await toolDef.execute({ prompt: "Review this module" }, mockContext)

        expect(result).toContain("intent: none")
        const filePath = extractFilePath(result)
        const content = await readFile(filePath, "utf-8")
        expect(content).not.toContain("## Analysis Intent:")
        expect(content).toContain("## Analysis Question")
      })
    })

    describe("#when called with an invalid intent", () => {
      it("#then returns an error message", async () => {
        tmpDir = await mkdtemp(join(tmpdir(), "council-test-"))
        const toolDef = createPrepareCouncilPromptTool(tmpDir)
        const result = await toolDef.execute({ prompt: "Compare options", intent: "COMPARISON" }, mockContext)

        expect(result).toContain("Invalid intent")
        expect(result).toContain("COMPARISON")
      })
    })

    describe("#when called with mode delegation and intent EVALUATE", () => {
      it("#then file contains both delegation and EVALUATE addendums", async () => {
        tmpDir = await mkdtemp(join(tmpdir(), "council-test-"))
        const toolDef = createPrepareCouncilPromptTool(tmpDir)
        const result = await toolDef.execute(
          { prompt: "Evaluate caching strategies", mode: "delegation", intent: "EVALUATE" },
          mockContext,
        )

        const filePath = extractFilePath(result)
        const content = await readFile(filePath, "utf-8")
        expect(content).toContain("## Delegation Mode")
        expect(content).toContain("## Analysis Intent: EVALUATE")
      })
    })

    describe("#when called with an empty prompt", () => {
      it("#then returns an error about empty prompt", async () => {
        tmpDir = await mkdtemp(join(tmpdir(), "council-test-"))
        const toolDef = createPrepareCouncilPromptTool(tmpDir)
        const result = await toolDef.execute({ prompt: "" }, mockContext)

        expect(result.toLowerCase()).toContain("empty")
      })
    })

    describe("#when checking file content order", () => {
      it("#then mode addendum appears before intent addendum which appears before the question", async () => {
        tmpDir = await mkdtemp(join(tmpdir(), "council-test-"))
        const toolDef = createPrepareCouncilPromptTool(tmpDir)
        const result = await toolDef.execute(
          { prompt: "What is the deployment pipeline?", mode: "solo", intent: "PLAN" },
          mockContext,
        )

        const filePath = extractFilePath(result)
        const content = await readFile(filePath, "utf-8")

        const modeIdx = content.indexOf("## Solo Analysis Mode")
        const intentIdx = content.indexOf("## Analysis Intent: PLAN")
        const questionIdx = content.indexOf("## Analysis Question")

        expect(modeIdx).toBeGreaterThanOrEqual(0)
        expect(intentIdx).toBeGreaterThanOrEqual(0)
        expect(questionIdx).toBeGreaterThanOrEqual(0)
        expect(modeIdx).toBeLessThan(intentIdx)
        expect(intentIdx).toBeLessThan(questionIdx)
      })
    })
  })
})
