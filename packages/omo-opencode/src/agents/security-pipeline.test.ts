import { describe, expect, test } from "bun:test"
import {
  createSecurityDeduperAgent,
  createSecurityOrchestratorAgent,
  createSecurityProverAgent,
  createSecurityReconAgent,
  createSecurityScannerAgent,
  createSecurityValidatorAgent,
  securityDeduperPromptMetadata,
  securityOrchestratorPromptMetadata,
  securityProverPromptMetadata,
  securityReconPromptMetadata,
  securityScannerPromptMetadata,
  securityValidatorPromptMetadata,
} from "./security-pipeline"

const TEST_MODEL = "openai/gpt-5.5"

describe("security pipeline agents", () => {
  test("all stage agents are subagents with authorized-scope guardrails", () => {
    const agents = [
      createSecurityOrchestratorAgent(TEST_MODEL),
      createSecurityReconAgent(TEST_MODEL),
      createSecurityScannerAgent(TEST_MODEL),
      createSecurityValidatorAgent(TEST_MODEL),
      createSecurityDeduperAgent(TEST_MODEL),
      createSecurityProverAgent(TEST_MODEL),
    ]

    for (const agent of agents) {
      expect(agent.mode).toBe("subagent")
      expect(agent.prompt).toContain("Authorized Security Scope")
      expect(agent.prompt).toContain("explicitly says are authorized")
      expect(agent.prompt).toContain("<security_result>")
    }
  })

  test("orchestrator prompt names the five pipeline handoff stages", () => {
    const agent = createSecurityOrchestratorAgent(TEST_MODEL)

    expect(agent.prompt).toContain("security-recon maps assets")
    expect(agent.prompt).toContain("security-scanner produces vulnerability hypotheses")
    expect(agent.prompt).toContain("security-validator challenges each hypothesis")
    expect(agent.prompt).toContain("security-deduper collapses duplicate findings")
    expect(agent.prompt).toContain("security-prover designs the smallest safe proof plan")
  })

  test("prover can write new PoC artifacts but cannot edit source or delegate further", () => {
    const agent = createSecurityProverAgent(TEST_MODEL)
    const permission = agent.permission as Record<string, string>

    expect(permission.write).toBeUndefined()
    expect(permission.edit).toBe("deny")
    expect(permission.apply_patch).toBe("deny")
    expect(permission.task).toBe("deny")
    expect(agent.prompt).toContain("write PoC scripts only under /tmp or a caller-approved evidence directory")
  })

  test("read-only stages deny writes and further delegation", () => {
    const readOnlyAgents = [
      createSecurityReconAgent(TEST_MODEL),
      createSecurityScannerAgent(TEST_MODEL),
      createSecurityValidatorAgent(TEST_MODEL),
      createSecurityDeduperAgent(TEST_MODEL),
    ]

    for (const agent of readOnlyAgents) {
      const permission = agent.permission as Record<string, string>
      expect(permission.write).toBe("deny")
      expect(permission.edit).toBe("deny")
      expect(permission.apply_patch).toBe("deny")
      expect(permission.task).toBe("deny")
      expect(permission.call_omo_agent).toBe("deny")
    }
  })

  test("metadata exposes the pipeline roles to Sisyphus delegation tables", () => {
    const metadata = [
      securityOrchestratorPromptMetadata,
      securityReconPromptMetadata,
      securityScannerPromptMetadata,
      securityValidatorPromptMetadata,
      securityDeduperPromptMetadata,
      securityProverPromptMetadata,
    ]

    expect(metadata.map((entry) => entry.promptAlias)).toEqual([
      "Security Orchestrator",
      "Security Recon",
      "Security Scanner",
      "Security Validator",
      "Security Deduper",
      "Security Prover",
    ])
    expect(metadata.every((entry) => entry.keyTrigger?.includes("security"))).toBe(true)
  })
})
