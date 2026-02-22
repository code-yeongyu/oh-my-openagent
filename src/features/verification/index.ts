import { CriticVerifier, type Strictness } from "../../shared/critic-verifier"

export interface VerificationStage {
  name: string
  passed: boolean
  details: string
}

export interface VerificationInput {
  taskOutput: string
  strictness?: Strictness
}

export interface VerificationResult {
  passed: boolean
  stages: VerificationStage[]
  report: string
}

function buildReport(stages: VerificationStage[]): string {
  const stageLines = stages.map((stage, index) => {
    const marker = stage.passed ? "✅" : "❌"
    return `Stage ${index + 1} ${marker} ${stage.name}: ${stage.details}`
  })

  return `## Multi-Stage Verification\n${stageLines.join("\n")}`
}

export async function runVerificationStages(input: VerificationInput): Promise<VerificationResult> {
  const taskOutput = input.taskOutput?.trim() ?? ""
  const verifier = new CriticVerifier({ strictness: input.strictness ?? "medium" })

  const stage1: VerificationStage = {
    name: "Output Presence Check",
    passed: taskOutput.length > 0,
    details: taskOutput.length > 0 ? "Task output is present." : "Task output is empty.",
  }

  const criticResult = await verifier.verify(taskOutput)
  const stage2: VerificationStage = {
    name: "Semantic Critic Review",
    passed: criticResult.passed,
    details: criticResult.passed
      ? "No semantic issues detected by critic verifier."
      : criticResult.issues.map((issue) => issue.message).join("; "),
  }

  const hasVerificationKeywords = /lsp_diagnostics|build|test/i.test(taskOutput)
  const stage3: VerificationStage = {
    name: "Verification Evidence Signal",
    passed: hasVerificationKeywords,
    details: hasVerificationKeywords
      ? "Verification-related evidence was detected in output."
      : "No verification evidence keywords detected in output.",
  }

  const stages = [stage1, stage2, stage3]
  return {
    passed: stages.every((stage) => stage.passed),
    stages,
    report: buildReport(stages),
  }
}
