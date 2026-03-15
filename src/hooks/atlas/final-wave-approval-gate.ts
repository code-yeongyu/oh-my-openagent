import { existsSync, readFileSync } from "node:fs"

const APPROVE_VERDICT_PATTERN = /\bVERDICT:\s*APPROVE\b/i
const FINAL_VERIFICATION_HEADING_PATTERN = /^##\s+Final Verification Wave\b/i
const UNCHECKED_TASK_PATTERN = /^\s*[-*]\s*\[\s*\]\s*(.+)$/
const FINAL_WAVE_TASK_PATTERN = /^F\d+\./i

export function shouldPauseForFinalWaveApproval(input: {
  planPath: string
  taskOutput: string
}): boolean {
  if (!APPROVE_VERDICT_PATTERN.test(input.taskOutput)) {
    return false
  }

  if (!existsSync(input.planPath)) {
    return false
  }

  try {
    const content = readFileSync(input.planPath, "utf-8")
    const lines = content.split(/\r?\n/)
    let inFinalVerificationWave = false
    let uncheckedTaskCount = 0
    let uncheckedFinalWaveTaskCount = 0

    for (const line of lines) {
      if (/^##\s+/.test(line)) {
        inFinalVerificationWave = FINAL_VERIFICATION_HEADING_PATTERN.test(line)
      }

      const uncheckedTaskMatch = line.match(UNCHECKED_TASK_PATTERN)
      if (!uncheckedTaskMatch) {
        continue
      }

      uncheckedTaskCount += 1
      if (inFinalVerificationWave && FINAL_WAVE_TASK_PATTERN.test(uncheckedTaskMatch[1].trim())) {
        uncheckedFinalWaveTaskCount += 1
      }
    }

    return uncheckedTaskCount === 1 && uncheckedFinalWaveTaskCount === 1
  } catch {
    return false
  }
}
