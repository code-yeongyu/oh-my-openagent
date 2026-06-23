export interface CustomInstructionsConfig {
  store_rules?: string[]
  ignore_rules?: string[]
  confidence_rules?: string[]
}

export function buildCustomInstructions(config: CustomInstructionsConfig): string {
  const lines: string[] = []

  if (config.store_rules && config.store_rules.length > 0) {
    lines.push("STORE:", ...config.store_rules.map((r) => `  - ${r}`))
  }
  if (config.ignore_rules && config.ignore_rules.length > 0) {
    lines.push("IGNORE:", ...config.ignore_rules.map((r) => `  - ${r}`))
  }
  if (config.confidence_rules && config.confidence_rules.length > 0) {
    lines.push("CONFIDENCE:", ...config.confidence_rules.map((r) => `  - ${r}`))
  }

  return lines.join("\n")
}

export const INSTRUCTION_PRESETS = {
  software_engineering: buildCustomInstructions({
    store_rules: [
      "architectural decisions and rationale",
      "bug fixes with root cause",
      "API designs and contracts",
      "performance findings",
      "technical constraints discovered",
    ],
    ignore_rules: [
      "raw error logs without lesson learned",
      "transient debugging observations",
      "personal preferences unrelated to code",
    ],
    confidence_rules: [
      "security vulnerabilities require HIGH confidence",
      "breaking changes require HIGH confidence",
    ],
  }),
} as const
