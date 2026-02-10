import type { LearningRecord, ToolExecuteAfterInput, ToolExecuteAfterOutput, ToolOutcome } from "./types"

const FAILURE_MARKERS = ["error", "failed", "exception", "cannot", "not found"]
const SUCCESS_MARKERS = ["success", "succeeded", "completed", "fixed", "resolved"]
const PATTERN_MARKERS = ["pattern", "convention", "naming", "factory", "best practice"]
const APPROACH_MARKERS = ["approach", "strategy", "using", "workaround", "method"]

function normalize(text: string): string {
  return text.toLowerCase()
}

function includesAny(text: string, markers: string[]): boolean {
  return markers.some((marker) => text.includes(marker))
}

export function detectOutcome(outputText: string): ToolOutcome {
  const normalized = normalize(outputText)
  if (includesAny(normalized, FAILURE_MARKERS)) return "failed"
  if (includesAny(normalized, SUCCESS_MARKERS)) return "succeeded"
  return "unknown"
}

export function detectLearning(args: {
  input: ToolExecuteAfterInput
  output: ToolExecuteAfterOutput
  previousOutcome: ToolOutcome
}): LearningRecord | null {
  const normalized = normalize(args.output.output)
  const currentOutcome = detectOutcome(args.output.output)

  if (args.previousOutcome === "failed" && currentOutcome === "succeeded") {
    return {
      kind: "error-correction",
      sessionID: args.input.sessionID,
      tool: args.input.tool,
      summary: "Recovered from tool failure using a revised approach",
      evidence: args.output.output.slice(0, 300),
      capturedAt: new Date().toISOString(),
    }
  }

  if (includesAny(normalized, PATTERN_MARKERS)) {
    return {
      kind: "pattern-discovery",
      sessionID: args.input.sessionID,
      tool: args.input.tool,
      summary: "Detected a reusable file, naming, or implementation pattern",
      evidence: args.output.output.slice(0, 300),
      capturedAt: new Date().toISOString(),
    }
  }

  if (currentOutcome === "succeeded" && includesAny(normalized, APPROACH_MARKERS)) {
    return {
      kind: "successful-approach",
      sessionID: args.input.sessionID,
      tool: args.input.tool,
      summary: "Captured a successful approach worth reusing",
      evidence: args.output.output.slice(0, 300),
      capturedAt: new Date().toISOString(),
    }
  }

  return null
}
