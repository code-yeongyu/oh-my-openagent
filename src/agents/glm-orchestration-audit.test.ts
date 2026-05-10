/// <reference types="bun-types" />

import { describe, expect, it } from "bun:test"
import { buildGlmSisyphusPrompt } from "./sisyphus/glm"
import { buildDynamicSisyphusPrompt } from "./sisyphus"
import { estimateTokenCount } from "../tools/delegate-task/token-limiter"
import type {
  AvailableAgent,
  AvailableCategory,
  AvailableSkill,
  AvailableTool,
} from "./dynamic-agent-prompt-builder"

const GLM_MODEL = "zai/glm-5.1"
const VANILLA_MODEL = "claude-sonnet-4-20250514"

const AUDIT_AGENTS: AvailableAgent[] = [
  {
    name: "oracle",
    description: "Read-only high-IQ consultant for architecture and debugging",
    metadata: {
      category: "advisor",
      cost: "EXPENSIVE",
      promptAlias: "Oracle",
      triggers: [],
      useWhen: ["Architecture uncertainty", "Debugging after repeated failures"],
      avoidWhen: ["Trivial local edits"],
    },
  },
  {
    name: "explore",
    description: "Parallel codebase exploration agent",
    metadata: {
      category: "exploration",
      cost: "CHEAP",
      promptAlias: "Explore",
      triggers: [{ domain: "Code search", trigger: "Find patterns and references" }],
    },
  },
  {
    name: "librarian",
    description: "External documentation research agent",
    metadata: {
      category: "exploration",
      cost: "CHEAP",
      promptAlias: "Librarian",
      triggers: [{ domain: "Documentation", trigger: "Current library docs" }],
    },
  },
]

const AUDIT_TOOLS: AvailableTool[] = [
  { name: "task", category: "other" },
  { name: "background_output", category: "other" },
  { name: "lsp_diagnostics", category: "lsp" },
  { name: "apply_patch", category: "command" },
]

const AUDIT_SKILLS: AvailableSkill[] = [
  {
    name: "frontend-ui-ux",
    description: "UI implementation and visual quality guidance",
    location: "plugin",
  },
  {
    name: "backend-development",
    description: "Backend API and database architecture guidance",
    location: "user",
  },
]

const AUDIT_CATEGORIES: AvailableCategory[] = [
  { name: "deep", description: "Complex implementation worker" },
  { name: "unspecified-high", description: "High-effort fallback worker" },
  { name: "visual-engineering", description: "UI and screenshot verification worker" },
]

const glmPrompt = buildGlmSisyphusPrompt(
  GLM_MODEL,
  AUDIT_AGENTS,
  [],
  AUDIT_SKILLS,
  AUDIT_CATEGORIES,
  false,
)
const vanillaPrompt = buildDynamicSisyphusPrompt(
  VANILLA_MODEL,
  AUDIT_AGENTS,
  AUDIT_TOOLS,
  AUDIT_SKILLS,
  AUDIT_CATEGORIES,
)

const structuralBlocks = [
  "<identity>",
  "<intent>",
  "<explore>",
  "<delegation>",
  "<constraints>",
  "<style>",
  "<execution_loop>",
  "<Anti_Duplication>",
  "<Small_Context_Working_Memory>",
  "<Oracle_Usage>",
  "<token_economy>",
]

