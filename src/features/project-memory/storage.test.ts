import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import * as fs from "node:fs"
import * as path from "node:path"
import * as os from "node:os"

import {
  isProjectMemoryEnabled,
  readAllFacts,
  readFact,
  getFactStats,
  proposeFact,
  listProposals,
  approveProposal,
  rejectProposal,
} from "./storage"
import { getMemoryCompactionContext } from "./compaction"
import { getMemorySessionStartHint } from "./session-start-hint"
import { createProjectMemoryTools } from "./tools"

describe("project-memory", () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "omo-memory-test-"))
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  describe("#given no .omo/memory/ directory", () => {
    it("#then isProjectMemoryEnabled returns false", () => {
      expect(isProjectMemoryEnabled(tmpDir)).toBe(false)
    })

    it("#then getMemoryCompactionContext returns null", () => {
      expect(getMemoryCompactionContext(tmpDir)).toBeNull()
    })

    it("#then getMemorySessionStartHint returns null", () => {
      expect(getMemorySessionStartHint(tmpDir)).toBeNull()
    })
  })

  describe("#given .omo/memory/ exists but empty facts/", () => {
    beforeEach(() => {
      fs.mkdirSync(path.join(tmpDir, ".omo", "memory", "facts"), { recursive: true })
    })

    it("#then isProjectMemoryEnabled returns true", () => {
      expect(isProjectMemoryEnabled(tmpDir)).toBe(true)
    })

    it("#then readAllFacts returns empty array", () => {
      expect(readAllFacts(tmpDir)).toEqual([])
    })

    it("#then getMemorySessionStartHint returns null (no facts)", () => {
      expect(getMemorySessionStartHint(tmpDir)).toBeNull()
    })
  })

  describe("#given .omo/memory/facts/ has files", () => {
    beforeEach(() => {
      const factsDir = path.join(tmpDir, ".omo", "memory", "facts")
      fs.mkdirSync(factsDir, { recursive: true })
      fs.writeFileSync(path.join(factsDir, "architecture.md"), "# Architecture\n\nUses PostgreSQL.\n")
      fs.writeFileSync(path.join(factsDir, "pitfalls.md"), "# Pitfalls\n\nNever use bd edit.\n")
    })

    it("#then readAllFacts returns sorted files", () => {
      const facts = readAllFacts(tmpDir)
      expect(facts).toHaveLength(2)
      expect(facts[0].name).toBe("architecture")
      expect(facts[1].name).toBe("pitfalls")
    })

    it("#then readFact returns specific file content", () => {
      const content = readFact(tmpDir, "architecture")
      expect(content).toContain("Uses PostgreSQL")
    })

    it("#then readFact returns null for missing file", () => {
      expect(readFact(tmpDir, "nonexistent")).toBeNull()
    })

    it("#then getFactStats returns correct counts", () => {
      const stats = getFactStats(tmpDir)
      expect(stats.files).toBe(2)
      expect(stats.totalLines).toBeGreaterThan(0)
    })

    it("#then getMemoryCompactionContext includes all facts", () => {
      const ctx = getMemoryCompactionContext(tmpDir)
      expect(ctx).toContain("Uses PostgreSQL")
      expect(ctx).toContain("Never use bd edit")
      expect(ctx).toContain("Ledger Facts")
    })

    it("#then getMemorySessionStartHint reports file count", () => {
      const hint = getMemorySessionStartHint(tmpDir)
      expect(hint).toContain("2 facts file(s)")
      expect(hint).toContain("memory_facts")
    })
  })

  describe("#given proposal workflow", () => {
    beforeEach(() => {
      fs.mkdirSync(path.join(tmpDir, ".omo", "memory", "facts"), { recursive: true })
    })

    it("#when proposing a fact #then it creates a proposal file", () => {
      const proposal = proposeFact(tmpDir, {
        file: "architecture",
        content: "Database uses event sourcing",
        reason: "Verified during implementation",
      })

      expect(proposal.id).toBeTruthy()
      expect(proposal.file).toBe("architecture")
      expect(proposal.action).toBe("append")

      const proposals = listProposals(tmpDir)
      expect(proposals).toHaveLength(1)
      expect(proposals[0].id).toBe(proposal.id)
    })

    it("#when approving a proposal #then it writes to facts and removes proposal", () => {
      const proposal = proposeFact(tmpDir, {
        file: "invariants",
        content: "Never modify production data directly",
        reason: "Safety constraint",
        action: "create",
      })

      const result = approveProposal(tmpDir, proposal.id)
      expect(result.ok).toBe(true)

      const content = readFact(tmpDir, "invariants")
      expect(content).toContain("Never modify production data directly")

      const proposals = listProposals(tmpDir)
      expect(proposals).toHaveLength(0)
    })

    it("#when approving append to existing file #then it appends", () => {
      const factsDir = path.join(tmpDir, ".omo", "memory", "facts")
      fs.writeFileSync(path.join(factsDir, "rules.md"), "Rule 1\n")

      const proposal = proposeFact(tmpDir, {
        file: "rules",
        content: "Rule 2",
        reason: "New rule discovered",
        action: "append",
      })

      approveProposal(tmpDir, proposal.id)
      const content = readFact(tmpDir, "rules")
      expect(content).toContain("Rule 1")
      expect(content).toContain("Rule 2")
    })

    it("#when rejecting a proposal #then it removes without writing", () => {
      const proposal = proposeFact(tmpDir, {
        file: "architecture",
        content: "Speculative hypothesis",
        reason: "Just guessing",
      })

      const result = rejectProposal(tmpDir, proposal.id)
      expect(result.ok).toBe(true)

      expect(readFact(tmpDir, "architecture")).toBeNull()
      expect(listProposals(tmpDir)).toHaveLength(0)
    })

    it("#when approving nonexistent proposal #then returns error", () => {
      const result = approveProposal(tmpDir, "fake-id")
      expect(result.ok).toBe(false)
      expect(result.error).toContain("not found")
    })
  })

  describe("#given tools", () => {
    beforeEach(() => {
      const factsDir = path.join(tmpDir, ".omo", "memory", "facts")
      fs.mkdirSync(factsDir, { recursive: true })
      fs.writeFileSync(path.join(factsDir, "arch.md"), "Uses PostgreSQL\n")
    })

    it("#when calling memory_facts tool #then returns fact content", async () => {
      const tools = createProjectMemoryTools(tmpDir)
      const result = await tools.memory_facts.execute({ name: "arch" }, {})
      expect(result).toContain("Uses PostgreSQL")
    })

    it("#when calling memory_facts without name #then lists files", async () => {
      const tools = createProjectMemoryTools(tmpDir)
      const result = await tools.memory_facts.execute({}, {})
      expect(result).toContain("arch")
    })

    it("#when calling memory_propose_fact #then creates proposal", async () => {
      const tools = createProjectMemoryTools(tmpDir)
      const result = await tools.memory_propose_fact.execute(
        { file: "arch", content: "Also uses Redis", reason: "Confirmed" },
        {},
      )
      expect(result).toContain("Fact proposed")
      expect(listProposals(tmpDir)).toHaveLength(1)
    })

    it("#when calling memory_proposals #then lists pending", async () => {
      const tools = createProjectMemoryTools(tmpDir)
      proposeFact(tmpDir, { file: "test", content: "fact", reason: "reason" })
      const result = await tools.memory_proposals.execute({}, {})
      expect(result).toContain("Pending proposals (1)")
    })
  })
})
