/**
 * Verification Chain
 *
 * Cross-agent verification chain where Oracle writes independent integration tests
 * to verify implementations completed by other agents.
 */

/**
 * Verification request input
 */
export interface VerificationRequestInput {
  feature: string
  implementedFiles: string[]
  requirements: string[]
}

/**
 * Verification request for Oracle agent
 */
export interface VerificationRequest {
  targetAgent: string
  task: string
  context: {
    feature: string
    files: string[]
    requirements: string[]
  }
  constraints: string[]
  testLocation: string
}

/**
 * Verification result from Oracle
 */
export interface VerificationResultInput {
  testsWritten: number
  testFiles: string[]
  allPassed: boolean
  failures?: string[]
}

/**
 * Parsed verification result
 */
export interface VerificationResult {
  success: boolean
  testCount: number
  testFiles: string[]
  failures: string[]
}

/**
 * Trigger type
 */
type TriggerType = "manual" | "auto"

/**
 * Verification Chain interface
 */
export interface VerificationChain {
  /** Create verification request for Oracle */
  createRequest(input: VerificationRequestInput): VerificationRequest
  /** Parse verification result */
  parseResult(input: VerificationResultInput): VerificationResult
  /** Check if chain can be triggered */
  canTrigger(type: TriggerType): boolean
  /** Generate feedback report for main agent */
  generateFeedback(input: VerificationResultInput): string
}

/**
 * Verification Chain implementation
 */
class VerificationChainImpl implements VerificationChain {
  createRequest(input: VerificationRequestInput): VerificationRequest {
    return {
      targetAgent: "oracle",
      task: `Write independent integration tests for: ${input.feature}`,
      context: {
        feature: input.feature,
        files: input.implementedFiles,
        requirements: input.requirements,
      },
      constraints: [
        "Tests must be independent from implementation details",
        "Tests should verify behavior, not implementation",
        "Use black-box testing approach",
        "Do not import internal modules directly",
      ],
      testLocation: "tests/integration/",
    }
  }

  parseResult(input: VerificationResultInput): VerificationResult {
    return {
      success: input.allPassed,
      testCount: input.testsWritten,
      testFiles: input.testFiles,
      failures: input.failures || [],
    }
  }

  canTrigger(type: TriggerType): boolean {
    // Both manual and auto triggers are supported
    return type === "manual" || type === "auto"
  }

  generateFeedback(input: VerificationResultInput): string {
    const lines: string[] = []

    if (input.allPassed) {
      lines.push("## ✅ Verification Complete")
      lines.push("")
      lines.push(`All ${input.testsWritten} integration tests passed.`)
      lines.push("")
      lines.push("### Test Files")
      for (const file of input.testFiles) {
        lines.push(`- ${file}`)
      }
    } else {
      lines.push("## ❌ Verification Failed")
      lines.push("")
      lines.push(`${input.testsWritten} tests written, some failed.`)
      lines.push("")
      lines.push("### Failures")
      for (const failure of input.failures || []) {
        lines.push(`- ${failure}`)
      }
      lines.push("")
      lines.push("### Test Files")
      for (const file of input.testFiles) {
        lines.push(`- ${file}`)
      }
    }

    return lines.join("\n")
  }
}

/**
 * Create a new Verification Chain instance
 */
export function createVerificationChain(): VerificationChain {
  return new VerificationChainImpl()
}