const selfImplementationBarriers = [
  /never implement/i,
  /You never start implementing/i,
  /NEVER implement directly/,
  /ALWAYS decompose/,
  /ALWAYS delegate/,
  /You write prompts, not code/,
  /delegate to Hephaestus via `task\(category="deep"/,
  /Your value is orchestration/,
  /Long\/complex or 3\+ sequential self-edits.*delegate/s,
]

const delegationQualityItems = [
  /category\+skills delegation/,
  /load_skills/,
  /TASK:/,
  /EXPECTED OUTCOME:/,
  /REQUIRED TOOLS:/,
  /MUST DO:/,
  /MUST NOT DO:/,
  /CONTEXT:/,
  /domain-specific categories/,
]

const executionFlowItems = [
  /1\. DISPATCH/,
  /2\. DELEGATE/,
  /3\. COLLECT/,
  /4\. SYNTHESIZE/,
  /5\. DONE/,
  /Wait for background completion notification before `background_output`/,
  /Continue the same task session for fixes/,
  /V1[\s\S]*V2[\s\S]*V3/,
]

const antiPatternItems = [
  /as any[\s\S]*@ts-ignore/,
  /Empty catch blocks|catch\(e\) \{\}/,
  /Deleting failing tests|delete failing tests/i,
  /Never commit unless explicitly requested|Commit without explicit request/i,
  /background_cancel\(all=true\)/,
  /Delivering (?:final )?answer (?:before collecting|without collecting) Oracle/i,
  /Polling `background_output` on running tasks|Do NOT poll `background_output` on a running Oracle/,
  /Delegation Duplication|same search yourself/i,
  /Shotgun debugging/i,
]

function countStrings(prompt: string, items: string[]): number {
  return items.filter((item) => prompt.includes(item)).length
}

function countPatterns(prompt: string, items: RegExp[]): number {
  return items.filter((item) => item.test(prompt)).length
}

function percent(count: number, total: number): number {
  return Math.round((count / total) * 100)
}

function ratio(count: number, total: number): string {
  return `${count}/${total} (${percent(count, total)}%)`
}

function delegationSectionLength(prompt: string): number {
  const xmlSection = prompt.match(/<delegation>[\s\S]*?<\/delegation>/)
  if (xmlSection) return xmlSection[0].length

  const fallback = prompt.match(/## Phase 2B - Planning & Delegation[\s\S]*?### Code Changes:/)
  return fallback?.[0].length ?? 0
}

describe("GLM orchestration audit: structural block coverage", () => {
  describe("#given GLM Sisyphus prompt", () => {
    describe("#when required XML blocks are counted", () => {
      it("#then every orchestration block is present", () => {
        const glmCount = countStrings(glmPrompt, structuralBlocks)

        expect(glmCount).toBe(structuralBlocks.length)
        expect(glmPrompt).toContain("<GLM_VISION_CONSTRAINT>")
      })
    })
  })
})

describe("GLM orchestration audit: self-implementation barrier count", () => {
  describe("#given GLM Sisyphus prompt", () => {
    describe("#when implementation barriers are counted", () => {
      it("#then GLM explicitly blocks non-trivial solo implementation", () => {
        const glmCount = countPatterns(glmPrompt, selfImplementationBarriers)

        expect(glmCount).toBe(selfImplementationBarriers.length)
      })
    })
  })
})

describe("GLM orchestration audit: delegation prompt quality", () => {
  describe("#given GLM Sisyphus prompt", () => {
    describe("#when delegation fields are audited", () => {
      it("#then GLM requires category+skills delegation with complete prompt fields", () => {
        const glmCount = countPatterns(glmPrompt, delegationQualityItems)

        expect(glmCount).toBe(delegationQualityItems.length)
      })
    })
  })
})

describe("GLM orchestration audit: execution flow enforcement", () => {
  describe("#given GLM Sisyphus prompt", () => {
    describe("#when flow-control rules are audited", () => {
      it("#then GLM enforces dispatch through done", () => {
        const glmCount = countPatterns(glmPrompt, executionFlowItems)

        expect(glmCount).toBe(executionFlowItems.length)
      })
    })
  })
})

describe("GLM orchestration audit: anti-pattern coverage", () => {
  describe("#given GLM Sisyphus prompt", () => {
    describe("#when blocking anti-patterns are audited", () => {
      it("#then GLM names every blocker", () => {
        const glmCount = countPatterns(glmPrompt, antiPatternItems)

        expect(glmCount).toBe(antiPatternItems.length)
      })
    })
  })
})

describe("GLM orchestration audit: token efficiency", () => {
  describe("#given GLM and vanilla Sisyphus prompts", () => {
    describe("#when token counts are compared", () => {
      it("#then GLM remains shorter as cross-referenced by token economy tests", () => {
        const glmDelegationPercent = delegationSectionLength(glmPrompt) / glmPrompt.length

        expect(estimateTokenCount(glmPrompt)).toBeLessThan(estimateTokenCount(vanillaPrompt))
        expect(glmDelegationPercent).toBeGreaterThan(0)
        expect(glmDelegationPercent).toBeLessThan(0.5)
      })
    })
  })
})

describe("GLM orchestration audit: comparison report", () => {
  describe("#given completed audit metrics", () => {
    describe("#when summary is generated", () => {
      it("#then comparison table is readable", () => {
        const glmStructural = countStrings(glmPrompt, structuralBlocks)
        const glmBarriers = countPatterns(glmPrompt, selfImplementationBarriers)
        const glmDelegation = countPatterns(glmPrompt, delegationQualityItems)
        const glmFlow = countPatterns(glmPrompt, executionFlowItems)
        const glmAntiPatterns = countPatterns(glmPrompt, antiPatternItems)
        const glmTokens = estimateTokenCount(glmPrompt)
        const vanillaTokens = estimateTokenCount(vanillaPrompt)
        const rows = [
          ["Structural Block Coverage", ratio(glmStructural, structuralBlocks.length)],
          ["Self-Implementation Barriers", ratio(glmBarriers, selfImplementationBarriers.length)],
          ["Delegation Prompt Quality", ratio(glmDelegation, delegationQualityItems.length)],
          ["Execution Flow Enforcement", ratio(glmFlow, executionFlowItems.length)],
          ["Anti-Pattern Coverage", ratio(glmAntiPatterns, antiPatternItems.length)],
          ["Token Efficiency", `${glmTokens} GLM tokens < ${vanillaTokens} vanilla tokens`],
        ]
        const table = [
          "| Metric | GLM-5.1 Audit |",
          "|---|---|",
          ...rows.map(([metric, value]) => `| ${metric} | ${value} |`),
        ].join("\n")

        expect(table).toContain("Structural Block Coverage")
        expect(table).toContain("Token Efficiency")
      })
    })
  })
})
