import { formatConfigModels } from "./formatter"
import { buildConfigModelsReport } from "./report"
import type { ConfigModelsOptions } from "./types"

export function runConfigModels(options: ConfigModelsOptions = {}): number {
  const report = buildConfigModelsReport(options)
  const output = options.output ?? console.log
  output(options.json ? JSON.stringify(report, null, 2) : formatConfigModels(report))
  return report.valid ? 0 : 1
}
